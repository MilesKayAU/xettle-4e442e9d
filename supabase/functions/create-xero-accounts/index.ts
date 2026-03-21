import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  XERO_TOKEN_URL,
  XERO_API_BASE,
  buildXeroUrl,
  getXeroHeaders,
  isXeroTokenExpired,
  buildXeroBasicAuth,
  parseXeroRetryAfter,
} from '../_shared/xero-api-policy.ts'

// ══════════════════════════════════════════════════════════════
// ACCOUNTING RULES (hardcoded, never configurable)
// Canonical source: src/constants/accounting-rules.ts
//
// This function creates/updates Xero Chart of Accounts entries.
// It never creates invoices, journals, or accounting entries.
// ══════════════════════════════════════════════════════════════

const ALLOWED_TYPES = new Set(['REVENUE', 'EXPENSE', 'DIRECTCOSTS', 'OTHERINCOME', 'OVERHEADS'])
const MAX_BATCH = 2

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
    const mode: string = body.mode || 'create_only'

    if (!['create_only', 'create_and_update'].includes(mode)) {
      return new Response(JSON.stringify({ error: 'Invalid mode. Must be create_only or create_and_update' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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

    // Check for existing codes AND names against cached COA
    const { data: existingAccounts } = await supabase
      .from('xero_chart_of_accounts')
      .select('account_code, account_name, account_type, xero_account_id')
      .eq('user_id', userId)
      .eq('is_active', true)

    const existingByCode = new Map<string, { name: string; type: string; xero_account_id: string }>()
    const existingByName = new Map<string, string>() // name (lowercase) → code
    for (const a of (existingAccounts || [])) {
      if (a.account_code) existingByCode.set(a.account_code, { name: a.account_name, type: a.account_type || '', xero_account_id: a.xero_account_id })
      if (a.account_name) existingByName.set(a.account_name.toLowerCase().trim(), a.account_code || '')
    }

    // In create_only mode, reject duplicate codes
    if (mode === 'create_only') {
      const duplicates = accounts.filter(a => existingByCode.has(a.code))
      if (duplicates.length > 0) {
        return new Response(JSON.stringify({ 
          error: `Account code(s) already exist in Xero: ${duplicates.map(d => d.code).join(', ')}` 
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Pre-flight: reject duplicate NAMES (Xero enforces unique names globally)
    const nameConflicts = accounts.filter(a => {
      const existingCode = existingByName.get(a.name.toLowerCase().trim())
      // Conflict if name exists under a DIFFERENT code
      return existingCode !== undefined && existingCode !== a.code
    })
    if (nameConflicts.length > 0) {
      const details = nameConflicts.map(a => {
        const existingCode = existingByName.get(a.name.toLowerCase().trim())
        return `"${a.name}" (requested code ${a.code}, already exists under code ${existingCode})`
      }).join('; ')
      return new Response(JSON.stringify({
        error: `Account name(s) already exist in Xero under different codes: ${details}. Rename the account or use the existing code.`,
        name_conflicts: nameConflicts.map(a => ({
          requested_code: a.code,
          name: a.name,
          existing_code: existingByName.get(a.name.toLowerCase().trim()),
        })),
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

    // Refresh if expiring (uses shared policy helper)
    if (isXeroTokenExpired(xeroToken.expires_at)) {
      const refreshResp = await fetch(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': buildXeroBasicAuth(xeroClientId, xeroClientSecret),
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: xeroToken.refresh_token,
        }),
      })

      if (!refreshResp.ok) {
        const errText = await refreshResp.text()
        console.error('Xero token refresh failed:', refreshResp.status, errText)
        return new Response(JSON.stringify({ error: 'Xero token refresh failed. Please reconnect Xero.' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

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

    // Use shared header builder
    const xeroApiHeaders = getXeroHeaders(xeroToken.access_token, xeroToken.tenant_id)

    // ─── Create/update accounts in Xero ──────────────────────────────
    // IMPORTANT Xero API constraints:
    //   - PUT /Accounts creates a new account (one at a time)
    //   - POST /Accounts/{AccountID} updates an existing account (one at a time)
    //   - Account Type (REVENUE, EXPENSE, etc.) is IMMUTABLE after creation
    //   - Bank Account Type is also immutable
    const created: { code: string; name: string; xero_account_id: string; action: string }[] = []
    const errors: { code: string; error: string }[] = []
    const skipped: { code: string; reason: string }[] = []

    for (const acc of accounts) {
      const existing = existingMap.get(acc.code)
      const isUpdate = !!existing && mode === 'create_and_update'

      // Guard: Xero Account Type is immutable — skip if type changed
      if (isUpdate && existing && existing.type.toUpperCase() !== acc.type.toUpperCase()) {
        skipped.push({
          code: acc.code,
          reason: `Cannot change account type from ${existing.type} to ${acc.type} (Xero limitation)`,
        })
        continue
      }

      // Build Xero payload — only send Name + Code for updates (Type is immutable)
      const xeroPayload: Record<string, unknown> = {
        Code: acc.code,
        Name: acc.name,
      }

      if (!isUpdate) {
        // Type is only set on creation
        xeroPayload.Type = acc.type.toUpperCase()
        xeroPayload.EnablePaymentsToAccount = false
      }

      if (acc.tax_type) {
        xeroPayload.TaxType = acc.tax_type
      }

      // PUT creates new; POST to /Accounts/{ID} updates existing
      const url = isUpdate && existing?.xero_account_id
        ? buildXeroUrl(`Accounts/${existing.xero_account_id}`)
        : buildXeroUrl('Accounts')
      const method = isUpdate ? 'POST' : 'PUT'

      const resp = await fetch(url, {
        method,
        headers: xeroApiHeaders,
        body: JSON.stringify(xeroPayload),
      })

      // Handle 429 rate limiting — return 200 with error field so
      // supabase.functions.invoke delivers it via `data` not `error`
      if (resp.status === 429) {
        const retryAfter = parseXeroRetryAfter(resp.headers.get('Retry-After'))
        console.warn(`Xero 429 rate limited. Retry-After: ${retryAfter}s`)
        // Consume response body to prevent Deno resource leak
        await resp.text()
        return new Response(JSON.stringify({
          success: false,
          error: 'rate_limited',
          retry_after: retryAfter,
          created,
          errors,
          skipped: skipped.length > 0 ? skipped : undefined,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!resp.ok) {
        const errBody = await resp.text()
        console.error(`Xero account ${isUpdate ? 'update' : 'creation'} failed for ${acc.code}:`, resp.status, errBody)
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
          action: isUpdate ? 'updated' : 'created',
        })
      }
    }

    // ─── Refresh COA cache ───────────────────────────────────────────
    const coaRefreshUrl = buildXeroUrl('Accounts', 'where=Status%3D%3D%22ACTIVE%22')
    const refreshCoaResp = await fetch(coaRefreshUrl, {
      headers: {
        'Authorization': `Bearer ${xeroToken.access_token}`,
        'Accept': 'application/json',
        'Xero-Tenant-Id': xeroToken.tenant_id,
      },
    })

    let coaRefreshed = false
    if (refreshCoaResp.ok) {
      const refreshData = await refreshCoaResp.json()
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

        // Soft-delete missing accounts (only if Xero returned a non-empty list)
        const currentIds = coaRows.map((r: any) => r.xero_account_id)
        await supabase
          .from('xero_chart_of_accounts')
          .update({ is_active: false })
          .eq('user_id', userId)
          .eq('is_active', true)
          .not('xero_account_id', 'in', `(${currentIds.join(',')})`)

        coaRefreshed = true
      }
    } else {
      // Consume response body to prevent Deno resource leak
      await refreshCoaResp.text()
      console.warn('COA refresh after account creation failed:', refreshCoaResp.status)
    }

    // ─── Log system events ───────────────────────────────────────────
    if (created.length > 0 || skipped.length > 0) {
      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: mode === 'create_and_update' ? 'coa_sync' : 'xero_account_created',
        severity: 'info',
        details: {
          mode,
          created_count: created.filter(c => c.action === 'created').length,
          updated_count: created.filter(c => c.action === 'updated').length,
          skipped_count: skipped.length,
          accounts: created,
          skipped: skipped.length > 0 ? skipped : undefined,
          errors: errors.length > 0 ? errors : undefined,
        },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      created,
      errors: errors.length > 0 ? errors : undefined,
      skipped: skipped.length > 0 ? skipped : undefined,
      coa_refreshed: coaRefreshed,
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