import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { SHOPIFY_API_VERSION, getShopifyHeaders } from '../_shared/shopify-api-policy.ts';

/**
 * Auto-Scan MCF Eligible Orders
 * ──────────────────────────────
 * Scans unfulfilled Shopify orders, matches line items to product_links,
 * and either returns eligible orders (dry_run) or auto-submits them to MCF.
 *
 * Body: { dry_run?: boolean }
 * - dry_run=true (default): Returns list of eligible orders without submitting
 * - dry_run=false: Submits eligible orders to create-mcf-order
 */

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

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let userId: string;

    if (isServiceRole) {
      // For cron calls, get the first user with active product links
      const body = await req.json().catch(() => ({}));
      if (body.user_id) {
        userId = body.user_id;
      } else {
        // Auto-resolve: find users with active FBA product links
        const { data: linkUsers } = await supabase
          .from('product_links')
          .select('user_id')
          .eq('enabled', true)
          .limit(1);
        if (!linkUsers?.length) {
          return new Response(JSON.stringify({ message: 'No users with active product links', scanned: 0 }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        userId = linkUsers[0].user_id;
      }
    } else {
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
      userId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default true

    // 1. Get active product links for this user
    const { data: productLinks } = await supabase
      .from('product_links')
      .select('*')
      .eq('user_id', userId)
      .eq('enabled', true);

    if (!productLinks?.length) {
      return new Response(JSON.stringify({
        message: 'No active product links configured',
        eligible: [],
        scanned: 0,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build lookup maps
    const variantIdMap = new Map<number, any>();
    const skuMap = new Map<string, any>();
    for (const link of productLinks) {
      variantIdMap.set(link.shopify_variant_id, link);
      if (link.shopify_sku) {
        skuMap.set(link.shopify_sku.toLowerCase(), link);
      }
    }

    // 2. Get Shopify token
    const { data: shopifyToken } = await supabase
      .from('shopify_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('token_type', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!shopifyToken?.access_token || !shopifyToken?.shop_domain) {
      return new Response(JSON.stringify({ error: 'No active Shopify connection' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Get existing MCF orders to avoid duplicates
    const { data: existingMcf } = await supabase
      .from('mcf_orders')
      .select('shopify_order_id, status')
      .eq('user_id', userId)
      .not('status', 'eq', 'cancelled');

    const existingOrderIds = new Set((existingMcf || []).map(o => o.shopify_order_id));

    // 4. Fetch unfulfilled Shopify orders (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      status: 'open',
      fulfillment_status: 'unfulfilled',
      limit: '250',
      fields: 'id,name,created_at,fulfillment_status,line_items,shipping_address,tags,note',
      created_at_min: thirtyDaysAgo,
    });

    const shopifyRes = await fetch(
      `https://${shopifyToken.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`,
      { headers: getShopifyHeaders(shopifyToken.access_token) }
    );

    if (!shopifyRes.ok) {
      const errText = await shopifyRes.text();
      console.error('[auto-scan-mcf] Shopify fetch failed:', shopifyRes.status, errText);
      return new Response(JSON.stringify({ error: `Shopify API error: ${shopifyRes.status}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const shopifyData = await shopifyRes.json();
    const orders = shopifyData.orders || [];

    // 5. Match orders to product links
    const eligible: any[] = [];
    const skipped: any[] = [];

    for (const order of orders) {
      // Skip if already submitted
      if (existingOrderIds.has(order.id)) {
        skipped.push({ order_id: order.id, name: order.name, reason: 'already_submitted' });
        continue;
      }

      // Skip if already tagged as MCF
      const tags = (order.tags || '').toLowerCase();
      if (tags.includes('amazon-mcf-pending') || tags.includes('amazon-mcf-fulfilled')) {
        skipped.push({ order_id: order.id, name: order.name, reason: 'already_tagged' });
        continue;
      }

      // Skip if no shipping address
      if (!order.shipping_address) {
        skipped.push({ order_id: order.id, name: order.name, reason: 'no_shipping_address' });
        continue;
      }

      // Try to match all line items
      const lineItems = order.line_items || [];
      const mappings: any[] = [];
      let allMapped = true;

      for (const item of lineItems) {
        const matchByVariant = variantIdMap.get(item.variant_id);
        const matchBySku = item.sku ? skuMap.get(item.sku.toLowerCase()) : null;
        const match = matchByVariant || matchBySku;

        if (match) {
          mappings.push({
            shopify_title: item.title || item.name,
            shopify_sku: item.sku || '',
            shopify_variant_id: item.variant_id,
            quantity: item.quantity || 1,
            amazon_sku: match.amazon_sku,
            amazon_asin: match.amazon_asin,
          });
        } else {
          allMapped = false;
        }
      }

      if (mappings.length > 0 && allMapped) {
        eligible.push({
          order_id: order.id,
          order_name: order.name,
          created_at: order.created_at,
          shipping_address: order.shipping_address,
          line_items: mappings,
          item_count: mappings.length,
        });
      } else if (mappings.length > 0 && !allMapped) {
        skipped.push({
          order_id: order.id,
          name: order.name,
          reason: 'partial_mapping',
          mapped: mappings.length,
          total: lineItems.length,
        });
      }
    }

    // 6. If not dry run, submit eligible orders to MCF
    const submitted: any[] = [];
    const submitErrors: any[] = [];

    if (!dryRun && eligible.length > 0) {
      for (const order of eligible) {
        try {
          const mcfPayload = {
            shopify_order_id: order.order_id,
            shopify_order_name: order.order_name,
            items: order.line_items.map((m: any) => ({
              amazon_sku: m.amazon_sku,
              quantity: m.quantity,
            })),
            destination_address: {
              name: `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim() || order.shipping_address.name || 'Customer',
              address1: order.shipping_address.address1,
              address2: order.shipping_address.address2 || '',
              city: order.shipping_address.city,
              province: order.shipping_address.province || order.shipping_address.province_code || '',
              zip: order.shipping_address.zip,
              country_code: order.shipping_address.country_code || 'AU',
              phone: order.shipping_address.phone || '',
            },
            shipping_speed: 'Standard',
          };

          // Call create-mcf-order internally via fetch
          const mcfRes = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-mcf-order`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
              },
              body: JSON.stringify(mcfPayload),
            }
          );

          const mcfData = await mcfRes.json().catch(() => null);

          if (mcfData?.success) {
            submitted.push({
              order_id: order.order_id,
              order_name: order.order_name,
              mcf_order_id: mcfData.mcf_order_id,
              seller_fulfillment_order_id: mcfData.seller_fulfillment_order_id,
            });
          } else {
            submitErrors.push({
              order_id: order.order_id,
              order_name: order.order_name,
              error: mcfData?.error || mcfData?.detail || 'Unknown error',
            });
          }
        } catch (err: any) {
          submitErrors.push({
            order_id: order.order_id,
            order_name: order.order_name,
            error: err.message,
          });
        }
      }
    }

    return new Response(JSON.stringify({
      dry_run: dryRun,
      scanned: orders.length,
      eligible: dryRun ? eligible : undefined,
      eligible_count: eligible.length,
      skipped,
      skipped_count: skipped.length,
      submitted: !dryRun ? submitted : undefined,
      submitted_count: !dryRun ? submitted.length : undefined,
      errors: !dryRun ? submitErrors : undefined,
      product_links_count: productLinks.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[auto-scan-mcf-eligible] Error:', err);
    const fallbackHeaders = getCorsHeaders(req.headers.get('origin') || '');
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...fallbackHeaders, 'Content-Type': 'application/json' },
    });
  }
});
