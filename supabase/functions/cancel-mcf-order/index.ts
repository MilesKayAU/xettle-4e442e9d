import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { getEndpointForRegion, getSpApiHeaders, LWA, isTokenExpired } from '../_shared/amazon-sp-api-policy.ts';
import { auditedFetch } from '../_shared/api-audit.ts';
import { SHOPIFY_API_VERSION, getShopifyHeaders } from '../_shared/shopify-api-policy.ts';

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

    const { mcf_order_id } = await req.json();
    if (!mcf_order_id) {
      return new Response(JSON.stringify({ error: 'Missing mcf_order_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the MCF order
    const { data: mcfOrder, error: fetchErr } = await supabase
      .from('mcf_orders')
      .select('*')
      .eq('id', mcf_order_id)
      .eq('user_id', user.id)
      .single();

    if (fetchErr || !mcfOrder) {
      return new Response(JSON.stringify({ error: 'MCF order not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only cancel if in a cancellable state
    const cancellable = ['pending', 'submitted', 'processing'];
    if (!cancellable.includes(mcfOrder.status)) {
      return new Response(JSON.stringify({
        error: `Cannot cancel order in "${mcfOrder.status}" state`,
        detail: `Only orders in ${cancellable.join(', ')} status can be cancelled`,
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If still pending (never sent to Amazon), just mark cancelled locally
    if (mcfOrder.status === 'pending' || !mcfOrder.seller_fulfillment_order_id) {
      await supabase.from('mcf_orders').update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      }).eq('id', mcf_order_id);

      // Clean up Shopify tags
      if (mcfOrder.shopify_order_id) {
        try {
          await cleanupShopifyMcfTags(supabase, user.id, mcfOrder.shopify_order_id);
        } catch (e: any) {
          console.error('[cancel-mcf-order] Shopify tag cleanup failed:', e.message);
        }
      }

      return new Response(JSON.stringify({ success: true, status: 'cancelled', note: 'Cancelled locally (never submitted to Amazon)' }), {
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

    // Call Amazon cancelFulfillmentOrder API
    const apiUrl = `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(mcfOrder.seller_fulfillment_order_id)}`;
    const headers = getSpApiHeaders(token.access_token!);

    const amazonRes = await auditedFetch(supabase, user.id, {
      integration: 'amazon',
      endpoint: `/fba/outbound/2020-07-01/fulfillmentOrders/${mcfOrder.seller_fulfillment_order_id}`,
      method: 'PUT',
      url: apiUrl,
      headers,
      body: JSON.stringify({ /* Amazon cancel uses PUT with empty body or status update */ }),
    });

    // Amazon returns 200 for successful cancel
    if (amazonRes.ok || amazonRes.status === 200) {
      await supabase.from('mcf_orders').update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      }).eq('id', mcf_order_id);

      // Clean up Shopify tags
      if (mcfOrder.shopify_order_id) {
        try {
          await cleanupShopifyMcfTags(supabase, user.id, mcfOrder.shopify_order_id);
        } catch (e: any) {
          console.error('[cancel-mcf-order] Shopify tag cleanup failed:', e.message);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        status: 'cancelled',
        note: 'Cancellation sent to Amazon successfully',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle Amazon error
    const errorData = await amazonRes.json().catch(() => null);
    const errorMsg = errorData?.errors?.[0]?.message || `Amazon returned HTTP ${amazonRes.status}`;

    // If Amazon says it's already shipped/completed, update status
    if (amazonRes.status === 400 || amazonRes.status === 409) {
      await supabase.from('mcf_orders').update({
        error_detail: `Cancel failed: ${errorMsg}`,
        updated_at: new Date().toISOString(),
      }).eq('id', mcf_order_id);
    }

    return new Response(JSON.stringify({
      error: 'Amazon cancellation failed',
      detail: errorMsg,
      amazon_status: amazonRes.status,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[cancel-mcf-order] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Remove amazon-mcf-pending tag and add cancellation note on Shopify order.
 */
async function cleanupShopifyMcfTags(supabase: any, userId: string, shopifyOrderId: number) {
  const { data: shopifyTokens } = await supabase
    .from('shopify_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('token_type', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1);

  if (!shopifyTokens?.length) return;

  const shopToken = shopifyTokens[0];
  const shop = shopToken.shop_domain || shopToken.shop;

  const orderRes = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json?fields=id,tags,note`,
    { headers: getShopifyHeaders(shopToken.access_token) }
  );
  if (!orderRes.ok) return;

  const orderData = await orderRes.json();
  let tags = (orderData.order?.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean);
  tags = tags.filter((t: string) => t !== 'amazon-mcf-pending');
  const note = (orderData.order?.note || '') + '\n[Xettle MCF] Amazon MCF order cancelled — order returned to unfulfilled';

  await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}.json`,
    {
      method: 'PUT',
      headers: { ...getShopifyHeaders(shopToken.access_token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: { id: shopifyOrderId, tags: tags.join(', '), note } }),
    }
  );
}
