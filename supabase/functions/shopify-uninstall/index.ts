import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * Shopify app/uninstalled webhook.
 * Deactivates the shop's OAuth token when a merchant uninstalls the app.
 */

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
  const origin = req.headers.get('Origin') ?? ''
  const corsHeaders = getCorsHeaders(origin)

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
      console.error('HMAC verification failed for uninstall webhook')
      return new Response('Unauthorized', { status: 401 })
    }

    const payload = JSON.parse(rawBody)
    const shopDomain = payload.myshopify_domain || payload.domain

    if (!shopDomain) {
      console.error('No shop domain in uninstall payload')
      return new Response('Bad request', { status: 400 })
    }

    console.log('App uninstalled for shop:', shopDomain)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: tokens } = await supabaseAdmin
      .from('shopify_tokens')
      .update({ is_active: false })
      .eq('shop_domain', shopDomain)
      .select('user_id')

    const userId = tokens?.[0]?.user_id || '00000000-0000-0000-0000-000000000000'

    await supabaseAdmin.from('system_events').insert({
      user_id: userId,
      event_type: 'shopify_app_uninstalled',
      severity: 'warning',
      marketplace_code: 'shopify',
      details: { shop_domain: shopDomain },
    })

    return new Response(JSON.stringify({ message: 'Uninstall processed' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Uninstall webhook error:', err)
    return new Response('Internal server error', { status: 500 })
  }
})
