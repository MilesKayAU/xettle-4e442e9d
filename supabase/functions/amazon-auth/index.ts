import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
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

    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
    const userId = claimsData.claims.sub as string

    const action = req.headers.get('x-action') || ''

    // ─── STATUS: Check if user has Amazon connected ──────────────
    if (action === 'status') {
      const { data, error } = await supabase
        .from('amazon_tokens')
        .select('id, selling_partner_id, marketplace_id, region, expires_at')
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
      const AMAZON_CLIENT_ID = Deno.env.get('AMAZON_SP_CLIENT_ID')
      const AMAZON_CLIENT_SECRET = Deno.env.get('AMAZON_SP_CLIENT_SECRET')

      if (!AMAZON_CLIENT_ID || !AMAZON_CLIENT_SECRET) {
        return new Response(JSON.stringify({
          error: 'Amazon SP-API credentials not configured. Awaiting developer registration approval.',
          pending: true,
        }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const body = await req.json()
      const { spapi_oauth_code, selling_partner_id, marketplace_id, region } = body

      if (!spapi_oauth_code || !selling_partner_id) {
        return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Exchange auth code for refresh token via Amazon LWA
      const tokenResponse = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: spapi_oauth_code,
          client_id: AMAZON_CLIENT_ID,
          client_secret: AMAZON_CLIENT_SECRET,
        }),
      })

      const tokenData = await tokenResponse.json()
      if (!tokenResponse.ok || !tokenData.refresh_token) {
        console.error('Amazon token exchange failed:', tokenData)
        return new Response(JSON.stringify({ error: 'Token exchange failed', details: tokenData }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()

      // Upsert token
      const { error: upsertError } = await supabase
        .from('amazon_tokens')
        .upsert({
          user_id: userId,
          selling_partner_id,
          marketplace_id: marketplace_id || 'A39IBJ37TRP1C6',
          region: region || 'fe',
          refresh_token: tokenData.refresh_token,
          access_token: tokenData.access_token,
          expires_at: expiresAt,
        }, { onConflict: 'user_id,selling_partner_id' })

      if (upsertError) throw upsertError

      return new Response(JSON.stringify({
        success: true,
        selling_partner_id,
        marketplace_id: marketplace_id || 'A39IBJ37TRP1C6',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── REFRESH: Get fresh access token ─────────────────────────
    if (action === 'refresh') {
      const AMAZON_CLIENT_ID = Deno.env.get('AMAZON_SP_CLIENT_ID')
      const AMAZON_CLIENT_SECRET = Deno.env.get('AMAZON_SP_CLIENT_SECRET')

      if (!AMAZON_CLIENT_ID || !AMAZON_CLIENT_SECRET) {
        return new Response(JSON.stringify({ error: 'SP-API not configured' }), {
          status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { data: tokenRow, error: fetchErr } = await supabase
        .from('amazon_tokens')
        .select('*')
        .eq('user_id', userId)
        .limit(1)
        .single()

      if (fetchErr || !tokenRow) {
        return new Response(JSON.stringify({ error: 'No Amazon connection found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check if current token is still valid
      if (tokenRow.access_token && new Date(tokenRow.expires_at) > new Date(Date.now() + 60000)) {
        return new Response(JSON.stringify({
          access_token: tokenRow.access_token,
          selling_partner_id: tokenRow.selling_partner_id,
          marketplace_id: tokenRow.marketplace_id,
          region: tokenRow.region,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Refresh the token
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
        console.error('Amazon token refresh failed:', refreshData)
        return new Response(JSON.stringify({ error: 'Token refresh failed' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
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

      return new Response(JSON.stringify({
        access_token: refreshData.access_token,
        selling_partner_id: tokenRow.selling_partner_id,
        marketplace_id: tokenRow.marketplace_id,
        region: tokenRow.region,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── DISCONNECT ──────────────────────────────────────────────
    if (action === 'disconnect') {
      const { error } = await supabase
        .from('amazon_tokens')
        .delete()
        .eq('user_id', userId)

      if (error) throw error

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('amazon-auth error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})