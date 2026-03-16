import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const ALLOWED_TYPES = new Set(['REVENUE', 'EXPENSE', 'DIRECTCOSTS', 'OTHERINCOME', 'OVERHEADS'])
const MAX_BATCH = 10

interface AccountRequest {
  code: string
  name: string
  type: string
  tax_type?: string
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // ─── Auth ────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = user.id
    const supabase = createClient(supabaseUrl, serviceKey)

    // ─── Admin role check ────────────────────────────────────────────
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle()

    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── Parse & validate request ────────────────────────────────────
    const body = await req.json()
    const accounts: AccountRequest[] = body.accounts || []

    if (!accounts.length) {
      return new Response(JSON.stringify({ error: 'No accounts provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (accounts.length > MAX_BATCH) {
      return new Response(JSON.stringify({ error: `Max ${MAX_BATCH} accounts per batch` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate types
    for (const acc of accounts) {
      if (!acc.code || !acc.name || !acc.type) {
        return new Response(JSON.stringify({ error: `Missing code, name, or type for account: ${JSON.stringify(acc)}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!ALLOWED_TYPES.has(acc.type.toUpperCase())) {
        return new Response(JSON.stringify({ error: `Invalid account type: ${acc.type}. Allowed: ${[...ALLOWED_TYPES].join(', ')}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Check for duplicate codes against cached COA
    const { data: existingAccounts } = await supabase
      .from('xero_chart_of_accounts')
      .select('account_code')
      .eq('user_id', userId)
      .eq('is_active', true)

    const existingCodes = new Set((existingAccounts || []).map((a: any) => a.account_code))
    const duplicates = accounts.filter(a => existingCodes.has(a.code))
    if (duplicates.length > 0) {
      return new Response(JSON.stringify({ 
        error: `Account code(s) already exist in Xero: ${duplicates.map(d => d.code).join(', ')}` 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── Xero token ──────────────────────────────────────────────────
    const { data: tokens } = await supabase
      .from('xero_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ error: 'No Xero connection found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let xeroToken = tokens[0]
    const xeroClientId = Deno.env.get('XERO_CLIENT_ID')!
    const xeroClientSecret = Deno.env.get('XERO_CLIENT_SECRET')!

    // Refresh if expiring
    const expiresAt = new Date(xeroToken.expires_at)
    if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      const refreshResp = await fetch(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: xeroToken.refresh_token,
        }),
      })
      if (refreshResp.ok) {
        const td = await refreshResp.json()
        const newExp = new Date(Date.now() + td.expires_in * 1000).toISOString()
        await supabase.from('xero_tokens').update({
          access_token: td.access_token,
          refresh_token: td.refresh_token,
          expires_at: newExp,
          updated_at: new Date().toISOString(),
        }).eq('id', xeroToken.id)
        xeroToken = { ...xeroToken, access_token: td.access_token }
      }
    }

    const xeroHeaders = {
      'Authorization': `Bearer ${xeroToken.access_token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Xero-tenant-id': xeroToken.tenant_id,
    }

    // ─── Create accounts in Xero ─────────────────────────────────────
    const created: { code: string; name: string; xero_account_id: string }[] = []
    const errors: { code: string; error: string }[] = []

    for (const acc of accounts) {
      const xeroPayload: any = {
        Code: acc.code,
        Name: acc.name,
        Type: acc.type.toUpperCase(),
        EnablePaymentsToAccount: false,
      }
      if (acc.tax_type) {
        xeroPayload.TaxType = acc.tax_type
      }

      const resp = await fetch('https://api.xero.com/api.xro/2.0/Accounts', {
        method: 'PUT',
        headers: xeroHeaders,
        body: JSON.stringify(xeroPayload),
      })

      if (!resp.ok) {
        const errBody = await resp.text()
        console.error(`Xero account creation failed for ${acc.code}:`, resp.status, errBody)
        errors.push({ code: acc.code, error: `Xero API ${resp.status}: ${errBody.substring(0, 200)}` })
        continue
      }

      const respData = await resp.json()
      const createdAccount = respData.Accounts?.[0]
      if (createdAccount?.AccountID) {
        created.push({
          code: acc.code,
          name: acc.name,
          xero_account_id: createdAccount.AccountID,
        })
      }
    }

    // ─── Refresh COA cache ───────────────────────────────────────────
    // Inline COA refresh: fetch all accounts from Xero and upsert
    const refreshResp = await fetch('https://api.xero.com/api.xro/2.0/Accounts?where=Status%3D%3D%22ACTIVE%22', {
      headers: {
        'Authorization': `Bearer ${xeroToken.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': xeroToken.tenant_id,
      },
    })

    if (refreshResp.ok) {
      const refreshData = await refreshResp.json()
      const xeroAccounts = refreshData.Accounts || []
      const coaRows = xeroAccounts
        .filter((a: any) => a.AccountID)
        .map((a: any) => ({
          user_id: userId,
          xero_account_id: a.AccountID,
          account_code: a.Code || null,
          account_name: a.Name,
          account_type: a.Type || null,
          tax_type: a.TaxType || null,
          description: a.Description || null,
          is_active: true,
          synced_at: new Date().toISOString(),
        }))

      if (coaRows.length > 0) {
        await supabase.from('xero_chart_of_accounts').upsert(
          coaRows,
          { onConflict: 'user_id,xero_account_id' }
        )

        // Soft-delete missing accounts
        const currentIds = coaRows.map((r: any) => r.xero_account_id)
        await supabase
          .from('xero_chart_of_accounts')
          .update({ is_active: false })
          .eq('user_id', userId)
          .eq('is_active', true)
          .not('xero_account_id', 'in', `(${currentIds.join(',')})`)
      }
    }

    // ─── Log system events ───────────────────────────────────────────
    if (created.length > 0) {
      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_account_created',
        severity: 'info',
        details: {
          created_count: created.length,
          accounts: created,
          errors: errors.length > 0 ? errors : undefined,
        },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      created,
      errors: errors.length > 0 ? errors : undefined,
      coa_refreshed: refreshResp.ok,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('create-xero-accounts error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
