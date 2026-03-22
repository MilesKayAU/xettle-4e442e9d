import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { getEndpointForRegion, getSpApiHeaders, LWA, isTokenExpired } from '../_shared/amazon-sp-api-policy.ts';
import { auditedFetch } from '../_shared/api-audit.ts';

const corsHeaders = getCorsHeaders();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { shopify_order_id, shopify_order_name, items, destination_address, shipping_speed = 'Standard' } = body;

    if (!shopify_order_id || !items?.length || !destination_address) {
      return new Response(JSON.stringify({ error: 'Missing required fields: shopify_order_id, items, destination_address' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get Amazon token
    const { data: tokens } = await supabase
      .from('amazon_tokens')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!tokens?.length) {
      return new Response(JSON.stringify({ error: 'No Amazon connection found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let token = tokens[0];
    const region = token.region || 'fe';
    const endpoint = getEndpointForRegion(region);

    // Refresh token if expired
    if (isTokenExpired(token.expires_at)) {
      const clientId = Deno.env.get('AMAZON_CLIENT_ID');
      const clientSecret = Deno.env.get('AMAZON_CLIENT_SECRET');
      if (!clientId || !clientSecret) {
        return new Response(JSON.stringify({ error: 'Amazon OAuth not configured' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const refreshRes = await fetch(LWA.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      const refreshData = await refreshRes.json();
      if (!refreshData.access_token) {
        return new Response(JSON.stringify({ error: 'Failed to refresh Amazon token' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const expiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString();
      await supabase.from('amazon_tokens').update({
        access_token: refreshData.access_token,
        expires_at: expiresAt,
        ...(refreshData.refresh_token ? { refresh_token: refreshData.refresh_token } : {}),
      }).eq('id', token.id);

      token = { ...token, access_token: refreshData.access_token };
    }

    // Build MCF request
    const sellerFulfillmentOrderId = `XETTLE-${shopify_order_id}-${Date.now()}`;
    
    const mcfPayload = {
      sellerFulfillmentOrderId,
      displayableOrderId: shopify_order_name || `Shopify-${shopify_order_id}`,
      displayableOrderDate: new Date().toISOString(),
      displayableOrderComment: `Fulfilled via Xettle MCF from Shopify order ${shopify_order_name || shopify_order_id}`,
      shippingSpeedCategory: shipping_speed, // Standard, Expedited, Priority
      destinationAddress: {
        name: destination_address.name || 'Customer',
        addressLine1: destination_address.address1 || destination_address.addressLine1 || '',
        addressLine2: destination_address.address2 || destination_address.addressLine2 || '',
        city: destination_address.city || '',
        stateOrRegion: destination_address.province || destination_address.stateOrRegion || '',
        postalCode: destination_address.zip || destination_address.postalCode || '',
        countryCode: destination_address.country_code || destination_address.countryCode || 'AU',
        phone: destination_address.phone || '',
      },
      items: items.map((item: any, idx: number) => ({
        sellerSku: item.amazon_sku || item.sku,
        sellerFulfillmentOrderItemId: `${sellerFulfillmentOrderId}-${idx + 1}`,
        quantity: item.quantity || 1,
      })),
      marketplaceId: token.marketplace_id || 'A39IBJ37TRP1C6',
    };

    // Insert pending record first
    const { data: mcfRecord, error: insertError } = await supabase
      .from('mcf_orders')
      .insert({
        user_id: user.id,
        shopify_order_id,
        shopify_order_name: shopify_order_name || null,
        seller_fulfillment_order_id: sellerFulfillmentOrderId,
        status: 'pending',
        items,
        destination_address,
        shipping_speed,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ error: 'Failed to create MCF record', detail: insertError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call Amazon Fulfillment Outbound API
    const apiUrl = `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders`;
    const headers = getSpApiHeaders(token.access_token!);

    const amazonRes = await auditedFetch(supabase, user.id, {
      integration: 'amazon',
      endpoint: '/fba/outbound/2020-07-01/fulfillmentOrders',
      method: 'POST',
      url: apiUrl,
      headers,
      body: JSON.stringify(mcfPayload),
    });

    const amazonData = await amazonRes.json().catch(() => null);

    if (!amazonRes.ok) {
      const errorMsg = amazonData?.errors?.[0]?.message || amazonData?.message || `HTTP ${amazonRes.status}`;
      await supabase.from('mcf_orders').update({
        status: 'failed',
        error_detail: errorMsg,
        raw_amazon_response: amazonData,
        updated_at: new Date().toISOString(),
      }).eq('id', mcfRecord.id);

      return new Response(JSON.stringify({
        error: 'Amazon MCF submission failed',
        detail: errorMsg,
        amazon_status: amazonRes.status,
        mcf_order_id: mcfRecord.id,
      }), {
        status: 200, // Return 200 so the UI can handle the error gracefully
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Success — update record
    await supabase.from('mcf_orders').update({
      status: 'submitted',
      amazon_fulfillment_order_id: amazonData?.payload?.fulfillmentOrderId || sellerFulfillmentOrderId,
      raw_amazon_response: amazonData,
      updated_at: new Date().toISOString(),
    }).eq('id', mcfRecord.id);

    return new Response(JSON.stringify({
      success: true,
      mcf_order_id: mcfRecord.id,
      amazon_fulfillment_order_id: amazonData?.payload?.fulfillmentOrderId,
      seller_fulfillment_order_id: sellerFulfillmentOrderId,
      status: 'submitted',
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[create-mcf-order] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
