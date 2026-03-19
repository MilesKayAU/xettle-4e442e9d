import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { verifyShopifyHmac } from '../_shared/shopify-hmac.ts'

/**
 * Shopify App Store install entry point.
 * Shopify redirects merchants here after clicking "Install" in the App Store.
 * This is a GET endpoint that validates the HMAC and returns a 302 redirect.
 */

const APP_URL = 'https://xettle.app'

Deno.serve(async (req) => {
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


    const hmacVerification = await verifyShopifyHmac({
      providedHmac: hmac,
      secret: SHOPIFY_CLIENT_SECRET,
      rawInput: req.url,
    })


    if (!hmacVerification.valid) {
      console.error('HMAC verification failed for shop:', shop, {
        matchedStrategy: hmacVerification.matchedStrategy,
        queryKeys: Array.from(url.searchParams.keys()).sort(),
      })
      return new Response('Invalid signature', { status: 401 })
    }

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
