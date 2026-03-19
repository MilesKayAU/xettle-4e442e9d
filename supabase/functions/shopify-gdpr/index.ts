import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

/**
 * Shopify mandatory GDPR compliance webhooks.
 * Handles: customers/data_request, customers/redact, shop/redact
 * 
 * These are POST requests with JSON body.
 * HMAC is in the X-Shopify-Hmac-Sha256 header, computed over the raw body.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function verifyWebhookHmac(body: string, hmacHeader: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const computedBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))

  // Constant-time comparison via HMAC
  const keyData = crypto.getRandomValues(new Uint8Array(32))
  const compareKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', compareKey, encoder.encode(computedBase64)),
    crypto.subtle.sign('HMAC', compareKey, encoder.encode(hmacHeader)),
  ])
  const viewA = new Uint8Array(sigA)
  const viewB = new Uint8Array(sigB)
  if (viewA.length !== viewB.length) return false
  let result = 0
  for (let i = 0; i < viewA.length; i++) result |= viewA[i] ^ viewB[i]
  return result === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const rawBody = await req.text()
    const hmacHeader = req.headers.get('x-shopify-hmac-sha256')

    if (!hmacHeader) {
      console.error('Missing HMAC header')
      return new Response('Unauthorized', { status: 401 })
    }

    const isDev = Deno.env.get('SHOPIFY_DEV_MODE') === 'true'
    const secret = isDev
      ? Deno.env.get('SHOPIFY_DEV_CLIENT_SECRET')
      : Deno.env.get('SHOPIFY_CLIENT_SECRET')

    if (!secret) {
      console.error('Missing SHOPIFY_CLIENT_SECRET')
      return new Response('Server configuration error', { status: 500 })
    }

    const valid = await verifyWebhookHmac(rawBody, hmacHeader, secret)
    if (!valid) {
      console.error('HMAC verification failed for GDPR webhook')
      return new Response('Unauthorized', { status: 401 })
    }

    const payload = JSON.parse(rawBody)
    const url = new URL(req.url)
    // Determine the topic from the X-Shopify-Topic header or URL path
    const topic = req.headers.get('x-shopify-topic') || url.searchParams.get('topic') || 'unknown'

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    console.log('GDPR webhook received:', { topic, shop_domain: payload.shop_domain })

    if (topic === 'customers/data_request') {
      // Xettle does not store end-customer personal data from Shopify.
      // Acknowledge the request and log it.
      await supabaseAdmin.from('system_events').insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        event_type: 'shopify_gdpr_customer_data_request',
        severity: 'info',
        marketplace_code: 'shopify',
        details: {
          shop_domain: payload.shop_domain,
          customer_id: payload.customer?.id,
          data_request_id: payload.data_request?.id,
          note: 'Xettle does not store end-customer personal data from Shopify',
        },
      })

      return new Response(JSON.stringify({ message: 'No customer data stored' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (topic === 'customers/redact') {
      // Xettle does not store end-customer personal data.
      // Acknowledge and log.
      await supabaseAdmin.from('system_events').insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        event_type: 'shopify_gdpr_customer_redact',
        severity: 'info',
        marketplace_code: 'shopify',
        details: {
          shop_domain: payload.shop_domain,
          customer_id: payload.customer?.id,
          note: 'Xettle does not store end-customer personal data from Shopify',
        },
      })

      return new Response(JSON.stringify({ message: 'No customer data to redact' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (topic === 'shop/redact') {
      // Delete ALL data for this shop: tokens, orders, settings
      const shopDomain = payload.shop_domain

      // Find user(s) with this shop
      const { data: tokens } = await supabaseAdmin
        .from('shopify_tokens')
        .select('user_id')
        .eq('shop_domain', shopDomain)

      const userIds = tokens?.map((t: { user_id: string }) => t.user_id) || []

      // Delete shopify tokens for this shop
      await supabaseAdmin
        .from('shopify_tokens')
        .delete()
        .eq('shop_domain', shopDomain)

      // Delete shopify orders for affected users
      for (const userId of userIds) {
        await supabaseAdmin
          .from('shopify_orders')
          .delete()
          .eq('user_id', userId)

        // Clean up shopify-related app_settings
        await supabaseAdmin
          .from('app_settings')
          .delete()
          .eq('user_id', userId)
          .eq('key', 'shopify_shop_domain')
      }

      await supabaseAdmin.from('system_events').insert({
        user_id: userIds[0] || '00000000-0000-0000-0000-000000000000',
        event_type: 'shopify_gdpr_shop_redact',
        severity: 'warning',
        marketplace_code: 'shopify',
        details: {
          shop_domain: shopDomain,
          affected_users: userIds.length,
        },
      })

      return new Response(JSON.stringify({ message: 'Shop data redacted' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Unknown topic
    console.warn('Unknown GDPR topic:', topic)
    return new Response(JSON.stringify({ message: 'Acknowledged' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('GDPR webhook error:', err)
    return new Response('Internal server error', { status: 500 })
  }
})
