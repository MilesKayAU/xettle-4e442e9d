import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  getEndpointForRegion,
  getSpApiHeaders,
  isTokenExpired,
  LWA,
  API_VERSIONS,
} from '../_shared/amazon-sp-api-policy.ts'
import { logger } from '../_shared/logger.ts'

// ═══════════════════════════════════════════════════════════════
// Orders API v2026-01-01 — PII via role-based permissions (no RDT)
// ═══════════════════════════════════════════════════════════════
// MIGRATION NOTE (2026-03-20):
// - Rows in amazon_fbm_orders created BEFORE this migration have v0 payload
//   structure (PascalCase flat: ShippingAddress.Name, BuyerInfo.BuyerName, etc.)
// - Rows created AFTER this migration have v2026-01-01 payload structure
//   (nested camelCase: recipient.shippingAddress.name, buyer.buyerName, etc.)
// - The raw_amazon_payload.api_version field distinguishes them.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Helper: Extract PII fields from v2026-01-01 order response
// Role-based access means fields are either present or absent —
// no per-request token dance, no RDT.
// ═══════════════════════════════════════════════════════════════

// Hard-block fields required for Shopify order creation
const HARD_BLOCK_FIELDS = ['recipient_name', 'address_line_1', 'city', 'postal_code', 'country_code'] as const
const SOFT_WARN_FIELDS = ['buyer_name', 'buyer_email', 'phone'] as const

interface PiiExtractResult {
  recipientName: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  stateOrRegion: string | null
  postalCode: string | null
  countryCode: string | null
  phone: string | null
  buyerName: string | null
  buyerEmail: string | null
  missingRequiredFields: string[]
  missingWarningFields: string[]
  piiPresent: boolean
}

/**
 * Extract PII from a v2026-01-01 order object.
 * Fields come directly in the order if SP-API role is granted.
 * If the role isn't granted, fields are simply absent (no error, no RDT needed).
 */
function extractPiiFromOrder(order: any): PiiExtractResult {
  // Support both early v2026 role-based payloads and the current Orders API shape
  const recipient = order?.recipient || {}
  const addr = recipient?.shippingAddress || recipient?.deliveryAddress || {}
  const buyer = order?.buyer || {}

  const result: PiiExtractResult = {
    recipientName: addr.name || recipient?.name || null,
    addressLine1: addr.addressLine1 || addr.address1 || addr.addressLine || null,
    addressLine2: addr.addressLine2 || addr.address2 || null,
    city: addr.city || null,
    stateOrRegion: addr.stateOrRegion || null,
    postalCode: addr.postalCode || null,
    countryCode: addr.countryCode || null,
    phone: addr.phone || addr.phoneNumber || null,
    buyerName: buyer.buyerName || buyer.name || null,
    buyerEmail: buyer.buyerEmail || buyer.email || null,
    missingRequiredFields: [],
    missingWarningFields: [],
    piiPresent: false,
  }

  const fieldPresence: Record<string, boolean> = {
    recipient_name: !!result.recipientName,
    address_line_1: !!result.addressLine1,
    city: !!result.city,
    postal_code: !!result.postalCode,
    country_code: !!result.countryCode,
    buyer_name: !!(result.buyerName || result.recipientName),
    buyer_email: !!result.buyerEmail,
    phone: !!result.phone,
  }

  result.missingRequiredFields = HARD_BLOCK_FIELDS.filter(f => !fieldPresence[f])
  result.missingWarningFields = SOFT_WARN_FIELDS.filter(f => !fieldPresence[f])
  result.piiPresent = result.missingRequiredFields.length === 0

  return result
}

function getAmazonOrderId(order: any): string | null {
  return order?.orderId
    || order?.amazonOrderId
    || order?.AmazonOrderId
    || order?.orderAliases?.find((alias: any) => alias?.aliasType === 'SELLER_ORDER_ID')?.aliasId
    || order?.orderAliases?.[0]?.aliasId
    || null
}

function getAmazonOrderStatus(order: any): string {
  return order?.orderStatus || order?.OrderStatus || order?.status || order?.orderState || order?.currentStatus || ''
}

function getOrderItemSku(item: any): string | null {
  return item?.sellerSku
    || item?.SellerSKU
    || item?.product?.sellerSku
    || item?.product?.sku
    || item?.product?.identifiers?.sellerSku
    || item?.sku
    || null
}

function getOrderItemAsin(item: any): string | null {
  return item?.asin
    || item?.ASIN
    || item?.product?.asin
    || item?.product?.identifiers?.asin
    || null
}

function getOrderItemQuantity(item: any): number {
  return item?.quantityOrdered || item?.QuantityOrdered || item?.quantity || item?.product?.quantity || 1
}

function getOrderItemPrice(item: any): string {
  return item?.itemPrice?.amount
    || item?.ItemPrice?.Amount
    || item?.product?.price?.unitPrice?.amount
    || item?.price?.amount
    || '0'
}

function getOrderItemTitle(item: any): string {
  return item?.title || item?.Title || item?.product?.title || item?.product?.name || getOrderItemSku(item) || 'Amazon Item'
}

const SHOPIFY_API_VERSION = '2026-01'

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
// Helper: Read Shopify token from DB (permanent shpca_ token)
// ═══════════════════════════════════════════════════════════════
const SHOPIFY_FBM_STORE = 'mileskayaustralia.myshopify.com'

interface ShopifyInternalToken {
  access_token: string
  shop_domain: string
}

async function getShopifyInternalToken(): Promise<ShopifyInternalToken> {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Look for active token for the FBM store
  const { data: token, error } = await supabaseAdmin
    .from('shopify_tokens')
    .select('access_token, shop_domain')
    .eq('shop_domain', SHOPIFY_FBM_STORE)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to query shopify_tokens: ${error.message}`)
  }

  if (!token?.access_token) {
    throw new Error(
      `No active Shopify token found for ${SHOPIFY_FBM_STORE}. ` +
      `Please run the internal OAuth flow first (Admin → FBM Bridge → Connect XettleInternal).`
    )
  }

  logger.info('fbm_shopify_token_loaded', { shop: SHOPIFY_FBM_STORE, tokenPrefix: token.access_token.substring(0, 6) })
  return { access_token: token.access_token, shop_domain: token.shop_domain }
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
// Helper: Check if a Shopify order already exists for an Amazon order ID
// Detects orders created by CedCommerce, other MCF apps, or manual entry
// ═══════════════════════════════════════════════════════════════
async function checkShopifyDuplicate(
  shopifyToken: ShopifyInternalToken,
  amazonOrderId: string,
): Promise<string | null> {
  const graphqlUrl = `https://${shopifyToken.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`

  // Search across order name, tags, and notes for the Amazon order ID
  const query = `{
    orders(first: 5, query: "${amazonOrderId}") {
      edges {
        node {
          id
          name
          tags
          note
          customAttributes { key value }
        }
      }
    }
  }`

  try {
    const res = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopifyToken.access_token,
      },
      body: JSON.stringify({ query }),
    })

    if (!res.ok) {
      console.warn('shopify_dedup_check_failed', { status: res.status })
      return null // Fail open — don't block order creation on dedup failure
    }

    const data = await res.json()
    const edges = data?.data?.orders?.edges || []

    for (const edge of edges) {
      const node = edge.node
      if (!node) continue

      // Check tags, note, name, and custom attributes for the Amazon order ID
      const tags = (node.tags || []) as string[]
      const note = node.note || ''
      const name = node.name || ''
      const attrs = (node.customAttributes || []) as { key: string; value: string }[]

      const inTags = tags.some((t: string) => t.includes(amazonOrderId))
      const inNote = note.includes(amazonOrderId)
      const inName = name.includes(amazonOrderId)
      const inAttrs = attrs.some((a: { key: string; value: string }) => a.value?.includes(amazonOrderId))

      if (inTags || inNote || inName || inAttrs) {
        console.log('shopify_duplicate_found', {
          amazonOrderId,
          shopifyGid: node.id,
          matchedIn: inTags ? 'tags' : inNote ? 'note' : inName ? 'name' : 'customAttributes',
        })
        return node.id
      }
    }

    return null
  } catch (err: any) {
    console.warn('shopify_dedup_check_error', err.message)
    return null // Fail open
  }
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
    const forceRefetch: boolean = body.force_refetch === true

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

      // ─── Force refetch: bulk-delete stale rows ─────────────────
      if (forceRefetch && !dryRun) {
        const { count: deletedCount } = await supabase
          .from('amazon_fbm_orders')
          .delete({ count: 'exact' })
          .eq('user_id', userId)
          .in('status', ['pending', 'dry_run', 'error', 'manual_review', 'blocked_missing_pii', 'duplicate_detected', 'pending_payment'])
          .is('shopify_order_id', null)

        if (deletedCount && deletedCount > 0) {
          console.log('fbm_force_refetch_cleaned', { deleted: deletedCount })
          await logEvent(supabase, userId, 'fbm_force_refetch_cleaned', { deleted_count: deletedCount }, storeKey)
        }
      }

      // ─── Log poll started ─────────────────────────────────────
      const syncMode = dryRun ? 'dry_run' : (isCron ? 'cron' : 'manual')
      await logEvent(supabase, userId, 'fbm_poll_started', { dry_run: dryRun, mode: syncMode, force_refetch: forceRefetch }, storeKey)

      // ─── Compute polling window ────────────────────────────────
      let lastUpdatedAfter: string
      if (forceRefetch || dryRun) {
        // Manual re-sync: always use 7-day lookback to catch all recent orders
        lastUpdatedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      } else {
        const lastPollAt = await readSetting(supabase, userId, `fbm:${storeKey}:last_poll_at`)
        if (lastPollAt) {
          const dt = new Date(lastPollAt)
          dt.setMinutes(dt.getMinutes() - 2) // 2 minute buffer
          lastUpdatedAfter = dt.toISOString()
        } else {
          lastUpdatedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        }
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
      const tokenStillValid = accessToken && !isTokenExpired(tokenRow.expires_at)

      if (!tokenStillValid) {
        // Refresh the token — mirrors amazon-auth refresh logic exactly
        const refreshResponse = await fetch(LWA.TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: LWA.GRANT_TYPES.REFRESH_TOKEN,
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

      const baseUrl = getEndpointForRegion(region)

      // ─── Poll Amazon Orders API v2026-01-01 ──────────────────
      // Only fetch actionable statuses: Unshipped and PartiallyShipped.
      // Shipped orders need no FBM action. Pending orders have no item data
      // accessible via SP-API until payment clears.
      const ordersParamsBase = new URLSearchParams({
        marketplaceIds: marketplace_id,
        fulfillmentChannels: 'MFN',
        orderStatuses: 'Unshipped,PartiallyShipped',
        lastUpdatedAfter: lastUpdatedAfter,
        includedData: 'BUYER,RECIPIENT',
        maxResultsPerPage: '100',
      })

      console.log('fbm_orders_request', {
        marketplace_id,
        region,
        lastUpdatedAfter,
        api_version: API_VERSIONS.orders.current,
        max_results_per_page: 100,
        statuses: 'Unshipped,PartiallyShipped',
      })

      const allOrders: any[] = []
      let nextPaginationToken: string | null = null
      let pagesFetched = 0
      const MAX_ORDER_PAGES = 10

      do {
        const pageParams = new URLSearchParams(ordersParamsBase.toString())
        if (nextPaginationToken) {
          pageParams.set('paginationToken', nextPaginationToken)
        }

        const ordersUrl = `${baseUrl}/orders/${API_VERSIONS.orders.current}/orders?${pageParams.toString()}`
        console.log('fbm_orders_page_request', {
          page: pagesFetched + 1,
          has_pagination_token: !!nextPaginationToken,
          url: ordersUrl,
        })

        let ordersResponse: Response
        try {
          ordersResponse = await fetch(ordersUrl, {
            headers: getSpApiHeaders(accessToken),
          })
        } catch (fetchErr) {
          console.error('fbm_orders_fetch_failed', fetchErr)
          throw fetchErr
        }

        if (!ordersResponse.ok) {
          const errText = await ordersResponse.text()
          console.error('fbm_orders_api_error', { status: ordersResponse.status, body: errText, page: pagesFetched + 1 })
          throw new Error(`Amazon Orders API v2026-01-01 failed: ${ordersResponse.status} ${errText}`)
        }

        const ordersData = await ordersResponse.json()
        const pageOrders = ordersData?.orders || ordersData?.Orders || ordersData?.payload?.Orders || []
        allOrders.push(...pageOrders)

        nextPaginationToken = ordersData?.pagination?.nextToken || null
        pagesFetched += 1

        console.log('fbm_orders_page_received', {
          page: pagesFetched,
          page_order_count: pageOrders.length,
          accumulated_order_count: allOrders.length,
          has_next_page: !!nextPaginationToken,
        })

        if (pagesFetched >= MAX_ORDER_PAGES && nextPaginationToken) {
          await logEvent(supabase, userId, 'fbm_orders_page_limit_reached', {
            pages_fetched: pagesFetched,
            accumulated_order_count: allOrders.length,
            has_more_pages: true,
          }, storeKey, undefined, 'warn')
          break
        }
      } while (nextPaginationToken)

      // Orders API returns inline order payloads; process newest updates first
      let orders = [...allOrders]
      orders.sort((a: any, b: any) => {
        const aTime = new Date(a?.lastUpdatedTime || a?.createdTime || 0).getTime()
        const bTime = new Date(b?.lastUpdatedTime || b?.createdTime || 0).getTime()
        return bTime - aTime
      })

      // Log PII access status from first order (to detect role-based access)
      if (orders.length > 0) {
        const sampleOrder = orders[0]
        const samplePii = extractPiiFromOrder(sampleOrder)
        const hasBuyer = !!samplePii.buyerName
        const hasRecipient = !!samplePii.recipientName
        console.log('fbm_pii_role_check', {
          api_version: '2026-01-01',
          buyer_info_present: hasBuyer,
          shipping_address_present: hasRecipient,
          sample_order_id: getAmazonOrderId(sampleOrder),
        })
        if (!hasBuyer && !hasRecipient) {
          await logEvent(supabase, userId, 'fbm_pii_access_missing', {
            api_version: '2026-01-01',
            message: 'PII fields absent in v2026-01-01 response. SP-API roles (Direct-to-Consumer Delivery, Tax Invoicing) may not be granted yet. Orders will continue without PII.',
          }, storeKey, undefined, 'warn')
        }
      }

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

      // ─── Batch pre-load all product_links for this user ─────────
      // This eliminates per-order DB lookups and enables early filtering
      const { data: allLinks } = await supabase
        .from('product_links')
        .select('amazon_sku, shopify_variant_id, shopify_sku')
        .eq('user_id', userId)
        .eq('enabled', true)

      const globalSkuMap = new Map((allLinks || []).map((m: any) => [m.amazon_sku, m]))
      console.log('fbm_sku_map_preloaded', { total_linked_skus: globalSkuMap.size })

      // Get Shopify token via client_credentials flow (Dev Dashboard app)
      let shopifyToken: ShopifyInternalToken | null = null
      try {
        shopifyToken = await getShopifyInternalToken()
      } catch (tokenErr: any) {
        logger.error('fbm_shopify_token_error', tokenErr.message)
        // Will be checked per-order below
      }

      // Get financial status setting
      const financialStatus = (await readSetting(supabase, userId, `fbm:${storeKey}:shopify_financial_status`)) || 'paid'

      for (const order of orders) {
        const amazonOrderId = getAmazonOrderId(order)
        if (!amazonOrderId) continue

        // ─── Per-order status safety gate: filter out already-fulfilled orders ──
        // The bulk API requests Unshipped/PartiallyShipped, but orders can transition
        // between the poll and processing. This gate catches any that slipped through.
        const orderStatus = getAmazonOrderStatus(order)
        if (orderStatus === 'Shipped' || orderStatus === 'Canceled') {
          await logEvent(supabase, userId, 'fbm_order_skipped_already_fulfilled', {
            amazon_status: orderStatus,
            reason: `Order is ${orderStatus} on Amazon — not actionable`,
          }, storeKey, amazonOrderId)
          skippedCount++
          continue
        }

        // ─── Stale order check: flag orders last updated >7 days ago ──
        // If an order has been "Unshipped" for over 7 days, something unusual
        // may have happened. Flag for manual review rather than auto-creating.
        const lastUpdatedTime = order?.lastUpdatedTime || order?.LastUpdatedDate || null
        if (lastUpdatedTime && (orderStatus === 'Unshipped' || orderStatus === 'PartiallyShipped')) {
          const lastUpdated = new Date(lastUpdatedTime)
          const ageMs = Date.now() - lastUpdated.getTime()
          const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
          if (ageMs > SEVEN_DAYS) {
            // Check if already exists and is in manual_review — don't duplicate
            const { data: existingStale } = await supabase
              .from('amazon_fbm_orders')
              .select('id, status')
              .eq('user_id', userId)
              .eq('amazon_order_id', amazonOrderId)
              .maybeSingle()

            if (existingStale?.status === 'manual_review') {
              skippedCount++
              continue
            }

            // Insert or update as manual_review
            if (existingStale) {
              await supabase.from('amazon_fbm_orders').update({
                status: 'manual_review',
                error_detail: `Order last updated ${Math.round(ageMs / (24 * 60 * 60 * 1000))} days ago but still ${orderStatus} — flagged for review`,
              } as any).eq('id', existingStale.id)
            } else {
              await supabase.from('amazon_fbm_orders').insert({
                user_id: userId,
                amazon_order_id: amazonOrderId,
                status: 'manual_review',
                error_detail: `Order last updated ${Math.round(ageMs / (24 * 60 * 60 * 1000))} days ago but still ${orderStatus} — flagged for review`,
                raw_amazon_payload: order,
              } as any)
            }
            await logEvent(supabase, userId, 'fbm_order_stale_flagged', {
              amazon_status: orderStatus,
              last_updated: lastUpdatedTime,
              age_days: Math.round(ageMs / (24 * 60 * 60 * 1000)),
              reason: 'Unshipped for >7 days — flagged for manual review',
            }, storeKey, amazonOrderId, 'warn')
            manualReviewCount++
            continue
          }
        }

        // ─── Early SKU pre-filter: skip orders with no mapped SKUs BEFORE any DB writes ──
        // If order has inline items, check them against the pre-loaded map immediately
        const inlineItems = Array.isArray(order?.orderItems) ? order.orderItems : []
        if (inlineItems.length > 0) {
          const inlineSkus = inlineItems.map((item: any) => getOrderItemSku(item)).filter(Boolean)
          const hasAnyMapped = inlineSkus.some((sku: string) => globalSkuMap.has(sku))
          if (!hasAnyMapped) {
            // Pure FBA order — skip entirely without DB insert or API call
            skippedCount++
            continue
          }
        }

        // Check if already exists — allow re-processing of unsynced orders
        const { data: existing } = await supabase
          .from('amazon_fbm_orders')
          .select('id, shopify_order_id, status, created_at')
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

          // ─── Auto-expire stale pending_payment orders ──────────
          if (existing.status === 'pending_payment') {
            const amazonOrderStatus = order.orderStatus || order.OrderStatus || ''

            // Amazon cancelled the order
            if (amazonOrderStatus === 'Canceled') {
              await supabase.from('amazon_fbm_orders').update({
                status: 'cancelled',
                error_detail: 'Order was cancelled by Amazon during payment verification',
              } as any).eq('id', existing.id)
              await logEvent(supabase, userId, 'fbm_order_amazon_cancelled', { amazon_status: amazonOrderStatus }, storeKey, amazonOrderId)
              skippedCount++
              continue
            }

            // Still Pending after 24 hours — auto-expire
            if (amazonOrderStatus === 'Pending') {
              const createdAt = new Date(existing.created_at || Date.now())
              const ageMs = Date.now() - createdAt.getTime()
              const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
              if (ageMs > TWENTY_FOUR_HOURS) {
                await supabase.from('amazon_fbm_orders').update({
                  status: 'cancelled',
                  error_detail: 'Order remained in Pending status for over 24 hours — likely cancelled by Amazon',
                } as any).eq('id', existing.id)
                await logEvent(supabase, userId, 'fbm_order_payment_timeout', {
                  age_hours: Math.round(ageMs / (60 * 60 * 1000)),
                  amazon_status: amazonOrderStatus,
                }, storeKey, amazonOrderId, 'warn')
                skippedCount++
                continue
              }
              // Still within 24h window — leave as pending_payment
              skippedCount++
              continue
            }

            // Order moved to Unshipped/PartiallyShipped/Shipped — delete old row and re-process with full PII
            console.log('fbm_pending_payment_resolved', { amazonOrderId, newStatus: amazonOrderStatus })
            await supabase.from('amazon_fbm_orders').delete().eq('id', existing.id)
            await logEvent(supabase, userId, 'fbm_pending_payment_resolved', { new_amazon_status: amazonOrderStatus }, storeKey, amazonOrderId)
            // Fall through to re-process below
          } else {
            // Unsynced (pending, failed, manual_review, dry_run) — delete old row and re-process
            console.log('fbm_reprocessing_order', { amazonOrderId, previousStatus: existing.status })
            await supabase.from('amazon_fbm_orders').delete().eq('id', existing.id)
            await logEvent(supabase, userId, 'fbm_reprocessing_order', { previous_status: existing.status }, storeKey, amazonOrderId)
          }
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

        // ─── Use inline order payload first; fall back to detail fetch only if needed ──
        let orderDetail = order
        let orderItems = Array.isArray(order?.orderItems) ? order.orderItems : []

        if (orderItems.length === 0) {
          const detailUrl = `${baseUrl}/orders/${API_VERSIONS.orders.current}/orders/${amazonOrderId}?includedData=BUYER,RECIPIENT`
          const detailResponse = await fetch(detailUrl, {
            headers: getSpApiHeaders(accessToken),
          })

          if (!detailResponse.ok) {
            const errText = await detailResponse.text()
            await supabase.from('amazon_fbm_orders').update({
              status: 'failed',
              error_detail: `Order detail fetch failed (v2026-01-01): ${detailResponse.status} ${errText}`,
            } as any).eq('id', insertedOrder.id)
            await logEvent(supabase, userId, 'fbm_order_failed', { error: errText, api_version: '2026-01-01' }, storeKey, amazonOrderId, 'error')
            failedCount++
            continue
          }

          const detailData = await detailResponse.json()
          orderDetail = detailData || orderDetail
          orderItems = Array.isArray(orderDetail?.orderItems) ? orderDetail.orderItems : []
        }

        // ─── OrderItems debug logging ────────────────────────────
        const itemSkus = orderItems.map((item: any) => ({
          SellerSKU: getOrderItemSku(item),
          ASIN: getOrderItemAsin(item),
          QuantityOrdered: getOrderItemQuantity(item),
        }))
        console.log('fbm_order_items', { amazonOrderId, order_items_count: orderItems.length, items: itemSkus })

        await logEvent(supabase, userId, 'fbm_order_items_fetched', {
          order_items_count: orderItems.length,
          items: itemSkus,
        }, storeKey, amazonOrderId)

        // Safety: empty order items even after fallback detail fetch
        if (orderItems.length === 0) {
          await supabase.from('amazon_fbm_orders').update({
            status: 'manual_review',
            error_detail: 'no_order_items',
            raw_amazon_payload: { ...orderDetail, api_version: '2026-01-01' },
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_order_no_items', {}, storeKey, amazonOrderId, 'warn')
          manualReviewCount++
          continue
        }

        // Map SKUs via pre-loaded product_links (no per-order DB query)
        const skus = orderItems.map((item: any) => getOrderItemSku(item)).filter(Boolean)
        console.log('fbm_sku_lookup', { amazonOrderId, skus_to_match: skus })

        const mappingMap = globalSkuMap
        const unmappedSkus = skus.filter((sku: string) => !mappingMap.has(sku))
        const matchedSkus = skus.filter((sku: string) => mappingMap.has(sku)).map((sku: string) => ({
          amazon_sku: sku,
          shopify_variant_id: mappingMap.get(sku)?.shopify_variant_id,
        }))

        console.log('fbm_sku_mapping_result', { amazonOrderId, matched: matchedSkus, unmapped: unmappedSkus })

        // ─── Extract PII from v2026-01-01 order (role-based, no RDT) ──
        const pii = extractPiiFromOrder(orderDetail)
        const { missingRequiredFields, missingWarningFields } = pii

        console.log('fbm_pii_extract', {
          amazonOrderId,
          api_version: '2026-01-01',
          pii_present: pii.piiPresent,
          recipient_name: pii.recipientName || 'none',
          buyer_name: pii.buyerName || 'none',
          missing_required: missingRequiredFields,
          missing_warnings: missingWarningFields,
        })

        // Store debug details on order record
        await supabase.from('amazon_fbm_orders').update({
          raw_amazon_payload: {
            ...orderDetail,
            api_version: '2026-01-01',
            orderItems: itemSkus,
            matched_skus: matchedSkus,
            unmapped_skus: unmappedSkus,
            pii_extracted: pii,
            missing_required_fields: missingRequiredFields,
            missing_warning_fields: missingWarningFields,
          },
        } as any).eq('id', insertedOrder.id)

        // ─── SKU filtering: only process orders with at least one mapped SKU ──
        // Unmapped SKUs are assumed to be FBA-fulfilled and intentionally not linked.
        // Orders with zero matched SKUs are silently skipped (not errors).
        if (matchedSkus.length === 0) {
          // No linked products in this order — pure FBA order, not our concern
          await logEvent(supabase, userId, 'fbm_order_skipped_fba', {
            skipped_skus: unmappedSkus,
            reason: 'No mapped SKUs — assumed FBA-fulfilled',
          }, storeKey, amazonOrderId)
          await supabase.from('amazon_fbm_orders').delete().eq('id', insertedOrder.id)
          skippedCount++
          continue
        }

        // Filter orderItems down to only the mapped SKUs for Shopify order creation
        const mappedOrderItems = orderItems.filter((item: any) => {
          const sku = getOrderItemSku(item)
          return sku && mappingMap.has(sku)
        })

        // ─── Dry run check ──────────────────────────────────────
        if (dryRun) {
          const hasPii = pii.piiPresent
          const dryRunSummary = hasPii
            ? `Dry run OK. ${matchedSkus.length} SKU(s) matched. Buyer PII available.`
            : `Dry run OK. ${matchedSkus.length} SKU(s) matched. No PII — will use placeholder customer.`
          await supabase.from('amazon_fbm_orders').update({
            status: 'dry_run',
            error_detail: dryRunSummary,
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_dry_run_skipped_create', {
            matched_skus: matchedSkus.length,
            pii_available: hasPii,
          }, storeKey, amazonOrderId)
          continue
        }

        // ─── Order status revalidation: re-fetch individual order ──
        // The bulk listing API can return stale data (e.g., recently shipped
        // orders still appearing as Unshipped). Before creating a Shopify
        // order, confirm the order is genuinely still actionable.
        const VALID_FBM_STATUSES = ['Unshipped', 'PartiallyShipped']
        const revalidateUrl = `${baseUrl}/orders/${API_VERSIONS.orders.current}/orders/${amazonOrderId}`
        try {
          const revalResponse = await fetch(revalidateUrl, {
            headers: getSpApiHeaders(accessToken),
          })
          if (revalResponse.ok) {
            const revalData = await revalResponse.json()
            const currentStatus = revalData?.orderStatus || revalData?.OrderStatus || ''
            if (currentStatus && !VALID_FBM_STATUSES.includes(currentStatus)) {
              console.log('fbm_order_status_stale', {
                amazonOrderId,
                bulk_status: getAmazonOrderStatus(order),
                revalidated_status: currentStatus,
              })
              await supabase.from('amazon_fbm_orders').delete().eq('id', insertedOrder.id)
              await logEvent(supabase, userId, 'fbm_order_stale_status', {
                bulk_status: getAmazonOrderStatus(order),
                current_status: currentStatus,
                reason: 'Order status changed between bulk fetch and revalidation',
              }, storeKey, amazonOrderId, 'info')
              skippedCount++
              continue
            }
          } else {
            console.warn('fbm_revalidation_failed', { amazonOrderId, status: revalResponse.status })
            // Fail open — proceed with order creation if revalidation fails
          }
        } catch (revalErr: any) {
          console.warn('fbm_revalidation_error', { amazonOrderId, error: revalErr.message })
          // Fail open
        }

        // ─── Safety gate: block only Amazon Pending orders (payment not yet confirmed) ──
        // PII is no longer required — we use placeholder customer data for Shopify orders.
        const amazonOrderStatus = getAmazonOrderStatus(order)
        if (amazonOrderStatus === 'Pending') {
          await supabase.from('amazon_fbm_orders').update({
            status: 'pending_payment',
            error_detail: 'Order is still in Pending status on Amazon — waiting for payment confirmation',
          } as any).eq('id', insertedOrder.id)
          await logEvent(supabase, userId, 'fbm_order_pending_payment', {
            amazon_status: amazonOrderStatus,
            api_version: '2026-01-01',
          }, storeKey, amazonOrderId)
          skippedCount++
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

        // ─── Shopify duplicate detection (other apps like CedCommerce) ──
        const dedupEnabled = (await readSetting(supabase, userId, `fbm:${storeKey}:dedup_check_enabled`)) !== 'false' // default ON
        if (dedupEnabled && shopifyToken) {
          const existingShopifyId = await checkShopifyDuplicate(shopifyToken, amazonOrderId)
          if (existingShopifyId) {
            await supabase.from('amazon_fbm_orders').update({
              status: 'duplicate_detected',
              shopify_order_id: existingShopifyId,
              error_detail: `Existing Shopify order found (likely created by another app). Shopify GID: ${existingShopifyId}`,
            } as any).eq('id', insertedOrder.id)
            await logEvent(supabase, userId, 'fbm_duplicate_shopify_detected', {
              existing_shopify_gid: existingShopifyId,
              detection_method: 'graphql_search',
            }, storeKey, amazonOrderId, 'warn')
            skippedCount++
            continue
          }
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

        // PII already extracted above (pii object), use it for Shopify payload

        // Build Shopify order payload — v2026-01-01 field mapping
        const lineItems = mappedOrderItems.map((item: any) => {
          const sku = getOrderItemSku(item)
          const mapping = sku ? mappingMap.get(sku) : null
          return {
            variant_id: mapping!.shopify_variant_id,
            quantity: getOrderItemQuantity(item),
            price: getOrderItemPrice(item),
            title: getOrderItemTitle(item),
          }
        })

        // Map shipping address from v2026-01-01 PII extraction
        const shippingAddress = pii.addressLine1 ? {
          first_name: pii.recipientName?.split(' ')[0] || 'Amazon',
          last_name: pii.recipientName?.split(' ').slice(1).join(' ') || 'FBM Customer',
          address1: pii.addressLine1 || '',
          address2: pii.addressLine2 || '',
          city: pii.city || '',
          province: pii.stateOrRegion || '',
          zip: pii.postalCode || '',
          country: pii.countryCode || 'AU',
          phone: pii.phone || '',
        } : {
          // Placeholder address when PII not available
          first_name: 'Amazon',
          last_name: 'FBM Customer',
          address1: 'See Amazon Seller Central',
          city: 'N/A',
          province: '',
          zip: '0000',
          country: 'AU',
        }

        // Extract customer info — use placeholder if PII unavailable
        const buyerName = pii.recipientName || pii.buyerName || ''
        const buyerEmail = pii.buyerEmail || null
        const customer = buyerName ? {
          first_name: buyerName.split(' ')[0] || '',
          last_name: buyerName.split(' ').slice(1).join(' ') || '',
          ...(buyerEmail ? { email: buyerEmail } : {}),
        } : {
          first_name: 'Amazon',
          last_name: 'FBM Customer',
        }

        const shopifyPayload = {
          order: {
            line_items: lineItems,
            shipping_address: shippingAddress,
            billing_address: shippingAddress,
            customer,
            financial_status: financialStatus,
            fulfillment_status: 'unfulfilled',
            tags: `amazon-fbm,xettle-bridge${pii.piiPresent ? '' : ',placeholder-customer'}`,
            source_name: 'amazon',
            note: `Amazon FBM Order: ${amazonOrderId}${pii.piiPresent ? '' : ' (placeholder customer — see Amazon Seller Central for buyer details)'}`,
          },
        }

        const shopifyUrl = `https://${shopifyToken.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json`

        try {
          console.log('fbm_shopify_create', { amazonOrderId, shopifyUrl, lineItemCount: lineItems.length })

          const shopifyResponse = await fetch(shopifyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': shopifyToken.access_token,
            },
            body: JSON.stringify(shopifyPayload),
          })

          console.log('fbm_shopify_response', { amazonOrderId, status: shopifyResponse.status, ok: shopifyResponse.ok })

          if (shopifyResponse.ok) {
            const shopifyData = await shopifyResponse.json()
            const shopifyOrderId = shopifyData?.order?.id
            console.log('fbm_shopify_created', { amazonOrderId, shopifyOrderId })

            await supabase.from('amazon_fbm_orders').update({
              status: 'created',
              shopify_order_id: shopifyOrderId,
              raw_shopify_payload: shopifyData,
              processed_at: new Date().toISOString(),
            } as any).eq('id', insertedOrder.id)

            // Log appropriate event based on whether this was a partial or full match
            if (unmappedSkus.length > 0) {
              await logEvent(supabase, userId, 'fbm_partial_order_created', {
                shopify_order_id: shopifyOrderId,
                included_skus: matchedSkus,
                skipped_skus: unmappedSkus,
                reason: 'Unmapped SKUs assumed FBA-fulfilled, excluded from Shopify order',
              }, storeKey, amazonOrderId)
            } else {
              await logEvent(supabase, userId, 'fbm_order_created', {
                shopify_order_id: shopifyOrderId,
                all_skus_mapped: true,
              }, storeKey, amazonOrderId)
            }

            // Explicit shopify_order_created event for dashboard visibility
            await logEvent(supabase, userId, 'shopify_order_created', {
              shopify_order_id: shopifyOrderId,
              source: 'fbm_sync',
              partial: unmappedSkus.length > 0,
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
      const completedMode = dryRun ? 'dry_run' : (isCron ? 'cron' : 'manual')
      await logEvent(supabase, userId, 'fbm_poll_completed', {
        total_orders: orders.length,
        pages_fetched: pagesFetched,
        created_count: createdCount,
        manual_review_count: manualReviewCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        dry_run: dryRun,
        mode: completedMode,
        force_refetch: forceRefetch,
      }, storeKey)

      return new Response(JSON.stringify({
        status: 'completed',
        orders_found: orders.length,
        matched: createdCount + manualReviewCount,
        unmatched: skippedCount,
        total_orders: orders.length,
        pages_fetched: pagesFetched,
        created_count: createdCount,
        manual_review_count: manualReviewCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        dry_run: dryRun,
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
    console.error(`[sync-amazon-fbm] Unhandled error: ${err.message}`)

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
