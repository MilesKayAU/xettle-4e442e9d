import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

/**
 * Shopify App Store install entry point.
 * Shopify redirects merchants here after clicking "Install" in the App Store.
 * This is a GET endpoint that validates the HMAC and returns a 302 redirect.
 */

const APP_URL = 'https://xettle.app'

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.byteLength !== bBytes.byteLength) return false
  // Re-sign both with a random key so comparison time doesn't leak info
  const keyData = crypto.getRandomValues(new Uint8Array(32))
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', cryptoKey, aBytes),
    crypto.subtle.sign('HMAC', cryptoKey, bBytes),
  ])
  const viewA = new Uint8Array(sigA)
  const viewB = new Uint8Array(sigB)
  let result = 0
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i]
  }
  return result === 0
}

Deno.serve(async (req) => {
  // Only accept GET (Shopify sends GET for install redirects)
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const url = new URL(req.url)
    const shop = url.searchParams.get('shop')
    const hmac = url.searchParams.get('hmac')
    const timestamp = url.searchParams.get('timestamp')

    if (!shop || !hmac || !timestamp) {
      return new Response('Missing required parameters', { status: 400 })
    }

    // Validate shop domain format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
      return new Response('Invalid shop domain', { status: 400 })
    }

    const isDev = Deno.env.get('SHOPIFY_DEV_MODE') === 'true'
    const SHOPIFY_CLIENT_SECRET = isDev
      ? Deno.env.get('SHOPIFY_DEV_CLIENT_SECRET')
      : Deno.env.get('SHOPIFY_CLIENT_SECRET')

    if (!SHOPIFY_CLIENT_SECRET) {
      console.error('Missing SHOPIFY_CLIENT_SECRET')
      return new Response('Server configuration error', { status: 500 })
    }

    // Standard Shopify HMAC validation:
    // 1. Remove hmac from params
    // 2. Sort remaining params alphabetically
    // 3. Join as key=value&key=value
    // 4. HMAC-SHA256 with client secret
    // 5. Timing-safe comparison
    const params: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      if (key !== 'hmac') {
        params[key] = value
      }
    })

    const sortedKeys = Object.keys(params).sort()
    const message = sortedKeys.map(k => `${k}=${params[k]}`).join('&')

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SHOPIFY_CLIENT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
    const computedHmac = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const isValid = await timingSafeEqual(computedHmac, hmac)
    if (!isValid) {
      console.error('HMAC verification failed for shop:', shop)
      return new Response('Invalid signature', { status: 401 })
    }

    // Check if this shop is already linked to a user
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: existingTokens } = await supabaseAdmin
      .from('shopify_tokens')
      .select('user_id, shop_domain')
      .eq('shop_domain', shop)
      .limit(1)

    const shopExists = existingTokens && existingTokens.length > 0

    // Log the install attempt
    try {
      await supabaseAdmin.from('system_events').insert({
        user_id: shopExists ? existingTokens[0].user_id : '00000000-0000-0000-0000-000000000000',
        event_type: 'shopify_app_install_initiated',
        severity: 'info',
        marketplace_code: 'shopify',
        details: { shop, shop_exists: shopExists },
      })
    } catch (logErr) {
      console.warn('Failed to log install event:', logErr)
    }

    // Redirect to auth page with appropriate tab
    const tab = shopExists ? 'signin' : 'signup'
    const redirectUrl = `${APP_URL}/auth?tab=${tab}&shop=${encodeURIComponent(shop)}&source=shopify_install`

    return new Response(null, {
      status: 302,
      headers: { 'Location': redirectUrl },
    })
  } catch (err) {
    console.error('Shopify install error:', err)
    return new Response('Internal server error', { status: 500 })
  }
})
