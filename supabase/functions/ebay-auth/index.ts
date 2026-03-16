import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'

const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize'
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.fulfillment'

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
    const userId = user.id

    const action = req.headers.get('x-action') || ''
    const EBAY_CLIENT_ID = Deno.env.get('EBAY_CLIENT_ID')
    const EBAY_CERT_ID = Deno.env.get('EBAY_CERT_ID')
    const EBAY_RUNAME = Deno.env.get('EBAY_RUNAME')

    // ─── AUTHORIZE: Build eBay OAuth URL ───────────────────────
    if (action === 'authorize') {
      if (!EBAY_CLIENT_ID || !EBAY_RUNAME) {
        return new Response(JSON.stringify({ error: 'eBay API not configured', pending: true }), {
          status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const state = crypto.randomUUID()

      const params = new URLSearchParams({
        client_id: EBAY_CLIENT_ID,
        redirect_uri: EBAY_RUNAME,
        response_type: 'code',
        scope: EBAY_SCOPES,
        state,
        prompt: 'login',
      })

      const authUrl = `${EBAY_AUTH_URL}?${params.toString()}`

      // Debug: log the authorize URL components so we can verify credentials match
      logger.debug('[ebay-auth] authorize URL built:', {
        authUrl,
        client_id_prefix: EBAY_CLIENT_ID.substring(0, 12) + '...',
        runame: EBAY_RUNAME,
        scopes: EBAY_SCOPES,
      })

      return new Response(JSON.stringify({ authUrl, state }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ─── STATUS: Check if user has eBay connected ──────────────
    if (action === 'status') {
      const { data, error } = await supabase
        .from('ebay_tokens')
        .select('id, ebay_username, expires_at, refresh_token_expires_at, updated_at')
        .eq('user_id', userId)
        .limit(1)

      if (error) throw error

      return new Response(JSON.stringify({
        connected: !!(data && data.length > 0),
        connection: data?.[0] || null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── CONNECT: Exchange authorization code for tokens ─────────
    if (action === 'connect') {
      if (!EBAY_CLIENT_ID || !EBAY_CERT_ID || !EBAY_RUNAME) {
        return new Response(JSON.stringify({
          error: 'eBay API credentials not configured.',
          pending: true,
        }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const body = await req.json()
      const { code } = body

      if (!code) {
        return new Response(JSON.stringify({ error: 'Missing required parameter: code' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // eBay uses Basic auth: base64(client_id:cert_id)
      const basicAuth = btoa(`${EBAY_CLIENT_ID}:${EBAY_CERT_ID}`)

      const tokenResponse = await fetch(EBAY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: EBAY_RUNAME,
        }),
      })

      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData.refresh_token) {
        console.error('eBay token exchange failed:', tokenData)
        return new Response(JSON.stringify({ error: 'Token exchange failed', details: tokenData }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const expiresAt = new Date(Date.now() + (tokenData.expires_in || 7200) * 1000).toISOString()
      const refreshExpiresAt = new Date(Date.now() + (tokenData.refresh_token_expires_in || 47304000) * 1000).toISOString()

      // Upsert token — UNIQUE on user_id
      const { error: upsertError } = await supabase
        .from('ebay_tokens')
        .upsert({
          user_id: userId,
          ebay_username: tokenData.user_id || null,
          refresh_token: tokenData.refresh_token,
          access_token: tokenData.access_token,
          expires_at: expiresAt,
          refresh_token_expires_at: refreshExpiresAt,
          scopes: EBAY_SCOPES,
        }, { onConflict: 'user_id' })

      if (upsertError) throw upsertError

      // Auto-provision marketplace_connections row so eBay appears in the marketplace switcher
      const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      await adminClient.from('marketplace_connections').upsert({
        user_id: userId,
        marketplace_code: 'ebay_au',
        marketplace_name: 'eBay Australia',
        connection_type: 'ebay_api',
        connection_status: 'active',
        country_code: 'AU',
      }, { onConflict: 'user_id,marketplace_code' })

      // Log sync event
      await adminClient.from('sync_history').insert({
        user_id: userId,
        event_type: 'ebay_connected',
        status: 'success',
        details: { ebay_username: tokenData.user_id || null },
      })

      return new Response(JSON.stringify({
        success: true,
        ebay_username: tokenData.user_id || null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── REFRESH: Get fresh access token ─────────────────────────
    if (action === 'refresh') {
      if (!EBAY_CLIENT_ID || !EBAY_CERT_ID) {
        return new Response(JSON.stringify({ error: 'eBay API not configured' }), {
          status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { data: tokenRow, error: fetchErr } = await supabase
        .from('ebay_tokens')
        .select('*')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (fetchErr || !tokenRow) {
        return new Response(JSON.stringify({ error: 'No eBay connection found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check if current token is still valid (with 60s buffer)
      if (tokenRow.access_token && tokenRow.expires_at && new Date(tokenRow.expires_at) > new Date(Date.now() + 60000)) {
        return new Response(JSON.stringify({
          access_token: tokenRow.access_token,
          ebay_username: tokenRow.ebay_username,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const basicAuth = btoa(`${EBAY_CLIENT_ID}:${EBAY_CERT_ID}`)

      const refreshResponse = await fetch(EBAY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenRow.refresh_token,
          scope: EBAY_SCOPES,
        }),
      })

      const refreshData = await refreshResponse.json()
      if (!refreshResponse.ok || !refreshData.access_token) {
        console.error('eBay token refresh failed:', refreshData)
        return new Response(JSON.stringify({ error: 'Token refresh failed' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 7200) * 1000).toISOString()

      await supabase
        .from('ebay_tokens')
        .update({
          access_token: refreshData.access_token,
          expires_at: newExpiresAt,
        })
        .eq('id', tokenRow.id)

      return new Response(JSON.stringify({
        access_token: refreshData.access_token,
        ebay_username: tokenRow.ebay_username,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── DISCONNECT ──────────────────────────────────────────────
    if (action === 'disconnect') {
      const { error } = await supabase
        .from('ebay_tokens')
        .delete()
        .eq('user_id', userId)

      if (error) throw error

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use: authorize, connect, status, refresh, disconnect' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('ebay-auth error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
