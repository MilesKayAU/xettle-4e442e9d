import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { getEndpointForRegion, getSpApiHeaders, LWA, isTokenExpired } from '../_shared/amazon-sp-api-policy.ts';
import { auditedFetch } from '../_shared/api-audit.ts';
import { SHOPIFY_API_VERSION, getShopifyHeaders } from '../_shared/shopify-api-policy.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);

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

    const body = await req.json().catch(() => ({}));
    const specificOrderId = body.mcf_order_id;

    // Get pending/submitted MCF orders
    let query = supabase
      .from('mcf_orders')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['submitted', 'processing']);

    if (specificOrderId) {
      query = supabase
        .from('mcf_orders')
        .select('*')
        .eq('user_id', user.id)
        .eq('id', specificOrderId);
    }

    const { data: orders, error: queryError } = await query;
    if (queryError) {
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!orders?.length) {
      return new Response(JSON.stringify({ message: 'No orders to poll', updated: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    // Refresh if expired
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

    const results: any[] = [];

    for (const order of orders) {
      const orderId = order.seller_fulfillment_order_id;
      if (!orderId) {
        results.push({ id: order.id, status: 'skipped', reason: 'no seller_fulfillment_order_id' });
        continue;
      }

      try {
        const apiUrl = `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(orderId)}`;
        const headers = getSpApiHeaders(token.access_token!);

        const amazonRes = await auditedFetch(supabase, user.id, {
          integration: 'amazon',
          endpoint: `/fba/outbound/2020-07-01/fulfillmentOrders/${orderId}`,
          method: 'GET',
          url: apiUrl,
          headers,
        });

        const data = await amazonRes.json().catch(() => null);

        if (!amazonRes.ok) {
          const errorMsg = data?.errors?.[0]?.message || `HTTP ${amazonRes.status}`;
          await supabase.from('mcf_orders').update({
            error_detail: errorMsg,
            raw_amazon_response: data,
            retry_count: (order.retry_count || 0) + 1,
            updated_at: new Date().toISOString(),
          }).eq('id', order.id);
          results.push({ id: order.id, status: 'error', detail: errorMsg });
          continue;
        }

        const fulfillmentOrder = data?.payload?.fulfillmentOrder;
        const shipments = data?.payload?.fulfillmentShipments || [];

        // Map Amazon status to our status
        const amazonStatus = fulfillmentOrder?.fulfillmentOrderStatus;
        let newStatus = order.status;
        if (amazonStatus === 'PROCESSING' || amazonStatus === 'PLANNING') newStatus = 'processing';
        else if (amazonStatus === 'COMPLETE' || amazonStatus === 'COMPLETE_PARTIALLED') newStatus = 'shipped';
        else if (amazonStatus === 'UNFULFILLABLE') newStatus = 'failed';
        else if (amazonStatus === 'CANCELLED') newStatus = 'cancelled';

        // Extract tracking from shipments
        let trackingNumber = order.tracking_number;
        let carrier = order.carrier;
        let estimatedArrival = order.estimated_arrival;

        for (const shipment of shipments) {
          const packages = shipment.fulfillmentShipmentPackage || [];
          for (const pkg of packages) {
            if (pkg.trackingNumber) trackingNumber = pkg.trackingNumber;
            if (pkg.carrierCode) carrier = pkg.carrierCode;
          }
          if (shipment.estimatedArrivalDate) estimatedArrival = shipment.estimatedArrivalDate;
        }

        await supabase.from('mcf_orders').update({
          status: newStatus,
          tracking_number: trackingNumber,
          carrier,
          estimated_arrival: estimatedArrival,
          amazon_fulfillment_order_id: fulfillmentOrder?.fulfillmentOrderId || order.amazon_fulfillment_order_id,
          raw_amazon_response: data,
          error_detail: null,
          updated_at: new Date().toISOString(),
        }).eq('id', order.id);

        results.push({
          id: order.id,
          status: newStatus,
          tracking_number: trackingNumber,
          carrier,
          amazon_status: amazonStatus,
        });

        // If shipped and has tracking, push to Shopify
        if ((newStatus === 'shipped' || newStatus === 'delivered') && trackingNumber && order.shopify_order_id) {
          try {
            await pushTrackingToShopify(supabase, user.id, order.shopify_order_id, trackingNumber, carrier);
            results[results.length - 1].shopify_tracking_pushed = true;
          } catch (shopifyErr: any) {
            results[results.length - 1].shopify_tracking_error = shopifyErr.message;
          }
        }
      } catch (err: any) {
        results.push({ id: order.id, status: 'error', detail: err.message });
      }
    }

    return new Response(JSON.stringify({
      updated: results.length,
      results,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[poll-mcf-status] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Get the best active Shopify token for a user.
 */
async function getShopifyToken(supabase: any, userId: string) {
  const { data: shopifyTokens } = await supabase
    .from('shopify_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('token_type', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1);

  if (!shopifyTokens?.length) {
    throw new Error('No active Shopify token available');
  }
  return shopifyTokens[0];
}

/**
 * Push tracking info to Shopify order via fulfillment API.
 * Also updates tags: removes amazon-mcf-pending, adds amazon-mcf-fulfilled.
 */
async function pushTrackingToShopify(
  supabase: any,
  userId: string,
  shopifyOrderId: number,
  trackingNumber: string,
  carrier: string | null,
) {
  const shopToken = await getShopifyToken(supabase, userId);
  const shop = shopToken.shop_domain || shopToken.shop;

  // Create fulfillment
  const fulfillmentRes = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/fulfillments.json`,
    {
      method: 'POST',
      headers: { ...getShopifyHeaders(shopToken.access_token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fulfillment: {
          tracking_number: trackingNumber,
          tracking_company: carrier || 'Other',
          notify_customer: true,
        },
      }),
    }
  );

  if (!fulfillmentRes.ok) {
    const errData = await fulfillmentRes.text();
    throw new Error(`Shopify fulfillment failed: ${fulfillmentRes.status} — ${errData}`);
  }

  // Update tags: remove pending, add fulfilled
  try {
    await updateShopifyMcfTags(shop, shopToken.access_token, shopifyOrderId, 'fulfilled');
  } catch (tagErr: any) {
    console.error('[poll-mcf-status] Tag update failed (non-blocking):', tagErr.message);
  }
}

/**
 * Update MCF-related tags on a Shopify order.
 * action: 'fulfilled' → remove pending, add fulfilled
 * action: 'cancelled' → remove pending, add note
 */
async function updateShopifyMcfTags(
  shop: string,
  accessToken: string,
  shopifyOrderId: number,
  action: 'fulfilled' | 'cancelled',
) {
  const orderRes = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json?fields=id,tags,note`,
    { headers: getShopifyHeaders(accessToken) }
  );
  if (!orderRes.ok) return;
  const orderData = await orderRes.json();
  let tags = (orderData.order?.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean);
  let note = orderData.order?.note || '';

  // Remove pending tag
  tags = tags.filter((t: string) => t !== 'amazon-mcf-pending');

  if (action === 'fulfilled') {
    if (!tags.includes('amazon-mcf-fulfilled')) tags.push('amazon-mcf-fulfilled');
    note += '\n[Xettle MCF] Amazon fulfillment complete — tracking pushed to Shopify';
  } else if (action === 'cancelled') {
    note += '\n[Xettle MCF] Amazon MCF order cancelled — order returned to unfulfilled';
  }

  await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`,
    {
      method: 'PUT',
      headers: { ...getShopifyHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: { id: shopifyOrderId, tags: tags.join(', '), note } }),
    }
  );
}
