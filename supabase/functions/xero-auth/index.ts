import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action, x-redirect-uri',
}

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize'
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    // Support both query param and header for action
    const action = url.searchParams.get('action') || req.headers.get('x-action')
    
    const XERO_CLIENT_ID = Deno.env.get('XERO_CLIENT_ID')
    const XERO_CLIENT_SECRET = Deno.env.get('XERO_CLIENT_SECRET')
    
    if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) {
      console.error('Missing Xero credentials')
      return new Response(
        JSON.stringify({ error: 'Xero credentials not configured. Please add XERO_CLIENT_ID and XERO_CLIENT_SECRET secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Action: Generate authorization URL
    if (action === 'authorize') {
      // Support both query param and header for redirect_uri
      const redirectUri = url.searchParams.get('redirect_uri') || req.headers.get('x-redirect-uri')
      const state = url.searchParams.get('state') || crypto.randomUUID()
      
      if (!redirectUri) {
        return new Response(
          JSON.stringify({ error: 'redirect_uri is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const scopes = [
        'openid',
        'profile',
        'email',
        'offline_access',
        'accounting.invoices',
        'accounting.contacts',
        'accounting.settings',
        'accounting.settings.read'
      ].join(' ')

      const authUrl = new URL(XERO_AUTH_URL)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', XERO_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('scope', scopes)
      authUrl.searchParams.set('state', state)

      console.log('Generated Xero auth URL for redirect:', redirectUri)

      return new Response(
        JSON.stringify({ 
          authUrl: authUrl.toString(),
          state 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Action: Exchange code for tokens
    if (action === 'callback') {
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

      const token = authHeader.replace('Bearer ', '')
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
      
      if (claimsError || !claimsData?.claims) {
        console.error('Auth error:', claimsError)
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const userId = claimsData.claims.sub
      const body = await req.json()
      const { code, redirectUri } = body

      if (!code || !redirectUri) {
        return new Response(
          JSON.stringify({ error: 'code and redirectUri are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log('Exchanging code for tokens...')

      // Exchange code for tokens
      const tokenResponse = await fetch(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`)
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        })
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('Token exchange failed:', errorText)
        return new Response(
          JSON.stringify({ error: 'Failed to exchange code for tokens', details: errorText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const tokens = await tokenResponse.json()
      console.log('Token exchange successful, fetching connections...')

      // Get tenant/organization info
      const connectionsResponse = await fetch(XERO_CONNECTIONS_URL, {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!connectionsResponse.ok) {
        const errorText = await connectionsResponse.text()
        console.error('Failed to fetch connections:', errorText)
        return new Response(
          JSON.stringify({ error: 'Failed to fetch Xero connections', details: errorText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const connections = await connectionsResponse.json()
      console.log('Connections fetched:', connections.length)

      if (!connections || connections.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No Xero organizations found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Store tokens for each connected tenant
      const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString()
      
      for (const connection of connections) {
        const { error: upsertError } = await supabase
          .from('xero_tokens')
          .upsert({
            user_id: userId,
            tenant_id: connection.tenantId,
            tenant_name: connection.tenantName,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_type: tokens.token_type,
            expires_at: expiresAt,
            scope: tokens.scope
          }, {
            onConflict: 'user_id,tenant_id'
          })

        if (upsertError) {
          console.error('Failed to store tokens:', upsertError)
          return new Response(
            JSON.stringify({ error: 'Failed to store tokens', details: upsertError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      console.log('Tokens stored successfully for', connections.length, 'tenant(s)')

      return new Response(
        JSON.stringify({ 
          success: true,
          tenants: connections.map((c: any) => ({
            id: c.tenantId,
            name: c.tenantName,
            type: c.tenantType
          }))
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Action: Check connection status
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

      const token = authHeader.replace('Bearer ', '')
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
      
      if (claimsError || !claimsData?.claims) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const userId = claimsData.claims.sub

      const { data: tokens, error } = await supabase
        .from('xero_tokens')
        .select('tenant_id, tenant_name, expires_at')
        .eq('user_id', userId)

      if (error) {
        console.error('Failed to fetch token status:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to fetch status' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const connected = tokens && tokens.length > 0
      const isExpired = connected && new Date(tokens[0].expires_at) < new Date()

      return new Response(
        JSON.stringify({
          connected,
          isExpired,
          tenants: tokens?.map(t => ({
            id: t.tenant_id,
            name: t.tenant_name,
            expiresAt: t.expires_at
          })) || []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Action: Disconnect
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

      const token = authHeader.replace('Bearer ', '')
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
      
      if (claimsError || !claimsData?.claims) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const userId = claimsData.claims.sub

      const { error } = await supabase
        .from('xero_tokens')
        .delete()
        .eq('user_id', userId)

      if (error) {
        console.error('Failed to disconnect:', error)
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

    // Action: Get chart of accounts from Xero
    if (action === 'get_accounts') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const userId = body?.userId;

      if (!userId) {
        return new Response(
          JSON.stringify({ error: 'userId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      const { data: tokens, error: tokenError } = await supabaseAdmin
        .from('xero_tokens')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)

      if (tokenError || !tokens || tokens.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No Xero connection found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      let xeroToken = tokens[0]

      // Refresh if expired
      const expiresAt = new Date(xeroToken.expires_at)
      if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
        const tokenResponse = await fetch(XERO_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`)}`
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: xeroToken.refresh_token
          })
        })

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json()
          const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
          await supabaseAdmin.from('xero_tokens').update({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString()
          }).eq('id', xeroToken.id)
          xeroToken = { ...xeroToken, access_token: tokenData.access_token }
        }
      }

      // Fetch chart of accounts from Xero
      const accountsResponse = await fetch('https://api.xero.com/api.xro/2.0/Accounts', {
        headers: {
          'Authorization': `Bearer ${xeroToken.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': xeroToken.tenant_id
        }
      })

      if (!accountsResponse.ok) {
        const errorText = await accountsResponse.text()
        console.error('Xero accounts API error:', accountsResponse.status, errorText)
        return new Response(
          JSON.stringify({ error: `Xero API error: ${accountsResponse.status}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const accountsData = await accountsResponse.json()
      const accounts = accountsData.Accounts?.map((a: any) => ({
        Code: a.Code,
        Name: a.Name,
        Type: a.Type,
        Status: a.Status,
        TaxType: a.TaxType
      })) || []

      return new Response(
        JSON.stringify({ success: true, accounts }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use: authorize, callback, status, disconnect, or get_accounts' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Xero auth error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
