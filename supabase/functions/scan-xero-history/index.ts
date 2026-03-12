import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// ─── Registry-powered detection (loaded from DB at runtime) ─────────────────

interface RegistryEntry {
  code: string
  name: string
  keywords: string[]
  xero_patterns: string[]
  bank_patterns: string[]
  is_processor: boolean
  processor_type?: string // 'payment_gateway' | 'advertising_platform' etc.
}

let _registryCache: RegistryEntry[] | null = null
let _processorCodes: Set<string> | null = null

async function loadRegistries(supabaseAdmin: any): Promise<void> {
  if (_registryCache) return // already loaded this invocation

  const [mpRes, ppRes] = await Promise.all([
    supabaseAdmin.from('marketplace_registry').select('marketplace_code, marketplace_name, detection_keywords, xero_contact_patterns, bank_narration_patterns, is_active'),
    supabaseAdmin.from('payment_processor_registry').select('processor_code, processor_name, type, detection_keywords, xero_contact_patterns, bank_narration_patterns, is_active'),
  ])

  const entries: RegistryEntry[] = []
  const procCodes = new Set<string>()

  for (const m of (mpRes.data || [])) {
    if (!m.is_active) continue
    entries.push({
      code: m.marketplace_code,
      name: m.marketplace_name,
      keywords: (m.detection_keywords || []) as string[],
      xero_patterns: (m.xero_contact_patterns || []) as string[],
      bank_patterns: (m.bank_narration_patterns || []) as string[],
      is_processor: false,
    })
  }

  for (const p of (ppRes.data || [])) {
    if (!p.is_active) continue
    entries.push({
      code: p.processor_code,
      name: p.processor_name,
      keywords: (p.detection_keywords || []) as string[],
      xero_patterns: (p.xero_contact_patterns || []) as string[],
      bank_patterns: (p.bank_narration_patterns || []) as string[],
      is_processor: true,
      processor_type: p.type || 'payment_gateway',
    })
    procCodes.add(p.processor_code)
  }

  _registryCache = entries
  _processorCodes = procCodes
}

function isPaymentProcessor(code: string): boolean {
  if (_processorCodes) return _processorCodes.has(code)
  const FALLBACK = ['paypal','stripe','afterpay','zip','zippay','klarna','laybuy','humm','openpay','latitude','square','tyro','braintree']
  return FALLBACK.some(p => (code || '').toLowerCase().includes(p))
}

function isAdvertisingPlatform(code: string): boolean {
  if (!_registryCache) return false
  const entry = _registryCache.find(e => e.code === code)
  return entry?.processor_type === 'advertising_platform'
}

/** Word-boundary match for short patterns (≤5 chars) to prevent false positives */
function patternMatches(text: string, pattern: string): boolean {
  const lowerPattern = pattern.toLowerCase()
  if (lowerPattern.length <= 5) {
    // Short patterns require word boundaries (prevents "King George Square Car Park" matching "square")
    const regex = new RegExp(`\\b${lowerPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    return regex.test(text)
  }
  return text.includes(lowerPattern)
}

function matchesMarketplace(name: string): string | null {
  const lower = name.toLowerCase().trim()
  if (!_registryCache) return null

  // First check if this matches an advertising platform — skip entirely if so
  for (const entry of _registryCache) {
    if (entry.processor_type !== 'advertising_platform') continue
    const allPatterns = [...entry.keywords, ...entry.xero_patterns.map(p => p.toLowerCase())]
    for (const pattern of allPatterns) {
      if (patternMatches(lower, pattern)) {
        return null // Advertising platform — not a sales channel
      }
    }
  }

  for (const entry of _registryCache) {
    // Skip advertising platforms (already checked above)
    if (entry.processor_type === 'advertising_platform') continue
    const allPatterns = [...entry.keywords, ...entry.xero_patterns.map(p => p.toLowerCase())]
    for (const pattern of allPatterns) {
      if (patternMatches(lower, pattern)) {
        return entry.code
      }
    }
  }
  return null
}

function getRegistryName(code: string): string {
  if (_registryCache) {
    const entry = _registryCache.find(e => e.code === code)
    if (entry) return entry.name
  }
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
}

const REFERENCE_PATTERNS = [
  'xettle-', 'settlement', 'payout',
  'amazon', 'kogan', 'big w', 'mirakl',
  'bunnings', 'shopify', 'catch', 'ebay',
  'mydeal', 'woolworths', 'everyday market',
]

function referenceMatchesMarketplace(ref: string): boolean {
  const lower = (ref || '').toLowerCase()
  return REFERENCE_PATTERNS.some(p => lower.includes(p))
}

async function refreshXeroToken(supabase: any, userId: string, clientId: string, clientSecret: string) {
  const { data: tokenRow, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !tokenRow) return null

  const expiresAt = new Date(tokenRow.expires_at)
  if (expiresAt > new Date(Date.now() + 60000)) {
    return tokenRow
  }

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
    }),
  })

  if (!res.ok) return null

  const tokens = await res.json()
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

  await supabase
    .from('xero_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokenRow.refresh_token,
      expires_at: newExpiry,
    })
    .eq('user_id', userId)

  return { ...tokenRow, access_token: tokens.access_token, tenant_id: tokenRow.tenant_id }
}

async function xeroGet(url: string, accessToken: string, tenantId: string) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Xero API ${res.status}: ${body}`)
  }
  return res.json()
}

function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0]
  const ts = parseInt(raw)
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0]
  return raw.split('T')[0]
}

interface DetectedSettlement {
  marketplace: string
  last_recorded_date: string
  last_amount: number
  source: 'invoice' | 'bank_transaction' | 'journal' | 'contact_standalone'
  reference: string
  xero_id: string
  is_reconciled?: boolean
  bank_account_name?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = user.id

    // Load marketplace & processor registries from DB
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await loadRegistries(supabaseAdmin)

    const clientId = Deno.env.get('XERO_CLIENT_ID')!
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
    const tokenRow = await refreshXeroToken(supabase, userId, clientId, clientSecret)

    if (!tokenRow) {
      return new Response(JSON.stringify({ hasXero: false }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { access_token: accessToken, tenant_id: tenantId } = tokenRow

    const detectedMap = new Map<string, DetectedSettlement>()
    let hasXettlePrefix = false
    let hasMarketplaceContacts = false
    let hasBankPatterns = false
    const standaloneContacts: string[] = []

    // ─── 1. Scan Invoices ───────────────────────────────────────────
    try {
      const invoiceData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/Invoices?Statuses=DRAFT,AUTHORISED,PAID&order=Date DESC&pageSize=100`,
        accessToken, tenantId
      )

      for (const inv of (invoiceData.Invoices || [])) {
        const contactName = inv.Contact?.Name || ''
        const reference = inv.Reference || ''
        const invoiceNumber = inv.InvoiceNumber || ''
        const invoiceId = inv.InvoiceID || ''

        if (reference.toLowerCase().startsWith('xettle-')) {
          hasXettlePrefix = true
        }

        const marketplace = matchesMarketplace(contactName)
        const refMatches = referenceMatchesMarketplace(reference)

        if (marketplace || refMatches) {
          if (marketplace) hasMarketplaceContacts = true
          const key = marketplace || 'unknown'
          const dateStr = parseXeroDate(inv.Date)
          const amount = inv.Total || 0

          if (dateStr) {
            const existing = detectedMap.get(key)
            if (!existing || dateStr > existing.last_recorded_date) {
              detectedMap.set(key, {
                marketplace: key,
                last_recorded_date: dateStr,
                last_amount: amount,
                source: 'invoice',
                reference: invoiceNumber || reference || '',
                xero_id: invoiceId,
              })
            }
          }
        }
      }
    } catch (e) {
      console.error('Invoice scan error:', e)
    }

    // ─── 2. Scan Bank Transactions (with IsReconciled + BankAccount) ─
    let bankScanError: string | null = null
    try {
      const bankData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/BankTransactions?order=Date DESC&pageSize=100`,
        accessToken, tenantId
      )

      for (const txn of (bankData.BankTransactions || [])) {
        if (txn.Type !== 'RECEIVE') continue

        const contactName = txn.Contact?.Name || ''
        const reference = txn.Reference || ''
        const narration = txn.LineItems?.[0]?.Description || ''
        const txnId = txn.BankTransactionID || ''
        const amount = txn.Total || 0
        const isReconciled = txn.IsReconciled === true
        const bankAccountName = txn.BankAccount?.Name || null

        const marketplace = matchesMarketplace(contactName) || matchesMarketplace(narration) || matchesMarketplace(reference)

        if (marketplace) {
          hasBankPatterns = true
          const dateStr = parseXeroDate(txn.Date)

          if (dateStr) {
            const existing = detectedMap.get(marketplace)
            if (!existing || dateStr > existing.last_recorded_date) {
              detectedMap.set(marketplace, {
                marketplace,
                last_recorded_date: dateStr,
                last_amount: amount,
                source: existing?.source === 'invoice' && existing.last_recorded_date >= dateStr
                  ? 'invoice' : 'bank_transaction',
                reference: reference || narration || contactName,
                xero_id: txnId,
                is_reconciled: isReconciled,
                bank_account_name: bankAccountName,
              })
            }
          }
        }
      }
    } catch (e) {
      const errMsg = String(e)
      console.error('Bank transaction scan error:', e)
      if (errMsg.includes('401')) {
        bankScanError = 'Xero bank feed access denied — your connection may need to be re-authorised with bank transaction scopes.'
      } else {
        bankScanError = `Bank scan failed: ${errMsg}`
      }
    }

    // ─── 3. Scan ALL Contacts (standalone detection) ────────────────
    try {
      const contactsData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/Contacts?includeArchived=false&pageSize=100`,
        accessToken, tenantId
      )

      for (const contact of (contactsData.Contacts || [])) {
        const contactName = contact.Name || ''
        const marketplace = matchesMarketplace(contactName)

        if (marketplace && !detectedMap.has(marketplace)) {
          // Skip advertising platforms — they're expenses, not revenue sources
          if (isAdvertisingPlatform(marketplace)) {
            console.log(`[scan-xero-history] Advertising platform contact ${contactName} → ignored`)
            continue
          }
          // This marketplace exists as a Xero contact but has no invoices or bank txns yet
          standaloneContacts.push(contactName)
          detectedMap.set(marketplace, {
            marketplace,
            last_recorded_date: new Date().toISOString().split('T')[0],
            last_amount: 0,
            source: 'contact_standalone',
            reference: `Xero contact: ${contactName}`,
            xero_id: contact.ContactID || '',
          })
          hasMarketplaceContacts = true

          // Also create a channel_alert for visibility in Setup Hub
          await supabase.from('channel_alerts').upsert({
            user_id: userId,
            source_name: marketplace,
            detected_label: contactName,
            detection_method: 'xero_contact_standalone',
            alert_type: 'new',
            status: 'pending',
            order_count: 0,
            total_revenue: 0,
          }, { onConflict: 'user_id,source_name' })
        }
      }

      const unmatchedContacts: string[] = []

      for (const contact of (contactsData.Contacts || [])) {

        const contactName = contact.Name || ''

        const marketplace = matchesMarketplace(contactName)

        if (!marketplace && contactName.length > 3 && 

            !/^\d+$/.test(contactName)) {

          unmatchedContacts.push(contactName)

        }

      }

      if (unmatchedContacts.length > 0) {

        await supabase.from('system_events').insert({

          user_id: userId,

          event_type: 'xero_unmatched_contacts_detected',

          severity: 'info',

          details: { 

            count: unmatchedContacts.length, 

            contacts: unmatchedContacts 

          }

        })

      }
      console.log(`[scan-xero-history] Standalone contacts found: ${standaloneContacts.length}`, standaloneContacts)
      console.log(`[scan-xero-history] Unmatched contacts for classification: ${unmatchedContacts.length}`)
    } catch (e) {
      console.error('Contacts scan error:', e)
    }

    // ─── 4. Determine boundary ──────────────────────────────────────
    const detected_settlements = Array.from(detectedMap.values())
    let accounting_boundary_date: string | null = null

    // Only use settlements with actual financial data for boundary (not standalone contacts)
    const financialDetections = detected_settlements.filter(s => s.source !== 'contact_standalone')
    if (financialDetections.length > 0) {
      const latestDate = financialDetections.reduce((latest, s) =>
        s.last_recorded_date > latest ? s.last_recorded_date : latest,
        financialDetections[0].last_recorded_date
      )
      const d = new Date(latestDate)
      d.setDate(d.getDate() + 1)
      accounting_boundary_date = d.toISOString().split('T')[0]
    }

    // ─── 5. Confidence ──────────────────────────────────────────────
    let confidence: 'high' | 'medium' | 'low' = 'low'
    let confidence_reason = ''

    if (hasXettlePrefix) {
      confidence = 'high'
      confidence_reason = 'Found Xettle-prefixed invoices — previous Xettle usage detected.'
    } else if (hasMarketplaceContacts) {
      confidence = 'medium'
      confidence_reason = 'Found marketplace-named contacts in Xero.'
    } else if (hasBankPatterns) {
      confidence = 'low'
      confidence_reason = 'Found bank transaction patterns only — no invoices matched.'
    } else {
      confidence_reason = 'No marketplace history found in Xero.'
    }

    // ─── 6. PERSIST detected marketplaces as marketplace_connections ─
    // Payment processors get channel_alerts instead of marketplace_connections
    let marketplaces_created = 0
    let gateway_alerts_created = 0
    for (const det of detected_settlements) {
      if (det.marketplace === 'unknown') continue

      const displayName = getRegistryName(det.marketplace)

      // Advertising platforms (Meta, Google Ads, etc.) — silently ignore, not revenue
      if (isAdvertisingPlatform(det.marketplace)) {
        console.log(`[scan-xero-history] Advertising platform ${det.marketplace} → ignored (expense, not revenue)`)
        continue
      }

      // Payment processors → channel_alert, NOT marketplace_connection
      if (isPaymentProcessor(det.marketplace)) {
        // Filter out zero/negative value deposits — not actionable
        if ((det.last_amount || 0) <= 0) {
          console.log(`[scan-xero-history] Payment processor ${det.marketplace} → skipped (zero/negative amount)`)
          continue
        }
        await supabase.from('channel_alerts').upsert({
          user_id: userId,
          source_name: det.marketplace,
          detected_label: displayName,
          detection_method: det.source === 'bank_transaction' ? 'xero_bank_deposit' : 'xero_contact',
          alert_type: 'payment_gateway_deposit',
          status: 'pending',
          deposit_amount: det.last_amount || null,
          deposit_date: det.last_recorded_date || null,
          deposit_description: det.reference || null,
          order_count: 0,
          total_revenue: det.last_amount || 0,
        }, { onConflict: 'user_id,source_name' })
        gateway_alerts_created++
        console.log(`[scan-xero-history] Payment processor ${det.marketplace} → channel_alert (not marketplace)`)
        continue
      }

      const { error: upsertErr } = await supabase
        .from('marketplace_connections')
        .upsert({
          user_id: userId,
          marketplace_code: det.marketplace,
          marketplace_name: displayName,
          country_code: 'AU',
          connection_type: 'auto_detected',
          connection_status: 'active',
          settings: {
            detected_from: det.source === 'contact_standalone' ? 'xero_contact' : 'xero_scan',
            last_xero_date: det.last_recorded_date,
            last_xero_amount: det.last_amount,
            xero_source: det.source,
            xero_reference: det.reference,
            is_reconciled: det.is_reconciled ?? null,
            bank_account_name: det.bank_account_name ?? null,
          },
        }, { onConflict: 'user_id,marketplace_code,country_code' })
      if (!upsertErr) marketplaces_created++
      else console.error(`Failed to upsert marketplace_connection for ${det.marketplace}:`, upsertErr)
    }

    // ─── 6b. Extract contact→account mappings from invoices ────────
    const contactAccountCounts = new Map<string, Map<string, number>>()
    try {
      const invoiceData2 = await xeroGet(
        `https://api.xero.com/api.xro/2.0/Invoices?Statuses=AUTHORISED,PAID&order=Date DESC&pageSize=100`,
        accessToken, tenantId
      )
      for (const inv of (invoiceData2.Invoices || [])) {
        const contactName = (inv.Contact?.Name || '').trim()
        if (!contactName) continue
        for (const li of (inv.LineItems || [])) {
          const code = li.AccountCode
          if (!code) continue
          if (!contactAccountCounts.has(contactName)) {
            contactAccountCounts.set(contactName, new Map())
          }
          const codeMap = contactAccountCounts.get(contactName)!
          codeMap.set(code, (codeMap.get(code) || 0) + 1)
        }
      }

      // Persist mappings with usage_count >= 3
      for (const [contactName, codeMap] of contactAccountCounts) {
        const totalUsage = Array.from(codeMap.values()).reduce((a, b) => a + b, 0)
        for (const [code, count] of codeMap) {
          if (count < 3) continue
          const confidencePct = Math.round((count / totalUsage) * 100)
          await supabaseAdmin.from('xero_contact_account_mappings').upsert({
            user_id: userId,
            contact_name: contactName,
            account_code: code,
            usage_count: count,
            confidence_pct: confidencePct,
            last_seen: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,contact_name,account_code' })
        }
      }
      console.log(`[scan-xero-history] Contact→account mappings extracted for ${contactAccountCounts.size} contacts`)
    } catch (e) {
      console.error('Contact→account mapping extraction error:', e)
    }

    // ─── 7. PERSIST accounting boundary date ────────────────────────
    if (accounting_boundary_date) {
      // BUILD 1 — Reject future boundary dates server-side
      const today = new Date().toISOString().split('T')[0]
      if (accounting_boundary_date > today) {
        console.warn(`[scan-xero-history] Boundary date ${accounting_boundary_date} is in the future — clamping to today`)
        accounting_boundary_date = today
      }

      const { data: existingBoundary } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', 'accounting_boundary_date')
        .maybeSingle()

      if (existingBoundary) {
        await supabase.from('app_settings')
          .update({ value: accounting_boundary_date })
          .eq('id', existingBoundary.id)
      } else {
        await supabase.from('app_settings')
          .insert({
            user_id: userId,
            key: 'accounting_boundary_date',
            value: accounting_boundary_date,
          })
      }
    }

    // ─── 8. Mark scan as completed ──────────────────────────────────
    const { data: existingScanFlag } = await supabase
      .from('app_settings')
      .select('id')
      .eq('key', 'xero_scan_completed')
      .maybeSingle()

    if (existingScanFlag) {
      await supabase.from('app_settings')
        .update({ value: new Date().toISOString() })
        .eq('id', existingScanFlag.id)
    } else {
      await supabase.from('app_settings')
        .insert({
          user_id: userId,
          key: 'xero_scan_completed',
          value: new Date().toISOString(),
        })
    }

    // ─── 9. Log system event ────────────────────────────────────────
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'xero_scan_completed',
      severity: 'info',
      details: {
        marketplaces_detected: detected_settlements.length,
        marketplaces_created,
        gateway_alerts_created,
        standalone_contacts: standaloneContacts,
        accounting_boundary_date,
        confidence,
        confidence_reason,
      },
    })

    console.log(`[scan-xero-history] User ${userId}: detected ${detected_settlements.length} marketplaces, created ${marketplaces_created} connections + ${gateway_alerts_created} gateway alerts, boundary: ${accounting_boundary_date}`)

    // ─── 10. Trigger validation sweep server-side as backup ─────────
    try {
      const sweepUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/run-validation-sweep`
      await fetch(sweepUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader!,
        },
        body: JSON.stringify({}),
      })
      console.log(`[scan-xero-history] Validation sweep triggered for user ${userId}`)
    } catch (sweepErr) {
      console.warn('[scan-xero-history] Validation sweep failed (non-blocking):', sweepErr)
    }

    return new Response(JSON.stringify({
      hasXero: true,
      accounting_boundary_date,
      detected_settlements,
      standalone_contacts: standaloneContacts,
      marketplaces_created,
      gateway_alerts_created,
      confidence,
      confidence_reason,
      bank_scan_error: bankScanError,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('scan-xero-history error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
