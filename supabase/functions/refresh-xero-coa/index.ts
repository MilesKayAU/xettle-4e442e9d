import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'
import { XERO_TOKEN_URL, buildXeroUrl, getXeroHeaders } from '../_shared/xero-api-policy.ts'

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
      'Xero-tenant-id': xeroToken.tenant_id,
    }

    // ─── Fetch Accounts + Tax Rates in parallel ──────────────────────
    const [accountsResp, taxRatesResp] = await Promise.all([
      fetch('https://api.xero.com/api.xro/2.0/Accounts?where=Status%3D%3D%22ACTIVE%22', { headers: xeroHeaders }),
      fetch('https://api.xero.com/api.xro/2.0/TaxRates', { headers: xeroHeaders }),
    ])

    if (!accountsResp.ok) {
      const errText = await accountsResp.text()
      logger.error('Xero accounts error:', accountsResp.status, errText)

      if (accountsResp.status === 429) {
        const retryAfter = parseInt(accountsResp.headers.get('Retry-After') || '60', 10)
        return new Response(JSON.stringify({
          error: 'rate_limited',
          retry_after: retryAfter,
          message: `Xero API rate limit reached. Please wait ${retryAfter} seconds and try again.`,
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: `Xero API error: ${accountsResp.status}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await accountsResp.json()
    const xeroAccounts = accountsData.Accounts || []

    // ─── Cache Chart of Accounts ─────────────────────────────────────
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

    let accountsUpserted = 0
    let accountsSoftDeleted = 0

    if (coaRows.length > 0) {
      const { error: upsertErr } = await supabase.from('xero_chart_of_accounts').upsert(
        coaRows,
        { onConflict: 'user_id,xero_account_id' }
      )
      if (upsertErr) {
        logger.error('COA upsert error:', upsertErr)
      } else {
        accountsUpserted = coaRows.length
      }

      // Soft-delete missing accounts
      const currentIds = coaRows.map((r: any) => r.xero_account_id)
      const { count } = await supabase
        .from('xero_chart_of_accounts')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('is_active', true)
        .not('xero_account_id', 'in', `(${currentIds.join(',')})`)
      accountsSoftDeleted = count || 0
    }

    // ─── Cache Tax Rates ─────────────────────────────────────────────
    let taxRatesUpserted = 0
    if (taxRatesResp.ok) {
      const taxData = await taxRatesResp.json()
      const taxRates = taxData.TaxRates || []

      const taxRows = taxRates
        .filter((t: any) => t.TaxType && t.Status === 'ACTIVE')
        .map((t: any) => ({
          user_id: userId,
          tax_type: t.TaxType,
          name: t.Name,
          effective_rate: t.EffectiveRate != null ? Number(t.EffectiveRate) : null,
          status: t.Status || 'ACTIVE',
          can_apply_to_revenue: t.CanApplyToRevenue === true,
          can_apply_to_expenses: t.CanApplyToExpenses === true,
          synced_at: new Date().toISOString(),
        }))

      if (taxRows.length > 0) {
        const { error: taxErr } = await supabase.from('xero_tax_rates').upsert(
          taxRows,
          { onConflict: 'user_id,tax_type' }
        )
        if (taxErr) {
          logger.error('Tax rates upsert error:', taxErr)
        } else {
          taxRatesUpserted = taxRows.length
        }
      }
    } else {
      logger.warn('Tax rates fetch failed (non-fatal):', taxRatesResp.status)
    }

    // ─── Log system event ────────────────────────────────────────────
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'xero_coa_refreshed',
      severity: 'info',
      details: {
        accounts_upserted: accountsUpserted,
        accounts_soft_deleted: accountsSoftDeleted,
        tax_rates_upserted: taxRatesUpserted,
        fetched_at: new Date().toISOString(),
      },
    })

    // ─── Build response ──────────────────────────────────────────────
    const accounts = xeroAccounts.map((a: any) => ({
      xero_account_id: a.AccountID,
      code: a.Code || null,
      name: a.Name,
      type: a.Type,
      tax_type: a.TaxType || null,
      description: a.Description || '',
      is_active: true,
    }))

    return new Response(JSON.stringify({
      success: true,
      accounts_count: accounts.length,
      tax_rates_count: taxRatesUpserted,
      accounts,
      fetched_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    logger.error('refresh-xero-coa error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
