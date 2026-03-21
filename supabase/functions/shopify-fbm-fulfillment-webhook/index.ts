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
import { verifyShopifyWebhookHmac } from '../_shared/shopify-hmac.ts'

// ═══════════════════════════════════════════════════════════════
// shopify-fbm-fulfillment-webhook
// Receives Shopify orders/fulfilled webhook, looks up the matching
// amazon_fbm_orders row, and pushes tracking to Amazon confirmShipment.
// ═══════════════════════════════════════════════════════════════

// NOTE: confirmShipment requires the "Direct-to-Consumer Delivery" 
// restricted role. This function will log errors gracefully if the 
// role hasn't been approved yet.

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') ?? ''
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    const rawBody = await req.text()
    const parsedBody = JSON.parse(rawBody)

    // ── Manual retry path ──────────────────────────────────────
    // Called from UI: { manual_retry: true, amazon_order_id: "..." }
    if (parsedBody?.manual_retry === true) {
      return await handleManualRetry(parsedBody, headers)
    }

    // ── Shopify webhook path ───────────────────────────────────
    // Verify Shopify HMAC signature
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256') || ''
    const shopifySecret = Deno.env.get('SHOPIFY_CLIENT_SECRET') || ''

    if (shopifySecret && hmacHeader) {
      const isValid = await verifyShopifyWebhookHmac(rawBody, hmacHeader, shopifySecret)
      if (!isValid) {
        logger.warn('fbm_webhook_hmac_invalid', { hmac: hmacHeader.substring(0, 8) })
        return new Response(JSON.stringify({ error: 'Invalid HMAC signature' }), { status: 401, headers })
      }
    } else if (!hmacHeader) {
      logger.warn('fbm_webhook_no_hmac', { reason: 'Missing x-shopify-hmac-sha256 header' })
      // Allow through for now but log — Shopify always sends HMAC on real webhooks
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Parse webhook payload
    const payload = JSON.parse(rawBody)
    const shopifyOrderId = payload?.id || payload?.order_id
    
    if (!shopifyOrderId) {
      logger.warn('fbm_webhook_no_order_id', payload)
      return new Response(JSON.stringify({ status: 'ignored', reason: 'no_order_id' }), { status: 200, headers })
    }

    logger.info('fbm_fulfillment_webhook_received', { shopify_order_id: shopifyOrderId })

    // Look up matching amazon_fbm_orders row (include shipping_service_level for confirmShipment)
    const { data: fbmOrder, error: lookupErr } = await supabase
      .from('amazon_fbm_orders')
      .select('id, amazon_order_id, user_id, status, shipping_service_level')
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle()

    if (lookupErr) {
      logger.error('fbm_webhook_lookup_error', lookupErr.message)
      return new Response(JSON.stringify({ status: 'error', error: lookupErr.message }), { status: 500, headers })
    }

    if (!fbmOrder) {
      // Not an FBM-bridge order — ignore
      return new Response(JSON.stringify({ status: 'ignored', reason: 'not_fbm_order' }), { status: 200, headers })
    }

    if (fbmOrder.status === 'tracking_sent') {
      return new Response(JSON.stringify({ status: 'already_sent' }), { status: 200, headers })
    }

    // Extract tracking from fulfillment
    const fulfillments = payload?.fulfillments || []
    const fulfillment = fulfillments[0]
    if (!fulfillment) {
      logger.warn('fbm_webhook_no_fulfillment', { shopify_order_id: shopifyOrderId })
      return new Response(JSON.stringify({ status: 'ignored', reason: 'no_fulfillment_data' }), { status: 200, headers })
    }

    const trackingNumber = fulfillment.tracking_number || null
    const trackingCompany = fulfillment.tracking_company || 'Australia Post'

    if (!trackingNumber) {
      logger.warn('fbm_webhook_no_tracking', { shopify_order_id: shopifyOrderId })
      await supabase.from('system_events').insert({
        user_id: fbmOrder.user_id,
        event_type: 'fbm_tracking_missing',
        severity: 'warn',
        details: {
          amazon_order_id: fbmOrder.amazon_order_id,
          shopify_order_id: shopifyOrderId,
          reason: 'Shopify fulfillment has no tracking number',
        },
      } as any)
      return new Response(JSON.stringify({ status: 'skipped', reason: 'no_tracking_number' }), { status: 200, headers })
    }

    // Get Amazon token for this user
    const { data: tokenRow } = await supabase
      .from('amazon_tokens')
      .select('*')
      .eq('user_id', fbmOrder.user_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!tokenRow) {
      logger.error('fbm_webhook_no_amazon_token', { user_id: fbmOrder.user_id })
      await logTrackingEvent(supabase, fbmOrder, 'fbm_tracking_failed', {
        error: 'No Amazon token found',
        shopify_order_id: shopifyOrderId,
        tracking_number: trackingNumber,
      })
      return new Response(JSON.stringify({ status: 'error', error: 'no_amazon_token' }), { status: 500, headers })
    }

    // Refresh token if expired
    let accessToken = tokenRow.access_token
    if (!accessToken || isTokenExpired(tokenRow.expires_at)) {
      const AMAZON_CLIENT_ID = Deno.env.get('AMAZON_SP_CLIENT_ID')
      const AMAZON_CLIENT_SECRET = Deno.env.get('AMAZON_SP_CLIENT_SECRET')
      if (!AMAZON_CLIENT_ID || !AMAZON_CLIENT_SECRET) {
        throw new Error('Missing AMAZON_SP_CLIENT_ID or AMAZON_SP_CLIENT_SECRET')
      }

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
        logger.error('fbm_webhook_token_refresh_failed', refreshData)
        await logTrackingEvent(supabase, fbmOrder, 'fbm_tracking_failed', {
          error: 'Amazon token refresh failed',
          shopify_order_id: shopifyOrderId,
        })
        return new Response(JSON.stringify({ status: 'error', error: 'token_refresh_failed' }), { status: 500, headers })
      }

      const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString()
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

    // Map carrier name to Amazon carrier code
    const carrierCode = mapCarrierToAmazonCode(trackingCompany)

    // Call Amazon confirmShipment
    const region = tokenRow.region || 'fe'
    const baseUrl = getEndpointForRegion(region)
    const confirmUrl = `${baseUrl}/orders/${API_VERSIONS.orders.current}/orders/${fbmOrder.amazon_order_id}/shipment/confirm`

    // Use stored shipping service level instead of hardcoded 'Standard'
    const shippingMethod = fbmOrder.shipping_service_level || 'Standard'

    const confirmPayload = {
      marketplaceId: tokenRow.marketplace_id,
      packageDetail: {
        trackingNumber: trackingNumber,
        carrierCode: carrierCode,
        carrierName: trackingCompany,
        shippingMethod,
      },
    }

    logger.info('fbm_confirm_shipment_request', {
      amazon_order_id: fbmOrder.amazon_order_id,
      tracking_number: trackingNumber,
      carrier: carrierCode,
    })

    const confirmResponse = await fetch(confirmUrl, {
      method: 'POST',
      headers: {
        ...getSpApiHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(confirmPayload),
    })

    if (confirmResponse.ok || confirmResponse.status === 204) {
      // Success — update status
      await supabase.from('amazon_fbm_orders').update({
        status: 'tracking_sent',
        error_detail: `Tracking ${trackingNumber} sent to Amazon (${carrierCode})`,
      } as any).eq('id', fbmOrder.id)

      await logTrackingEvent(supabase, fbmOrder, 'fbm_tracking_sent', {
        tracking_number: trackingNumber,
        carrier: carrierCode,
        shopify_order_id: shopifyOrderId,
      })

      logger.info('fbm_confirm_shipment_success', { amazon_order_id: fbmOrder.amazon_order_id })
      return new Response(JSON.stringify({ status: 'tracking_sent' }), { status: 200, headers })
    } else {
      const errText = await confirmResponse.text()
      logger.error('fbm_confirm_shipment_failed', {
        status: confirmResponse.status,
        body: errText,
        amazon_order_id: fbmOrder.amazon_order_id,
      })

      await logTrackingEvent(supabase, fbmOrder, 'fbm_tracking_failed', {
        tracking_number: trackingNumber,
        carrier: carrierCode,
        shopify_order_id: shopifyOrderId,
        error: `Amazon ${confirmResponse.status}: ${errText}`,
      })

      // Don't update status — leave as 'created' for retry
      return new Response(JSON.stringify({
        status: 'error',
        error: `confirmShipment failed: ${confirmResponse.status}`,
      }), { status: 200, headers }) // 200 to Shopify so it doesn't retry
    }

  } catch (err: any) {
    logger.error('fbm_fulfillment_webhook_error', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req.headers.get('Origin') ?? ''), 'Content-Type': 'application/json' },
    })
  }
})

// ═══════════════════════════════════════════════════════════════
// Manual retry handler: look up the FBM order, fetch fulfillment
// from Shopify API, then push tracking to Amazon confirmShipment.
// ═══════════════════════════════════════════════════════════════
async function handleManualRetry(
  body: { amazon_order_id?: string; fbm_order_id?: string },
  headers: Record<string, string>,
): Promise<Response> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Find the FBM order (includes shipping_service_level)
  let query = supabase.from('amazon_fbm_orders').select('*')
  if (body.fbm_order_id) {
    query = query.eq('id', body.fbm_order_id)
  } else if (body.amazon_order_id) {
    query = query.eq('amazon_order_id', body.amazon_order_id)
  } else {
    return new Response(JSON.stringify({ error: 'Need amazon_order_id or fbm_order_id' }), { status: 400, headers })
  }

  const { data: fbmOrder, error: lookupErr } = await query.maybeSingle()
  if (lookupErr || !fbmOrder) {
    return new Response(JSON.stringify({ error: lookupErr?.message || 'FBM order not found' }), { status: 404, headers })
  }

  if (fbmOrder.status === 'tracking_sent') {
    return new Response(JSON.stringify({ status: 'already_sent' }), { status: 200, headers })
  }

  if (!fbmOrder.shopify_order_id) {
    return new Response(JSON.stringify({ error: 'Order not yet synced to Shopify (no shopify_order_id)' }), { status: 400, headers })
  }

  // Fetch fulfillment from Shopify
  const { data: tokenRow } = await supabase
    .from('shopify_tokens')
    .select('*')
    .eq('user_id', fbmOrder.user_id)
    .eq('status', 'Active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: 'No active Shopify token' }), { status: 500, headers })
  }

  const shopifyDomain = tokenRow.shop_domain
  const shopifyToken = tokenRow.access_token
  const fulfillmentsUrl = `https://${shopifyDomain}/admin/api/2024-01/orders/${fbmOrder.shopify_order_id}/fulfillments.json`

  const fulfillRes = await fetch(fulfillmentsUrl, {
    headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
  })

  if (!fulfillRes.ok) {
    const errText = await fulfillRes.text()
    logger.error('manual_retry_shopify_fetch_failed', { status: fulfillRes.status, body: errText })
    return new Response(JSON.stringify({ error: `Shopify fulfillments fetch failed: ${fulfillRes.status}` }), { status: 500, headers })
  }

  const fulfillData = await fulfillRes.json()
  const fulfillments = fulfillData?.fulfillments || []
  const fulfillment = fulfillments[0]

  if (!fulfillment) {
    return new Response(JSON.stringify({ error: 'No fulfillment found on this Shopify order — fulfill it first' }), { status: 400, headers })
  }

  const trackingNumber = fulfillment.tracking_number || null
  const trackingCompany = fulfillment.tracking_company || 'Australia Post'

  if (!trackingNumber) {
    return new Response(JSON.stringify({ error: 'Fulfillment exists but has no tracking number — add tracking in Shopify first' }), { status: 400, headers })
  }

  // Get Amazon token
  const { data: amazonToken } = await supabase
    .from('amazon_tokens')
    .select('*')
    .eq('user_id', fbmOrder.user_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!amazonToken) {
    return new Response(JSON.stringify({ error: 'No Amazon token found' }), { status: 500, headers })
  }

  // Refresh if expired
  let accessToken = amazonToken.access_token
  if (!accessToken || isTokenExpired(amazonToken.expires_at)) {
    const AMAZON_CLIENT_ID = Deno.env.get('AMAZON_SP_CLIENT_ID')
    const AMAZON_CLIENT_SECRET = Deno.env.get('AMAZON_SP_CLIENT_SECRET')
    if (!AMAZON_CLIENT_ID || !AMAZON_CLIENT_SECRET) {
      return new Response(JSON.stringify({ error: 'Missing Amazon SP credentials' }), { status: 500, headers })
    }

    const refreshResponse = await fetch(LWA.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: LWA.GRANT_TYPES.REFRESH_TOKEN,
        refresh_token: amazonToken.refresh_token,
        client_id: AMAZON_CLIENT_ID,
        client_secret: AMAZON_CLIENT_SECRET,
      }),
    })

    const refreshData = await refreshResponse.json()
    if (!refreshResponse.ok || !refreshData.access_token) {
      return new Response(JSON.stringify({ error: 'Amazon token refresh failed' }), { status: 500, headers })
    }

    const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString()
    await supabase.from('amazon_tokens').update({
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token || amazonToken.refresh_token,
      expires_at: newExpiresAt,
    }).eq('id', amazonToken.id)

    accessToken = refreshData.access_token
  }

  // Push to Amazon confirmShipment
  const carrierCode = mapCarrierToAmazonCode(trackingCompany)
  const region = amazonToken.region || 'fe'
  const baseUrl = getEndpointForRegion(region)
  const confirmUrl = `${baseUrl}/orders/${API_VERSIONS.orders.current}/orders/${fbmOrder.amazon_order_id}/shipment/confirm`

  const confirmPayload = {
    marketplaceId: amazonToken.marketplace_id,
    packageDetail: {
      trackingNumber,
      carrierCode,
      carrierName: trackingCompany,
      shippingMethod: 'Standard',
    },
  }

  logger.info('manual_retry_confirm_shipment', {
    amazon_order_id: fbmOrder.amazon_order_id,
    tracking_number: trackingNumber,
    carrier: carrierCode,
  })

  const confirmResponse = await fetch(confirmUrl, {
    method: 'POST',
    headers: { ...getSpApiHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(confirmPayload),
  })

  if (confirmResponse.ok || confirmResponse.status === 204) {
    await supabase.from('amazon_fbm_orders').update({
      status: 'tracking_sent',
      error_detail: `Tracking ${trackingNumber} sent to Amazon (${carrierCode}) via manual retry`,
    } as any).eq('id', fbmOrder.id)

    await logTrackingEvent(supabase, fbmOrder, 'fbm_tracking_sent', {
      tracking_number: trackingNumber,
      carrier: carrierCode,
      shopify_order_id: fbmOrder.shopify_order_id,
      method: 'manual_retry',
    })

    return new Response(JSON.stringify({ status: 'tracking_sent', tracking_number: trackingNumber, carrier: carrierCode }), { status: 200, headers })
  } else {
    const errText = await confirmResponse.text()
    logger.error('manual_retry_confirm_failed', { status: confirmResponse.status, body: errText })

    await logTrackingEvent(supabase, fbmOrder, 'fbm_tracking_failed', {
      tracking_number: trackingNumber,
      carrier: carrierCode,
      error: `Amazon ${confirmResponse.status}: ${errText}`,
      method: 'manual_retry',
    })

    return new Response(JSON.stringify({ error: `confirmShipment failed: ${confirmResponse.status}`, detail: errText }), { status: 200, headers })
  }
}

// Helper: log tracking event
async function logTrackingEvent(
  supabase: any,
  fbmOrder: any,
  eventType: string,
  details: Record<string, any>,
) {
  await supabase.from('system_events').insert({
    user_id: fbmOrder.user_id,
    event_type: eventType,
    severity: eventType.includes('failed') ? 'error' : 'info',
    details: {
      ...details,
      amazon_order_id: fbmOrder.amazon_order_id,
      source_marketplace: 'amazon',
      target_marketplace: 'shopify',
    },
  } as any)
}

// Helper: map common carrier names to Amazon carrier codes
function mapCarrierToAmazonCode(carrier: string): string {
  const normalized = (carrier || '').toLowerCase().trim()
  if (normalized.includes('australia post') || normalized.includes('auspost')) return 'AustraliaPost'
  if (normalized.includes('sendle')) return 'Sendle'
  if (normalized.includes('dhl')) return 'DHL'
  if (normalized.includes('fedex')) return 'FedEx'
  if (normalized.includes('ups')) return 'UPS'
  if (normalized.includes('tnt')) return 'TNT'
  if (normalized.includes('startrack') || normalized.includes('star track')) return 'StarTrack'
  if (normalized.includes('aramex') || normalized.includes('fastway')) return 'Aramex'
  if (normalized.includes('toll')) return 'Toll'
  if (normalized.includes('couriers please')) return 'CouriersPlease'
  if (normalized.includes('hunter express')) return 'HunterExpress'
  return 'Other'
}
