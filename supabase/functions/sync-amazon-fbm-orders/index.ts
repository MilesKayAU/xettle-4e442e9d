import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const SP_API_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
}

const SHOPIFY_API_VERSION = '2026-01' // matches repo standard

// (Token refresh is handled by amazon-auth edge function)

// ═══════════════════════════════════════════════════════════════
// Helper: upsert app_settings
// ═══════════════════════════════════════════════════════════════
async function upsertSetting(supabase: any, userId: string, key: string, value: string) {
  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle()

  if (existing) {
    await supabase.from('app_settings').update({ value }).eq('id', existing.id)
  } else {
    await supabase.from('app_settings').insert({ user_id: userId, key, value } as any)
  }
}

// ═══════════════════════════════════════════════════════════════
// Helper: read app_settings value
// ═══════════════════════════════════════════════════════════════
async function readSetting(supabase: any, userId: string, key: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle()
  return data?.value ?? null
}

// ═══════════════════════════════════════════════════════════════
// Helper: log system event
// ═══════════════════════════════════════════════════════════════
async function logEvent(
  supabase: any,
  userId: string,
  eventType: string,
  details: Record<string, any>,
  storeKey: string,
  amazonOrderId?: string,
  severity = 'info'
) {
  const enrichedDetails = {
    ...details,
    store_key: storeKey,
    source_marketplace: 'amazon',
    target_marketplace: 'shopify',
    ...(amazonOrderId ? { amazon_order_id: amazonOrderId } : {}),
  }
  await supabase.from('system_events').insert({
    user_id: userId,
    event_type: eventType,
    severity,
    details: enrichedDetails,
  } as any)
}

// ═══════════════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') ?? ''
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    // ─── Auth: JWT, cron secret, or service role key ─────────
    const authHeader = req.headers.get('Authorization')
    const cronSecret = req.headers.get('x-cron-secret')
    const expectedCronSecret = Deno.env.get('FBM_CRON_SECRET')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    let authenticatedUserId: string | null = null
    let isCron = false

    // Path 1: x-cron-secret header
    if (cronSecret && expectedCronSecret && cronSecret === expectedCronSecret) {
      isCron = true
    }
    // Path 2: Service role key (used by pg_cron via anon key auth passthrough)
    else if (authHeader === `Bearer ${serviceRoleKey}`) {
      isCron = true
    }
    // Path 3: User JWT
    else if (authHeader?.startsWith('Bearer ')) {
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
      }
      // Check admin role
      const { data: isAdmin } = await supabaseAuth.rpc('has_role', { _role: 'admin' })
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers })
      }
      authenticatedUserId = user.id
    } else {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
    }

    // ─── Parse body ──────────────────────────────────────────
    let body: any = {}
    try { body = await req.json() } catch { /* empty body OK for GET-like calls */ }

    const userId = body.user_id || authenticatedUserId
    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id required' }), { status: 400, headers })
    }
    const storeKey: string = body.store_key || 'primary'
    const dryRun: boolean = body.dry_run === true

    // Use service role client for all DB operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ─── Acquire concurrency lock ────────────────────────────
    const lockKey = `fbm_poll:${storeKey}`
    const { data: lockResult } = await supabase.rpc('acquire_sync_lock', {
      p_user_id: userId,
      p_integration: 'amazon',
      p_lock_key: lockKey,
      p_ttl_seconds: 600,
    })

    if (!lockResult?.acquired) {
      await logEvent(supabase, userId, 'fbm_poll_skipped_lock_held', { lock_key: lockKey }, storeKey)
      return new Response(JSON.stringify({ status: 'skipped', reason: 'lock_held' }), { status: 200, headers })
    }

    try {
      // ─── Check polling enabled (only for cron, manual runs bypass) ──
      const pollingEnabled = await readSetting(supabase, userId, `fbm:${storeKey}:polling_enabled`)
      if (isCron && pollingEnabled !== 'true') {
        await logEvent(supabase, userId, 'fbm_poll_skipped_disabled', {}, storeKey)
        return new Response(JSON.stringify({ status: 'skipped', reason: 'disabled' }), { status: 200, headers })
      }

      // ─── Log poll started ─────────────────────────────────────
      await logEvent(supabase, userId, 'fbm_poll_started', { dry_run: dryRun }, storeKey)

      // ─── Compute polling window ────────────────────────────────
      const lastPollAt = await readSetting(supabase, userId, `fbm:${storeKey}:last_poll_at`)
      let lastUpdatedAfter: string
      if (lastPollAt) {
        const dt = new Date(lastPollAt)
        dt.setMinutes(dt.getMinutes() - 2) // 2 minute buffer
        lastUpdatedAfter = dt.toISOString()
      } else {
        lastUpdatedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      }

      // ─── Get Amazon token via direct DB read + inline refresh ──
      console.log('fbm_sync_user', userId)

      const AMAZON_CLIENT_ID = Deno.env.get('AMAZON_SP_CLIENT_ID')
      const AMAZON_CLIENT_SECRET = Deno.env.get('AMAZON_SP_CLIENT_SECRET')
      if (!AMAZON_CLIENT_ID || !AMAZON_CLIENT_SECRET) {
        throw new Error('SP-API not configured: missing AMAZON_SP_CLIENT_ID or AMAZON_SP_CLIENT_SECRET')
      }

      const { data: tokenRow, error: tokenFetchErr } = await supabase
        .from('amazon_tokens')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Safeguard 9: tokenRow null check
      if (tokenFetchErr || !tokenRow) {
        throw new Error(`No Amazon token found for user: ${tokenFetchErr?.message || 'no row'}`)
      }

      let accessToken = tokenRow.access_token
      const marketplace_id = tokenRow.marketplace_id
      const region = tokenRow.region || 'fe'

      // Safeguard 3: marketplace_id guard
      if (!marketplace_id) {
        throw new Error('Missing marketplace_id in amazon_tokens row')
      }

      console.log('fbm_marketplace', marketplace_id)

      // Check if current token is still valid (with 60s buffer) — safeguard 8: Date comparison
      const tokenStillValid = accessToken && tokenRow.expires_at &&
        new Date(tokenRow.expires_at) > new Date(Date.now() + 60000)

      if (!tokenStillValid) {
        // Refresh the token — mirrors amazon-auth refresh logic exactly
        const refreshResponse = await fetch('https://api.amazon.com/auth/o2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokenRow.refresh_token,
            client_id: AMAZON_CLIENT_ID,
            client_secret: AMAZON_CLIENT_SECRET,
          }),
        })

        const refreshData = await refreshResponse.json()
        if (!refreshResponse.ok || !refreshData.access_token) {
          console.error('fbm_token_refresh_failed', refreshData)
          throw new Error('Amazon token refresh failed')
        }

        const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString()

        // Safeguard 2: preserve existing refresh_token if not returned
        await supabase
          .from('amazon_tokens')
          .update({
            access_token: refreshData.access_token,
            refresh_token: refreshData.refresh_token || tokenRow.refresh_token,
            expires_at: newExpiresAt,
          })
          .eq('id', tokenRow.id)

        accessToken = refreshData.access_token
      }

      // Safeguard 10: access_token check after refresh
      if (!accessToken) {
        throw new Error('Amazon access_token missing after refresh')
      }

      const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe

      // ─── Poll Amazon Orders API ────────────────────────────────
      const ordersParams = new URLSearchParams({
        MarketplaceIds: marketplace_id,
        FulfillmentChannels: 'MFN',
        OrderStatuses: 'Unshipped,PartiallyShipped,Shipped',
        LastUpdatedAfter: lastUpdatedAfter,
      })

      const ordersUrl = `${baseUrl}/orders/v0/orders?${ordersParams.toString()}`
      console.log('fbm_orders_url', ordersUrl)
      console.log('fbm_orders_request', { marketplace_id, region, lastUpdatedAfter })

      let ordersResponse: Response
      try {
        ordersResponse = await fetch(ordersUrl, {
          headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
        })
      } catch (fetchErr) {
        console.error('fbm_orders_fetch_failed', fetchErr)
        throw fetchErr
      }

      if (!ordersResponse.ok) {
        const errText = await ordersResponse.text()
        console.error('fbm_orders_api_error', { status: ordersResponse.status, body: errText })
        throw new Error(`Amazon Orders API failed: ${ordersResponse.status} ${errText}`)
      }

      const ordersData = await ordersResponse.json()
      const orders = ordersData?.payload?.Orders || []

      // Return success for zero orders — do not throw
      if (orders.length === 0) {
        await logEvent(supabase, userId, 'fbm_poll_completed', { total_orders: 0, dry_run: dryRun }, storeKey)
        await upsertSetting(supabase, userId, `fbm:${storeKey}:last_poll_at`, new Date().toISOString())
        // Release lock
        await supabase.rpc('release_sync_lock', { p_user_id: userId, p_lock_key: lockKey })
        return new Response(JSON.stringify({ status: 'completed', total_orders: 0, dry_run: dryRun }), { status: 200, headers })
      }

      // ─── Process each order ────────────────────────────────────
      let createdCount = 0, manualReviewCount = 0, failedCount = 0, skippedCount = 0

      // Get Shopify token
      const { data: shopifyToken } = await supabase
        .from('shopify_tokens')
        .select('access_token, shop_domain')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      // Get financial status setting
      const financialStatus = (await readSetting(supabase, userId, `fbm:${storeKey}:shopify_financial_status`)) || 'paid'

      for (const order of orders) {
        const amazonOrderId = order.AmazonOrderId
        if (!amazonOrderId) continue

        // Check if already exists — allow re-processing of unsynced orders
        const { data: existing } = await supabase
          .from('amazon_fbm_orders')
          .select('id, shopify_order_id, status')
          .eq('user_id', userId)
          .eq('amazon_order_id', amazonOrderId)
          .maybeSingle()

        if (existing) {
          // Truly synced or created — skip
          if (existing.shopify_order_id || existing.status === 'created') {
            await logEvent(supabase, userId, 'fbm_duplicate_skipped', { existing_status: existing.status }, storeKey, amazonOrderId)
            skippedCount++
            continue
          }
          // Unsynced (pending, failed, manual_review, dry_run) — delete old row and re-process
          console.log('fbm_reprocessing_order', { amazonOrderId, previousStatus: existing.status })
          await supabase.from('amazon_fbm_orders').delete().eq('id', existing.id)
          await logEvent(supabase, userId, 'fbm_reprocessing_order', { previous_status: existing.status }, storeKey, amazonOrderId)
        }

        // Insert as pending
        const { data: insertedOrder, error: insertError } = await supabase
          .from('amazon_fbm_orders')
          .insert({
            user_id: userId,
            amazon_order_id: amazonOrderId,
            status: 'pending',
            raw_amazon_payload: order,
          } as any)
          .select('id')
          .single()

        if (insertError) {
          // Likely duplicate from race condition
          console.warn(`[sync-amazon-fbm] Insert failed for ${amazonOrderId}: ${insertError.message}`)
          skippedCount++
          continue
        }

        await logEvent(supabase, userId, 'fbm_order_new', {}, storeKey, amazonOrderId)

        // Fetch order items
        const itemsUrl = `${baseUrl}/orders/v0/orders/${amazonOrderId}/orderItems`
        const itemsResponse = await fetch(itemsUrl, {
          headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
        })

        if (!itemsResponse.ok) {
          const errText = await itemsResponse.text()
          await supabase.from('amazon_fbm_orders').update({
            status: 'failed',
            error_detail: `Order items fetch failed: ${itemsResponse.status} ${errText}`,
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_order_failed', { error: errText }, storeKey, amazonOrderId, 'error')
          failedCount++
          continue
        }

        const itemsData = await itemsResponse.json()
        const orderItems = itemsData?.payload?.OrderItems || []

        // ─── OrderItems debug logging ────────────────────────────
        const itemSkus = orderItems.map((item: any) => ({
          SellerSKU: item.SellerSKU,
          ASIN: item.ASIN,
          QuantityOrdered: item.QuantityOrdered,
        }))
        console.log('fbm_order_items', { amazonOrderId, order_items_count: orderItems.length, items: itemSkus })

        await logEvent(supabase, userId, 'fbm_order_items_fetched', {
          order_items_count: orderItems.length,
          items: itemSkus,
        }, storeKey, amazonOrderId)

        // Safety: empty order items
        if (orderItems.length === 0) {
          await supabase.from('amazon_fbm_orders').update({
            status: 'manual_review',
            error_detail: 'no_order_items',
            raw_amazon_payload: { ...order, orderItems: [] },
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_order_no_items', {}, storeKey, amazonOrderId, 'warn')
          manualReviewCount++
          continue
        }

        // Map SKUs via product_links
        const skus = orderItems.map((item: any) => item.SellerSKU).filter(Boolean)
        console.log('fbm_sku_lookup', { amazonOrderId, skus_to_match: skus })

        const { data: mappings } = await supabase
          .from('product_links')
          .select('amazon_sku, shopify_variant_id, shopify_sku')
          .eq('user_id', userId)
          .eq('enabled', true)
          .in('amazon_sku', skus)

        const mappingMap = new Map((mappings || []).map((m: any) => [m.amazon_sku, m]))
        const unmappedSkus = skus.filter((sku: string) => !mappingMap.has(sku))
        const matchedSkus = skus.filter((sku: string) => mappingMap.has(sku)).map((sku: string) => ({
          amazon_sku: sku,
          shopify_variant_id: mappingMap.get(sku)?.shopify_variant_id,
        }))

        console.log('fbm_sku_mapping_result', { amazonOrderId, matched: matchedSkus, unmapped: unmappedSkus })

        // Store debug details on order record
        await supabase.from('amazon_fbm_orders').update({
          raw_amazon_payload: { ...order, orderItems: itemSkus, matched_skus: matchedSkus, unmapped_skus: unmappedSkus },
        } as any).eq('id', insertedOrder.id)

        if (unmappedSkus.length > 0) {
          await supabase.from('amazon_fbm_orders').update({
            status: 'manual_review',
            error_detail: `Unmapped SKU: ${unmappedSkus.join(', ')}`,
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_order_unmapped_sku', { unmapped_skus: unmappedSkus, matched_skus: matchedSkus }, storeKey, amazonOrderId, 'warn')
          manualReviewCount++
          continue
        }

        // ─── Dry run check ──────────────────────────────────────
        if (dryRun) {
          await supabase.from('amazon_fbm_orders').update({
            error_detail: 'dry_run',
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_dry_run_skipped_create', {}, storeKey, amazonOrderId)
          continue
        }

        // ─── Idempotency guard: re-check shopify_order_id ──────
        const { data: recheck } = await supabase
          .from('amazon_fbm_orders')
          .select('shopify_order_id')
          .eq('id', insertedOrder.id)
          .single()

        if (recheck?.shopify_order_id) {
          await logEvent(supabase, userId, 'fbm_duplicate_shopify_prevented', {}, storeKey, amazonOrderId)
          skippedCount++
          continue
        }

        // ─── Create Shopify order ────────────────────────────────
        if (!shopifyToken) {
          await supabase.from('amazon_fbm_orders').update({
            status: 'failed',
            error_detail: 'No active Shopify token found',
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_order_failed', { error: 'no_shopify_token' }, storeKey, amazonOrderId, 'error')
          failedCount++
          continue
        }

        // Set status to creating
        await supabase.from('amazon_fbm_orders').update({ status: 'creating' } as any).eq('id', insertedOrder.id)

        // Build Shopify order payload
        const lineItems = orderItems.map((item: any) => {
          const mapping = mappingMap.get(item.SellerSKU)
          return {
            variant_id: mapping!.shopify_variant_id,
            quantity: item.QuantityOrdered || 1,
            price: item.ItemPrice?.Amount || '0',
            title: item.Title || item.SellerSKU,
          }
        })

        // Map shipping address from Amazon
        const shippingAddress = order.ShippingAddress ? {
          first_name: order.ShippingAddress.Name?.split(' ')[0] || '',
          last_name: order.ShippingAddress.Name?.split(' ').slice(1).join(' ') || '',
          address1: order.ShippingAddress.AddressLine1 || '',
          address2: order.ShippingAddress.AddressLine2 || '',
          city: order.ShippingAddress.City || '',
          province: order.ShippingAddress.StateOrRegion || '',
          zip: order.ShippingAddress.PostalCode || '',
          country: order.ShippingAddress.CountryCode || 'AU',
          phone: order.ShippingAddress.Phone || '',
        } : undefined

        const shopifyPayload = {
          order: {
            line_items: lineItems,
            ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
            financial_status: financialStatus,
            fulfillment_status: 'unfulfilled',
            tags: 'amazon-fbm,xettle-bridge',
            source_name: 'amazon',
            note: `Amazon FBM Order: ${amazonOrderId}`,
          },
        }

        const shopifyUrl = `https://${shopifyToken.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`

        try {
          const shopifyResponse = await fetch(shopifyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': shopifyToken.access_token,
            },
            body: JSON.stringify(shopifyPayload),
          })

          if (shopifyResponse.ok) {
            const shopifyData = await shopifyResponse.json()
            const shopifyOrderId = shopifyData?.order?.id

            await supabase.from('amazon_fbm_orders').update({
              status: 'created',
              shopify_order_id: shopifyOrderId,
              raw_shopify_payload: shopifyData,
              processed_at: new Date().toISOString(),
            } as any).eq('id', insertedOrder.id)

            await logEvent(supabase, userId, 'fbm_order_created', {
              shopify_order_id: shopifyOrderId,
            }, storeKey, amazonOrderId)
            createdCount++
          } else {
            const errText = await shopifyResponse.text()
            const statusCode = shopifyResponse.status

            if (statusCode === 422) {
              // Unprocessable — manual review
              await supabase.from('amazon_fbm_orders').update({
                status: 'manual_review',
                error_detail: `Shopify 422: ${errText}`,
              } as any).eq('id', insertedOrder.id)
              await logEvent(supabase, userId, 'fbm_order_manual_review_422', { error: errText, status: 422 }, storeKey, amazonOrderId, 'warn')
              manualReviewCount++
            } else if (statusCode >= 500) {
              // Transient failure
              await supabase.from('amazon_fbm_orders').update({
                status: 'failed',
                error_detail: `Shopify ${statusCode}: ${errText}`,
              } as any).eq('id', insertedOrder.id)
              await logEvent(supabase, userId, 'fbm_order_failed_transient', { error: errText, status: statusCode }, storeKey, amazonOrderId, 'error')
              failedCount++
            } else {
              // Other 4xx
              await supabase.from('amazon_fbm_orders').update({
                status: 'failed',
                error_detail: `Shopify ${statusCode}: ${errText}`,
              } as any).eq('id', insertedOrder.id)
              await logEvent(supabase, userId, 'fbm_order_failed', { error: errText, status: statusCode }, storeKey, amazonOrderId, 'error')
              failedCount++
            }
          }
        } catch (shopifyErr: any) {
          // Network error / timeout
          await supabase.from('amazon_fbm_orders').update({
            status: 'failed',
            error_detail: `Network error: ${shopifyErr.message}`,
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_order_failed_transient', { error: shopifyErr.message }, storeKey, amazonOrderId, 'error')
          failedCount++
        }
      }

      // ─── Update last_poll_at (successful run only) ─────────────
      await upsertSetting(supabase, userId, `fbm:${storeKey}:last_poll_at`, new Date().toISOString())

      // ─── Log poll completed ────────────────────────────────────
      await logEvent(supabase, userId, 'fbm_poll_completed', {
        total_orders: orders.length,
        created_count: createdCount,
        manual_review_count: manualReviewCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        dry_run: dryRun,
      }, storeKey)

      return new Response(JSON.stringify({
        status: 'completed',
        total_orders: orders.length,
        created_count: createdCount,
        manual_review_count: manualReviewCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
      }), { status: 200, headers })

    } finally {
      // Always release lock
      await supabase.rpc('release_sync_lock', {
        p_user_id: userId,
        p_integration: 'amazon',
        p_lock_key: lockKey,
      })
    }

  } catch (err: any) {
    logger.error(`[sync-amazon-fbm] Unhandled error: ${err.message}`)

    // Try to log the error event
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      let body: any = {}
      try { body = await req.clone().json() } catch { /* */ }
      const userId = body.user_id
      const storeKey = body.store_key || 'primary'
      if (userId) {
        await logEvent(supabase, userId, 'fbm_poll_error', { error: err.message }, storeKey, undefined, 'error')
      }
    } catch { /* best effort */ }

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req.headers.get('Origin') ?? ''), 'Content-Type': 'application/json' },
    })
  }
})
