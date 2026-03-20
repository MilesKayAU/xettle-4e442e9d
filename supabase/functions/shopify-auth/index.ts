import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'
import { verifyShopifyHmac } from '../_shared/shopify-hmac.ts'
import { SHOPIFY_SCOPES_STRING } from '../_shared/shopify-api-policy.ts'

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    let action = url.searchParams.get('action') || req.headers.get('x-action')

    let parsedBody: any = null
    if (!action && req.method === 'POST') {
      try {
        parsedBody = await req.clone().json()
        action = parsedBody?.action
      } catch {}
    }

    const isDev = Deno.env.get('SHOPIFY_DEV_MODE') === 'true'
    const SHOPIFY_CLIENT_ID = isDev
      ? Deno.env.get('SHOPIFY_DEV_CLIENT_ID')
      : Deno.env.get('SHOPIFY_CLIENT_ID')
    const SHOPIFY_CLIENT_SECRET = isDev
      ? Deno.env.get('SHOPIFY_DEV_CLIENT_SECRET')
      : Deno.env.get('SHOPIFY_CLIENT_SECRET')

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
      console.error('Missing Shopify credentials')
      return new Response(
        JSON.stringify({ error: 'Shopify credentials not configured. Please add SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: initiate — build Shopify OAuth authorization URL
    if (action === 'initiate') {
      const body = parsedBody || await req.json()
      const { shop, userId } = body

      if (!shop || !userId) {
        return new Response(
          JSON.stringify({ error: 'shop and userId are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // SECURITY: Generate unpredictable nonce for CSRF protection instead of using userId as state
      const nonce = crypto.randomUUID()
      const stateValue = `${nonce}:${userId}`

      // Store the nonce in app_settings for validation on callback
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await supabaseAdmin.from('app_settings').upsert({
        user_id: userId,
        key: 'shopify_oauth_state',
        value: stateValue,
      }, { onConflict: 'user_id,key' })

      const scopes = SHOPIFY_SCOPES_STRING
      const redirectUri = 'https://xettle.app/shopify/callback'

      const authUrl = `https://${shop}/admin/oauth/authorize?` +
        `client_id=${SHOPIFY_CLIENT_ID}&` +
        `scope=${scopes}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${encodeURIComponent(stateValue)}`

      logger.debug('Generated Shopify auth URL for shop:', shop)

      return new Response(
        JSON.stringify({ authUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: callback — verify HMAC, exchange code, store token
    if (action === 'callback') {
      const body = parsedBody || await req.json()
      const { code, shop, state, hmac, rawQuery, ...restParams } = body

      if (!code || !shop || !state || !hmac) {
        return new Response(
          JSON.stringify({ error: 'code, shop, state, and hmac are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const params: Record<string, string> = { code, shop, state, ...restParams }
      delete params.action
      delete params.hmac

      const hmacVerification = await verifyShopifyHmac({
        providedHmac: hmac,
        secret: SHOPIFY_CLIENT_SECRET,
        rawInput: typeof rawQuery === 'string' ? rawQuery : undefined,
        params,
      })

      if (!hmacVerification.valid) {
        console.error('HMAC verification failed', {
          shop,
          hasRawQuery: typeof rawQuery === 'string' && rawQuery.trim().length > 0,
          paramKeys: Object.keys(params).sort(),
        })
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      logger.debug(`HMAC verified using ${hmacVerification.matchedStrategy}, validating OAuth state nonce...`)

      // SECURITY: Validate state nonce to prevent CSRF attacks
      // State format: "{nonce}:{userId}"
      const stateParts = state.split(':')
      if (stateParts.length < 2) {
        console.error('Invalid state format — expected nonce:userId')
        return new Response(
          JSON.stringify({ error: 'Invalid OAuth state format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const userId = stateParts.slice(1).join(':') // Handle userId containing colons

      // Verify the nonce matches what we stored during initiation
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      const { data: storedState } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'shopify_oauth_state')
        .maybeSingle()

      if (!storedState?.value || storedState.value !== state) {
        console.error('OAuth state nonce mismatch — potential CSRF attack')
        return new Response(
          JSON.stringify({ error: 'Invalid or expired OAuth state. Please try connecting again.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Clean up the used nonce (one-time use)
      await supabaseAdmin.from('app_settings').delete().eq('user_id', userId).eq('key', 'shopify_oauth_state')

      logger.debug('State nonce verified, exchanging code for access token...')

      // Exchange code for permanent access token
      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: SHOPIFY_CLIENT_ID,
          client_secret: SHOPIFY_CLIENT_SECRET,
          code,
        }),
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('Shopify token exchange failed:', errorText)
        return new Response(
          JSON.stringify({ error: 'Failed to exchange code for access token', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const tokenData = await tokenResponse.json()
      const { access_token, scope } = tokenData

      logger.debug('Token exchange successful, storing in database...')

      // Deactivate any existing tokens for this user before inserting
      await supabaseAdmin
        .from('shopify_tokens')
        .update({ is_active: false })
        .eq('user_id', userId)
        .neq('shop_domain', shop)

      // Upsert shopify_tokens (supabaseAdmin already created above)
      const { error: tokenError } = await supabaseAdmin
        .from('shopify_tokens')
        .upsert({
          user_id: userId,
          shop_domain: shop,
          access_token,
          scope,
          is_active: true,
        }, {
          onConflict: 'user_id,shop_domain',
        })

      if (tokenError) {
        console.error('Failed to store Shopify token:', tokenError)
        return new Response(
          JSON.stringify({ error: 'Failed to store token', details: tokenError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Upsert app_settings with shop domain
      const { error: settingsError } = await supabaseAdmin
        .from('app_settings')
        .upsert({
          user_id: userId,
          key: 'shopify_shop_domain',
          value: shop,
        }, {
          onConflict: 'user_id,key',
        })

      if (settingsError) {
        console.error('Failed to store shop domain setting:', settingsError)
        // Non-fatal — token is already saved
      }

      logger.debug('Shopify token stored successfully for shop:', shop)

      return new Response(
        JSON.stringify({ success: true, shop, scope }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: status — check if Shopify is connected
    if (action === 'status') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const userId = user.id

      // Return all stores — active and inactive
      const { data: tokens, error } = await supabase
        .from('shopify_tokens')
        .select('shop_domain, scope, installed_at, is_active')
        .eq('user_id', userId)
        .order('is_active', { ascending: false })

      if (error) {
        console.error('Failed to fetch Shopify status:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to fetch status' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const activeShops = (tokens || []).filter((t: any) => t.is_active)

      return new Response(
        JSON.stringify({
          connected: activeShops.length > 0,
          shops: activeShops,
          inactive_shops: (tokens || []).filter((t: any) => !t.is_active),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: disconnect
    if (action === 'disconnect') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const userId = user.id

      // Soft-delete: mark as inactive instead of deleting
      const { error } = await supabase
        .from('shopify_tokens')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('is_active', true)

      if (error) {
        console.error('Failed to disconnect Shopify:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to disconnect' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: switch_store — reactivate an inactive store and deactivate the current one
    if (action === 'switch_store') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const body = parsedBody || await req.json()
      const { shop_domain } = body

      if (!shop_domain) {
        return new Response(
          JSON.stringify({ error: 'shop_domain is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Deactivate all, then activate the target
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await supabaseAdmin.from('shopify_tokens').update({ is_active: false }).eq('user_id', user.id)
      const { error } = await supabaseAdmin.from('shopify_tokens').update({ is_active: true }).eq('user_id', user.id).eq('shop_domain', shop_domain)

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to switch store' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update app_settings
      await supabaseAdmin.from('app_settings').upsert({
        user_id: user.id,
        key: 'shopify_shop_domain',
        value: shop_domain,
      }, { onConflict: 'user_id,key' })

      return new Response(
        JSON.stringify({ success: true, active_shop: shop_domain }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: delete_store — permanently delete an inactive store token
    if (action === 'delete_store') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const body = parsedBody || await req.json()
      const { shop_domain } = body

      if (!shop_domain) {
        return new Response(
          JSON.stringify({ error: 'shop_domain is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Only allow deleting inactive stores
      const { error } = await supabase
        .from('shopify_tokens')
        .delete()
        .eq('user_id', user.id)
        .eq('shop_domain', shop_domain)
        .eq('is_active', false)

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to delete store' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: internal_initiate — OAuth flow for XettleInternal (Dev Dashboard app)
    if (action === 'internal_initiate') {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const INTERNAL_CLIENT_ID = Deno.env.get('SHOPIFY_INTERNAL_CLIENT_ID')
      if (!INTERNAL_CLIENT_ID) {
        return new Response(
          JSON.stringify({ error: 'SHOPIFY_INTERNAL_CLIENT_ID not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const body = parsedBody || await req.json()
      const shop = body?.shop || 'mileskayaustralia.myshopify.com'

      const nonce = crypto.randomUUID()
      const stateValue = `internal:${nonce}:${user.id}`

      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      await supabaseAdmin.from('app_settings').upsert({
        user_id: user.id,
        key: 'shopify_internal_oauth_state',
        value: stateValue,
      }, { onConflict: 'user_id,key' })

      // Use same scopes as main app — XettleInternal needs write_orders for FBM
      const scopes = 'read_orders,write_orders,read_products,read_inventory'
      const redirectUri = 'https://xettle.app/shopify/callback'

      const authUrl = `https://${shop}/admin/oauth/authorize?` +
        `client_id=${INTERNAL_CLIENT_ID}&` +
        `scope=${scopes}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${encodeURIComponent(stateValue)}`

      logger.debug('Generated internal Shopify auth URL for shop:', shop)

      return new Response(
        JSON.stringify({ authUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ACTION: internal_callback — exchange code for token using INTERNAL credentials
    if (action === 'internal_callback') {
      const body = parsedBody || await req.json()
      const { code, shop, state } = body

      if (!code || !shop || !state) {
        return new Response(
          JSON.stringify({ error: 'code, shop, and state are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Validate state starts with "internal:"
      if (!state.startsWith('internal:')) {
        return new Response(
          JSON.stringify({ error: 'Invalid state prefix for internal callback' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const stateParts = state.split(':')
      if (stateParts.length < 3) {
        return new Response(
          JSON.stringify({ error: 'Invalid internal state format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const userId = stateParts.slice(2).join(':')

      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      // Verify nonce
      const { data: storedState } = await supabaseAdmin
        .from('app_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'shopify_internal_oauth_state')
        .maybeSingle()

      if (!storedState?.value || storedState.value !== state) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired internal OAuth state' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Clean up nonce
      await supabaseAdmin.from('app_settings').delete().eq('user_id', userId).eq('key', 'shopify_internal_oauth_state')

      const INTERNAL_CLIENT_ID = Deno.env.get('SHOPIFY_INTERNAL_CLIENT_ID')
      const INTERNAL_CLIENT_SECRET = Deno.env.get('SHOPIFY_INTERNAL_CLIENT_SECRET')
      if (!INTERNAL_CLIENT_ID || !INTERNAL_CLIENT_SECRET) {
        return new Response(
          JSON.stringify({ error: 'Internal Shopify credentials not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Exchange code for permanent token
      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: INTERNAL_CLIENT_ID,
          client_secret: INTERNAL_CLIENT_SECRET,
          code,
        }),
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('Internal Shopify token exchange failed:', errorText)
        return new Response(
          JSON.stringify({ error: 'Failed to exchange code for internal token', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const tokenData = await tokenResponse.json()
      const { access_token, scope } = tokenData

      logger.info('Internal Shopify token obtained', { shop, scope, tokenPrefix: access_token?.substring(0, 6) })

      // Store in shopify_tokens with a special marker — use connection_type 'internal'
      // We store alongside existing tokens; the FBM bridge will look for internal tokens
      const { error: tokenError } = await supabaseAdmin
        .from('shopify_tokens')
        .upsert({
          user_id: userId,
          shop_domain: shop,
          access_token,
          scope,
          is_active: true,
          token_type: 'internal',
        }, {
          onConflict: 'user_id,shop_domain',
        })

      if (tokenError) {
        console.error('Failed to store internal Shopify token:', tokenError)
        return new Response(
          JSON.stringify({ error: 'Failed to store internal token', details: tokenError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true, shop, scope, type: 'internal' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Shopify auth error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
