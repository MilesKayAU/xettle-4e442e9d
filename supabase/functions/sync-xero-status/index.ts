import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getCorsHeaders } from '../_shared/cors.ts';
import { safeUpsertXam } from '../_shared/xam-safe-upsert.ts';
import { logger } from '../_shared/logger.ts';
import { XERO_TOKEN_URL, XERO_API_BASE, getXeroHeaders } from '../_shared/xero-api-policy.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const xeroClientId = Deno.env.get('XERO_CLIENT_ID')!;
const xeroClientSecret = Deno.env.get('XERO_CLIENT_SECRET')!;

interface XeroToken {
  id: string;
  user_id: string;
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

async function refreshToken(supabase: any, token: XeroToken): Promise<XeroToken> {
  const expiresAt = new Date(token.expires_at);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return token;

  // Optimistic locking: re-read to detect concurrent refresh
  const { data: freshToken } = await supabase
    .from('xero_tokens').select('*').eq('id', token.id).single();
  if (freshToken && freshToken.expires_at !== token.expires_at) {
    return { ...token, ...freshToken } as XeroToken;
  }

  const resp = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: freshToken?.refresh_token || token.refresh_token }),
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const data = await resp.json();
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase.from('xero_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', token.id);

  return { ...token, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: newExpiresAt };
}

// ─── Paginated Xero invoice query with optional ModifiedAfter ───
// GOVERNOR (P2): 0 retries on 429. On 429: set shared cooldown, stop immediately.
async function queryXeroInvoicesPaginated(
  token: XeroToken,
  whereClause: string,
  modifiedAfter?: string,
  supabaseAdmin?: any,
  userId?: string,
): Promise<any[]> {
  const allInvoices: any[] = [];
  let page = 1;
  const maxPages = 10;

  while (page <= maxPages) {
    const url = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(whereClause)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&page=${page}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token.access_token}`,
      'Accept': 'application/json',
      'Xero-tenant-id': token.tenant_id,
    };
    if (modifiedAfter) {
      headers['If-Modified-Since'] = modifiedAfter;
    }

    const resp = await fetch(url, { headers });

    // ── Audit log ──
    if (supabaseAdmin && userId) {
      await supabaseAdmin.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_api_call',
        severity: resp.ok ? 'info' : (resp.status === 429 ? 'warning' : 'error'),
        details: {
          timestamp_utc: new Date().toISOString(),
          function_name: 'sync-xero-status',
          invoker: 'self',
          endpoint: `Invoices (paginated page=${page})`,
          attempt_number: 1,
          governor_decision: 'allowed',
          http_status: resp.status,
        },
      });
    }

    if (resp.status === 429) {
      console.warn(`[queryXeroInvoicesPaginated] 429 on page ${page} — 0 retries, setting shared cooldown`);
      if (supabaseAdmin && userId) {
        const retryAfterSec = Math.max(60, Math.min(300, parseInt(resp.headers.get('Retry-After') || '90') || 90));
        await supabaseAdmin.from('app_settings').upsert({
          user_id: userId,
          key: 'xero_api_cooldown_until',
          value: new Date(Date.now() + retryAfterSec * 1000).toISOString(),
        }, { onConflict: 'user_id,key' });
      }
      break; // Stop all pagination immediately
    }

    if (resp.status === 304) break; // Not modified
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Xero query failed page ${page} (${whereClause}):`, resp.status, errText.substring(0, 300));
      break;
    }
    const result = await resp.json();
    const invoices = result.Invoices || [];
    allInvoices.push(...invoices);
    if (invoices.length < 100) break;
    page++;
  }
  return allInvoices;
}

// ─── Batch status check: fetch multiple invoices by ID in one call ───
// GOVERNOR (P2): 0 retries on 429. Stop immediately on rate limit.
async function batchVerifyInvoiceStatuses(
  token: XeroToken,
  invoiceIds: string[],
  supabaseAdmin?: any,
  userId?: string,
): Promise<Map<string, { status: string; total: number }>> {
  const results = new Map<string, { status: string; total: number }>();
  if (invoiceIds.length === 0) return results;

  const batchSize = 50;
  for (let i = 0; i < invoiceIds.length; i += batchSize) {
    // ── Check shared cooldown before each batch ──
    if (supabaseAdmin && userId) {
      const { data: cdRow } = await supabaseAdmin
        .from('app_settings').select('value')
        .eq('user_id', userId).eq('key', 'xero_api_cooldown_until')
        .maybeSingle();
      if (cdRow?.value && new Date(cdRow.value).getTime() > Date.now()) {
        console.log(`[batchVerifyInvoiceStatuses] GOVERNOR: cooldown active — stopping batch verify`);
        break;
      }
    }

    const batch = invoiceIds.slice(i, i + batchSize);
    const idsParam = batch.join(',');
    const url = `https://api.xero.com/api.xro/2.0/Invoices?IDs=${idsParam}`;
    try {
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': token.tenant_id,
        },
      });

      // ── Audit log ──
      if (supabaseAdmin && userId) {
        await supabaseAdmin.from('system_events').insert({
          user_id: userId,
          event_type: 'xero_api_call',
          severity: resp.ok ? 'info' : (resp.status === 429 ? 'warning' : 'error'),
          details: {
            timestamp_utc: new Date().toISOString(),
            function_name: 'sync-xero-status',
            invoker: 'self',
            endpoint: `Invoices (batch verify, ${batch.length} IDs)`,
            attempt_number: 1,
            governor_decision: 'allowed',
            http_status: resp.status,
          },
        });
      }

      if (resp.status === 429) {
        console.warn(`[batchVerifyInvoiceStatuses] 429 — 0 retries, setting shared cooldown`);
        if (supabaseAdmin && userId) {
          const retryAfterSec = Math.max(60, Math.min(300, parseInt(resp.headers.get('Retry-After') || '90') || 90));
          await supabaseAdmin.from('app_settings').upsert({
            user_id: userId,
            key: 'xero_api_cooldown_until',
            value: new Date(Date.now() + retryAfterSec * 1000).toISOString(),
          }, { onConflict: 'user_id,key' });
        }
        break; // Stop all batches
      }

      if (resp.ok) {
        const data = await resp.json();
        for (const inv of (data.Invoices || [])) {
          results.set(inv.InvoiceID, { status: inv.Status, total: inv.Total || 0 });
        }
      } else {
        console.error(`Batch verify failed (${resp.status})`);
      }
    } catch (e) {
      console.error('Batch verify error:', e);
    }
  }
  return results;
}

function extractSettlementId(reference: string): string | null {
  if (reference.startsWith('Xettle-')) {
    return reference.slice(7).replace(/-P[12]$/, '');
  }
  if (reference.startsWith('AMZN-')) {
    return reference.slice(5);
  }
  const lmbMatch = reference.match(/LMB-\w+-(\d+)-\d+/);
  if (lmbMatch) return lmbMatch[1];
  const numericMatch = reference.match(/\b(\d{8,})\b/);
  if (numericMatch) return numericMatch[1];
  const shopifyMatch = reference.match(/(Shopify-[\w]+)/);
  if (shopifyMatch) return shopifyMatch[1];
  const genericMatch = reference.match(/(\d+_\w+)/);
  if (genericMatch) return genericMatch[1];
  const parenMatch = reference.match(/\(([^)]+)\)/);
  if (parenMatch && /\d/.test(parenMatch[1]) && parenMatch[1].length > 3) {
    return parenMatch[1];
  }
  return null;
}

function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null;
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0];
  const ts = parseInt(raw);
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0];
  return raw.split('T')[0];
}

// ─── Contact → marketplace mapping ─────────────────────────────────
// Order matters: specific patterns MUST come before generic ones.
// Each entry is checked in array order; first match wins.
// E.g. 'amazon.com.au' must precede 'amazon.com' which must precede 'amazon'.
const MARKETPLACE_CONTACT_PATTERNS_ORDERED: [string, string[]][] = [
  // Amazon — specific regions first, generic fallback last
  ['amazon_au', ['amazon.com.au', 'amazon au']],
  ['amazon_us', ['amazon.com', 'amazon us', 'amazon usa']],
  ['amazon_jp', ['amazon japan', 'amazon.co.jp', 'amazon jp']],
  ['amazon_sg', ['amazon singapore', 'amazon.sg', 'amazon sg']],
  ['amazon_au', ['amzn']],  // legacy AMZN abbreviation defaults to AU if no region hint
  // Non-Amazon marketplaces (order doesn't matter for these)
  ['kogan', ['kogan']],
  ['bigw', ['big w', 'bigw']],
  ['bunnings', ['bunnings']],
  ['mydeal', ['mydeal', 'my deal', 'e-com (aus)']],
  ['catch', ['catch']],
  ['shopify_payments', ['shopify']],
  ['ebay_au', ['ebay']],
  ['woolworths', ['woolworths', 'woolies', 'everyday market']],
  ['theiconic', ['iconic', 'the iconic']],
  ['etsy', ['etsy']],
];

function detectMarketplaceFromContact(contactName: string): string | null {
  const lower = contactName.toLowerCase();
  for (const [code, patterns] of MARKETPLACE_CONTACT_PATTERNS_ORDERED) {
    if (patterns.some(p => lower.includes(p))) return code;
  }
  return null;
}

function deriveCurrencyFromMarketplace(marketplace: string): string {
  const m = marketplace.toLowerCase();
  if (m.endsWith('_us')) return 'USD';
  if (m.endsWith('_uk') || m.endsWith('_gb')) return 'GBP';
  if (m.endsWith('_eu') || m.endsWith('_de') || m.endsWith('_fr') || m.endsWith('_it') || m.endsWith('_es')) return 'EUR';
  if (m.endsWith('_ca')) return 'CAD';
  if (m.endsWith('_jp')) return 'JPY';
  if (m.endsWith('_in')) return 'INR';
  if (m.endsWith('_sg')) return 'SGD';
  if (m.endsWith('_nz')) return 'NZD';
  return 'AUD';
}

async function generateSettlementStyleFingerprint(marketplace: string, periodStart: string, periodEnd: string, netAmount: number): Promise<string> {
  const currency = deriveCurrencyFromMarketplace(marketplace);
  const input = `${marketplace}|${currency}|${periodStart}|${periodEnd}|${netAmount}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function deriveStatus(inv: any): { status: string; syncOrigin: string } {
  const ref = inv.Reference || '';
  const isXettleFormat = ref.startsWith('Xettle-');
  if (isXettleFormat) {
    switch (inv.Status) {
      case 'DRAFT': return { status: 'pushed_to_xero', syncOrigin: 'xettle' };
      case 'AUTHORISED': return { status: 'pushed_to_xero', syncOrigin: 'xettle' };
      case 'PAID': return { status: 'reconciled_in_xero', syncOrigin: 'xettle' };
      default: return { status: 'pushed_to_xero', syncOrigin: 'xettle' };
    }
  }
  // ─── SAFETY INVARIANT: External invoices must NEVER appear as "posted by Xettle" ───
  // They get 'already_recorded' status and 'external' origin.
  return { status: 'already_recorded', syncOrigin: 'external' };
}

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ─── JWT VERIFICATION ──────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user: authUser }, error: userError } = await anonClient.auth.getUser();
    if (userError || !authUser) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const userId = authUser.id;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Xero token
    const { data: tokens, error: tokenErr } = await supabase
      .from('xero_tokens').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1);
    if (tokenErr || !tokens?.length) {
      return new Response(JSON.stringify({ success: false, error: 'No Xero connection found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    let token = tokens[0] as XeroToken;
    token = await refreshToken(supabase, token);

    console.log(`[sync-xero-status] ═══ Cache-first pipeline for user ${userId} ═══`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 1: Load existing cache (xero_accounting_matches)
    // ════════════════════════════════════════════════════════════════════
    const { data: cachedMatches } = await supabase
      .from('xero_accounting_matches')
      .select('*')
      .eq('user_id', userId);

    const cacheBySettlement = new Map<string, any>();
    const cachedInvoiceIds: string[] = [];
    for (const m of (cachedMatches || [])) {
      cacheBySettlement.set(m.settlement_id, m);
      if (m.xero_invoice_id) cachedInvoiceIds.push(m.xero_invoice_id);
    }
    console.log(`[step-1] Loaded ${cacheBySettlement.size} cached matches`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 2: Batch-verify status of all cached invoices (1-2 API calls)
    // GOVERNOR: Check cooldown before batch verify (P2 priority)
    // ════════════════════════════════════════════════════════════════════
    let cacheVerified = 0;
    let cacheStatusChanged = 0;
    let step2Skipped = false;
    if (cachedInvoiceIds.length > 0) {
      // Check shared cooldown first
      const { data: cdRow } = await supabase
        .from('app_settings').select('value')
        .eq('user_id', userId).eq('key', 'xero_api_cooldown_until')
        .maybeSingle();
      const cdActive = cdRow?.value && new Date(cdRow.value).getTime() > Date.now();

      if (cdActive) {
        console.log(`[step-2] GOVERNOR: cooldown active — skipping batch verify to preserve quota for bank sync`);
        step2Skipped = true;
      } else {
        const freshStatuses = await batchVerifyInvoiceStatuses(token, cachedInvoiceIds, supabase, userId);
        console.log(`[step-2] Batch-verified ${freshStatuses.size}/${cachedInvoiceIds.length} invoices`);

      for (const [settlementId, cached] of cacheBySettlement.entries()) {
        if (!cached.xero_invoice_id) continue;
        const fresh = freshStatuses.get(cached.xero_invoice_id);
        if (!fresh) continue; // Invoice may have been voided/deleted

        cacheVerified++;
        const statusChanged = fresh.status !== cached.xero_status;

        if (statusChanged) {
          cacheStatusChanged++;
          // Determine derived status using fresh Xero status
          const isXettleFormat = (cached.matched_reference || '').startsWith('Xettle-');
          let derivedStatus: string;
          let syncOrigin = 'xettle';
          if (isXettleFormat) {
            switch (fresh.status) {
              case 'PAID': derivedStatus = 'reconciled_in_xero'; break;
              default: derivedStatus = 'pushed_to_xero'; break;
            }
          } else {
            // ─── SAFETY: External invoices never get 'pushed_to_xero' ───
            derivedStatus = 'already_recorded';
            syncOrigin = 'external';
          }

          const updatePayload: Record<string, any> = {
            xero_status: fresh.status,
            status: derivedStatus,
            sync_origin: syncOrigin,
          };
          if (fresh.status === 'PAID') {
            updatePayload.bank_verified = true;
            updatePayload.bank_verified_at = new Date().toISOString();
            updatePayload.bank_verified_by = null;
          }

          await supabase.from('settlements').update(updatePayload)
            .eq('settlement_id', settlementId).eq('user_id', userId);

          // Update cache
          await supabase.from('xero_accounting_matches').update({
            xero_status: fresh.status,
            updated_at: new Date().toISOString(),
          }).eq('user_id', userId).eq('settlement_id', settlementId);
        }
      }
      console.log(`[step-2] ${cacheStatusChanged} status changes detected out of ${cacheVerified} verified`);
      } // end else (not cooldown blocked)
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 3: Find settlements with NO cache entry
    // ════════════════════════════════════════════════════════════════════
    const { data: allSettlements } = await supabase
      .from('settlements')
      .select('settlement_id, marketplace, period_start, period_end, bank_deposit, net_ex_gst, status, settlement_fingerprint, is_pre_boundary, duplicate_of_settlement_id')
      .eq('user_id', userId)
      .eq('is_pre_boundary', false)
      .is('duplicate_of_settlement_id', null)
      .neq('status', 'push_failed_permanent');

    const uncachedSettlements = (allSettlements || []).filter(
      s => !cacheBySettlement.has(s.settlement_id)
    );
    console.log(`[step-3] ${uncachedSettlements.length} settlements have no cache entry (of ${allSettlements?.length || 0} total)`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 3b: Outstanding discovery — with per-user rate-limit cooldown guard
    // ════════════════════════════════════════════════════════════════════
    {
      // Check cooldown before making heavy Xero API calls
      const { data: cooldownSetting } = await supabase
        .from('app_settings').select('value')
        .eq('user_id', userId).eq('key', 'xero_api_cooldown_until')
        .maybeSingle();

      const cooldownUntil = cooldownSetting?.value ? new Date(cooldownSetting.value) : null;
      const isCoolingDown = cooldownUntil && cooldownUntil > new Date();

      if (isCoolingDown) {
        console.log(`[step-3b] Skipping outstanding discovery: API cooldown active until ${cooldownUntil!.toISOString()}`);
      } else {
        console.log(`[step-3b] Running outstanding discovery (Xero-first priority)`);

        const { data: cursorSetting } = await supabase
          .from('app_settings').select('value')
          .eq('user_id', userId).eq('key', `xero_last_invoice_scan_at_${token.tenant_id}`)
          .maybeSingle();
        const modifiedAfter = cursorSetting?.value || null;

        let outstandingInvoices: any[] = [];
        try {
          outstandingInvoices = await queryXeroInvoicesPaginated(token, 'Type=="ACCREC"', modifiedAfter, supabase, userId);
        } catch (e: any) {
          // queryXeroInvoicesPaginated now handles 429 internally (sets cooldown, 0 retries)
          console.warn('[step-3b] Invoice query threw:', e?.message);
        }

        // Also set cooldown if we got 0 invoices (likely silent 429/failure)
        if (outstandingInvoices.length === 0 && cacheBySettlement.size > 0) {
          console.log(`[step-3b] Got 0 invoices but have ${cacheBySettlement.size} cached — possible silent rate limit`);
        }

        console.log(`[step-3b] Pulled ${outstandingInvoices.length} candidate Xero invoices`);

        const localSettlementIds = new Set((allSettlements || []).map(s => s.settlement_id));
      let seededCount = 0;

      for (const inv of outstandingInvoices) {
        const sid = extractSettlementId(inv.Reference || '');
        if (!sid) continue;
        if (cacheBySettlement.has(sid)) continue;

        const ref = inv.Reference || '';
        const isExternalInvoice = !ref.toLowerCase().startsWith('xettle-');

        // For external invoices (LMB, A2X, etc.), we want to match them even if
        // we have a local settlement — this is how we detect "already in Xero".
        // For Xettle invoices, skip if we already have the settlement locally.
        if (!isExternalInvoice && localSettlementIds.has(sid)) continue;
        // Only filter status for non-external invoices (seeding outstanding)
        if (!isExternalInvoice && !['DRAFT', 'SUBMITTED', 'AUTHORISED'].includes(inv.Status || '')) continue;

        const contactName = inv.Contact?.Name || '';
        const detectedMarketplace = detectMarketplaceFromContact(contactName);

        // Skip marketplace assignment if contact cannot be classified — avoids
        // polluting Amazon connector expectations with unrelated Xero invoices
        if (!detectedMarketplace) {
          console.log(`[step-3b] Skipping unclassified contact "${contactName}" for invoice ${inv.InvoiceNumber || inv.InvoiceID}`);
          continue;
        }

        // ─── SAFETY: Only auto-link Xettle-created invoices ─────────────
        // External invoices (AMZN-, LMB-, A2X-, etc.) are stored as candidates
        // for user review — they are NEVER auto-linked to settlements.
        const isXettleCreated = ref.toLowerCase().startsWith('xettle-');

        // ─── HARD GUARD: Verify push event exists before trusting Xettle prefix ──
        let confirmedXettle = false;
        if (isXettleCreated) {
          const { data: pushEvt } = await supabase
            .from('system_events')
            .select('id')
            .eq('user_id', userId)
            .eq('event_type', 'xero_push_success')
            .eq('settlement_id', sid)
            .limit(1);
          confirmedXettle = (pushEvt && pushEvt.length > 0);
          if (!confirmedXettle) {
            console.warn(`[step-3b] Xettle-prefixed ref "${ref}" but NO push event for ${sid} — treating as external_candidate`);
          }
        }

        await safeUpsertXam(supabase, {
          user_id: userId,
          settlement_id: sid,
          marketplace_code: detectedMarketplace,
          xero_invoice_id: inv.InvoiceID,
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_type: inv.Type === 'ACCPAY' ? 'bill' : 'invoice',
          match_method: confirmedXettle ? 'xero_pre_seed' : 'external_candidate',
          confidence: confirmedXettle ? 1.0 : 0.0,
          matched_amount: inv.Total || null,
          matched_date: parseXeroDate(inv.Date),
          matched_contact: contactName,
          matched_reference: ref,
          reference_hash: ref.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || null,
          notes: confirmedXettle
            ? 'Pre-seeded from Xettle-created Xero invoice (push event verified)'
            : 'External invoice detected — requires user review before linking',
        });

        seededCount++;
      }

      const nowIso = new Date().toISOString();
      await supabase.from('app_settings').upsert({
        user_id: userId,
        key: `xero_last_invoice_scan_at_${token.tenant_id}`,
        value: nowIso,
      }, { onConflict: 'user_id,key' });

      // Persist oldest outstanding invoice date for downstream sync window calculation
      let oldestOutstandingDate: string | null = null;
      for (const inv of outstandingInvoices) {
        if (!['DRAFT', 'SUBMITTED', 'AUTHORISED'].includes(inv.Status || '')) continue;
        const invDate = parseXeroDate(inv.Date);
        if (invDate && (!oldestOutstandingDate || invDate < oldestOutstandingDate)) {
          oldestOutstandingDate = invDate;
        }
      }
      if (oldestOutstandingDate) {
        await supabase.from('app_settings').upsert({
          user_id: userId,
          key: 'xero_oldest_outstanding_date',
          value: oldestOutstandingDate,
        }, { onConflict: 'user_id,key' });
        console.log(`[step-3b] Oldest outstanding Xero invoice date: ${oldestOutstandingDate}`);
      }

      const { data: stillUnmatched } = await supabase
        .from('settlements').select('settlement_id').eq('user_id', userId)
        .is('xero_journal_id', null).in('status', ['ingested', 'ready_to_push']);

      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_audit_complete',
        severity: 'info',
        details: {
          mode: 'cache_plus_outstanding_seed',
          cache_verified: cacheVerified,
          cache_status_changed: cacheStatusChanged,
          outstanding_seeded: seededCount,
          invoices_scanned: outstandingInvoices.length,
          oldest_outstanding_date: oldestOutstandingDate,
          unmatched: stillUnmatched?.length || 0,
          cursor_saved: nowIso,
        },
      });
      } // end if (!isCoolingDown)
    }

    // If there are no uncached local settlements, we're done after the outstanding discovery
    if (uncachedSettlements.length === 0) {
      const { data: stillUnmatched } = await supabase
        .from('settlements').select('settlement_id').eq('user_id', userId)
        .is('xero_journal_id', null).in('status', ['ingested', 'ready_to_push']);

      return new Response(JSON.stringify({
        success: true,
        updated: cacheStatusChanged,
        fuzzy_matched: 0,
        pre_seeded: 0,
        unmatched: stillUnmatched?.length || 0,
        total: cacheVerified,
        mode: 'cache_plus_outstanding_seed',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load incremental cursor for full reference scan
    // If many settlements are unmatched, do a full scan to catch older external invoices
    const uncachedCount = uncachedSettlements.length;
    const { data: cursorSetting } = await supabase
      .from('app_settings').select('value')
      .eq('user_id', userId).eq('key', `xero_last_invoice_scan_at_${token.tenant_id}`)
      .maybeSingle();
    const modifiedAfter = (uncachedCount > 10) ? null : (cursorSetting?.value || null);
    if (uncachedCount > 10) {
      console.log(`[step-4] ${uncachedCount} unmatched — forcing FULL SCAN (ignoring cursor)`);
    } else {
      console.log(`[step-4] Incremental cursor: ${modifiedAfter || 'FULL SCAN (first run)'}`);
    }
    // Run reference queries — only for new/modified invoices
    const newFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.StartsWith("Xettle-")', modifiedAfter);
    const oldFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("Settlement")', modifiedAfter);
    const amznFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.StartsWith("AMZN-")', modifiedAfter);
    const lmbFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("LMB-")', modifiedAfter);
    const shopifyFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("Shopify")', modifiedAfter);
    const payoutFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("Payout")', modifiedAfter);
    const shopifyContactInvoices = await queryXeroInvoicesPaginated(token, 'Contact.Name.Contains("Shopify")', modifiedAfter);

    const allInvoices = [
      ...newFormatInvoices, ...oldFormatInvoices, ...amznFormatInvoices,
      ...lmbFormatInvoices, ...shopifyFormatInvoices, ...payoutFormatInvoices,
      ...shopifyContactInvoices,
    ];
    // Deduplicate by InvoiceID
    const invoiceMap = new Map<string, any>();
    for (const inv of allInvoices) {
      if (!invoiceMap.has(inv.InvoiceID)) invoiceMap.set(inv.InvoiceID, inv);
    }
    const dedupedInvoices = Array.from(invoiceMap.values());
    console.log(`[step-4] Found ${dedupedInvoices.length} invoices from incremental scan`);

    // Extract settlement IDs from references
    // Group ALL invoices by settlement ID to find the best match (prefer PAID, then Xettle-)
    const allBySid = new Map<string, any[]>();
    for (const inv of dedupedInvoices) {
      const sid = extractSettlementId(inv.Reference || '');
      if (!sid) continue;
      if (!allBySid.has(sid)) allBySid.set(sid, []);
      allBySid.get(sid)!.push(inv);
    }
    // Pick best invoice per settlement: prefer PAID status, then Xettle- prefix
    const seen = new Map<string, any>();
    for (const [sid, invs] of allBySid.entries()) {
      const paid = invs.find(i => i.Status === 'PAID');
      const xettle = invs.find(i => (i.Reference || '').startsWith('Xettle-'));
      seen.set(sid, paid || xettle || invs[0]);
    }

    // Update settlements + cache for reference hits
    // Allow overwrite of cached entries if the new match has PAID status (more definitive)
    let updated = 0;
    for (const [settlementId, inv] of seen.entries()) {
      const cachedEntry = cacheBySettlement.get(settlementId);
      // Skip if already cached AND the cached status is same or better
      if (cachedEntry && cachedEntry.xero_status === 'PAID') continue;
      // If cached but not PAID, allow PAID to overwrite
      if (cachedEntry && inv.Status !== 'PAID') continue;

      const ref = inv.Reference || '';
      const isXettleFormat = ref.startsWith('Xettle-');
      const contactName = inv.Contact?.Name || '';
      const detectedMarketplace = detectMarketplaceFromContact(contactName);
      // Skip unclassified contacts — don't default to amazon_au
      if (!detectedMarketplace) {
        console.log(`[step-4] Skipping unclassified contact "${contactName}" for settlement ${settlementId}`);
        continue;
      }

      // ─── SAFETY INVARIANT: Only auto-link Xettle-created invoices ─────────
      // External invoices are stored as candidates for user review, not auto-linked.
      if (!isXettleFormat) {
        const refHash = ref.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || null;
        await safeUpsertXam(supabase, {
          user_id: userId,
          settlement_id: settlementId,
          marketplace_code: detectedMarketplace,
          xero_invoice_id: inv.InvoiceID,
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_type: inv.Type === 'ACCPAY' ? 'bill' : 'invoice',
          match_method: 'external_candidate',
          confidence: 0.0,
          matched_amount: inv.Total || null,
          matched_date: parseXeroDate(inv.Date),
          matched_contact: contactName,
          matched_reference: ref,
          reference_hash: refHash,
          notes: 'External invoice detected — requires user review before linking',
        });
        console.log(`[step-4] External invoice ${inv.InvoiceNumber || inv.InvoiceID} stored as candidate for settlement ${settlementId}`);
        continue;
      }

      // ─── HARD GUARD: Xettle-prefix alone is insufficient ──────────────
      // Verify a xero_push_success event exists for this settlement before
      // accepting it as "posted by Xettle". Without this, a manually created
      // Xero invoice with "Xettle-" prefix would be falsely adopted.
      const { data: pushEvent } = await supabase
        .from('system_events')
        .select('id')
        .eq('user_id', userId)
        .eq('event_type', 'xero_push_success')
        .eq('settlement_id', settlementId)
        .limit(1);

      if (!pushEvent || pushEvent.length === 0) {
        // No push event found — treat as external candidate, not Xettle-posted
        console.warn(`[step-4] Xettle-prefixed ref "${ref}" but NO xero_push_success event for ${settlementId} — treating as external_candidate`);
        await safeUpsertXam(supabase, {
          user_id: userId,
          settlement_id: settlementId,
          marketplace_code: detectedMarketplace,
          xero_invoice_id: inv.InvoiceID,
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_type: inv.Type === 'ACCPAY' ? 'bill' : 'invoice',
          match_method: 'external_candidate',
          confidence: 0.0,
          matched_amount: inv.Total || null,
          matched_date: parseXeroDate(inv.Date),
          matched_contact: contactName,
          matched_reference: ref,
          reference_hash: ref.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || null,
          notes: 'Xettle-prefixed but no push event found — possible external creation. Requires user review.',
        });
        continue;
      }

      const derivedSt = deriveStatus(inv);

      const updatePayload: Record<string, any> = {
        xero_invoice_number: inv.InvoiceNumber || null,
        xero_status: inv.Status || null,
        xero_journal_id: inv.InvoiceID,
        xero_invoice_id: inv.InvoiceID,
        status: derivedSt.status,
        sync_origin: derivedSt.syncOrigin,
      };
      if (inv.Status === 'PAID') {
        updatePayload.bank_verified = true;
        updatePayload.bank_verified_at = new Date().toISOString();
        updatePayload.bank_verified_by = null;
      }

      const { error } = await supabase.from('settlements').update(updatePayload)
        .eq('settlement_id', settlementId).eq('user_id', userId);

      if (!error) {
        updated++;
        const refHash = ref.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || null;

        await safeUpsertXam(supabase, {
          user_id: userId,
          settlement_id: settlementId,
          marketplace_code: detectedMarketplace,
          xero_invoice_id: inv.InvoiceID,
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_type: inv.Type === 'ACCPAY' ? 'bill' : 'invoice',
          match_method: 'reference',
          confidence: 1.0,
          matched_amount: inv.Total || null,
          matched_date: parseXeroDate(inv.Date),
          matched_contact: contactName,
          matched_reference: ref,
          reference_hash: refHash,
        });
      }
    }
    console.log(`[step-4] Reference matching: ${updated} NEW settlements linked`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 4b: Seed cache for Xero invoices with no local settlement
    // SAFETY: Only auto-link Xettle-created invoices (Xettle- prefix).
    // External invoices (AMZN-, LMB-, A2X-) are stored as 'external_candidate'
    // with confidence=0 — they require explicit user review before linking.
    // ════════════════════════════════════════════════════════════════════
    const localSettlementIds = new Set((allSettlements || []).map(s => s.settlement_id));
    let seededCount = 0;
    for (const [settlementId, inv] of seen.entries()) {
      // Only seed if no local settlement exists AND not already cached
      if (localSettlementIds.has(settlementId)) continue;
      if (cacheBySettlement.has(settlementId)) continue;

      const ref = inv.Reference || '';
      const contactName = inv.Contact?.Name || '';
      const detectedMarketplace = detectMarketplaceFromContact(contactName) || 'amazon_au';

      // ─── SAFETY: Only auto-link Xettle-created invoices ─────────────
      const isXettleCreated = ref.toLowerCase().startsWith('xettle-');

      await safeUpsertXam(supabase, {
        user_id: userId,
        settlement_id: settlementId,
        marketplace_code: detectedMarketplace,
        xero_invoice_id: inv.InvoiceID,
        xero_invoice_number: inv.InvoiceNumber || null,
        xero_status: inv.Status || null,
        xero_type: inv.Type === 'ACCPAY' ? 'bill' : 'invoice',
        match_method: isXettleCreated ? 'xero_pre_seed' : 'external_candidate',
        confidence: isXettleCreated ? 1.0 : 0.0,
        matched_amount: inv.Total || null,
        matched_date: parseXeroDate(inv.Date),
        matched_contact: contactName,
        matched_reference: ref,
        reference_hash: ref.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || null,
        notes: isXettleCreated
          ? 'Pre-seeded from Xettle-created Xero invoice'
          : 'External invoice detected — requires user review before linking',
      });

      seededCount++;
    }
    if (seededCount > 0) {
      console.log(`[step-4b] Pre-seeded ${seededCount} Xero invoices (no local settlement yet)`);
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 5: Fuzzy match ONLY for remaining unmatched (no cache, no ref)
    // ════════════════════════════════════════════════════════════════════
    const matchedSettlementIds = new Set([
      ...Array.from(cacheBySettlement.keys()),
      ...Array.from(seen.keys()),
    ]);
    const needFuzzy = uncachedSettlements.filter(
      s => !matchedSettlementIds.has(s.settlement_id) && !seen.has(s.settlement_id)
    );

    let fuzzyMatched = 0;
    if (needFuzzy.length > 0) {
      console.log(`[step-5] ${needFuzzy.length} settlements need fuzzy matching`);

      // Fetch recent invoices for fuzzy — use a focused window
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 12);
      const fromDate = sixMonthsAgo.toISOString().split('T')[0];
      const [y, m, d] = fromDate.split('-');
      const whereDate = `Date>=DateTime(${y},${m},${d})`;

      let recentInvoices: any[] = [];
      try {
        recentInvoices = await queryXeroInvoicesPaginated(token, whereDate);
        console.log(`[step-5] Fetched ${recentInvoices.length} invoices for fuzzy scan`);
      } catch (e) {
        console.error('Fuzzy scan error:', e);
      }

      // Build set of already-matched invoice IDs
      const matchedInvoiceIds = new Set<string>();
      for (const inv of dedupedInvoices) matchedInvoiceIds.add(inv.InvoiceID);
      for (const m of (cachedMatches || [])) {
        if (m.xero_invoice_id) matchedInvoiceIds.add(m.xero_invoice_id);
      }

      for (const settlement of needFuzzy) {
        const depositAmount = Math.abs(settlement.bank_deposit || settlement.net_ex_gst || 0);
        if (depositAmount === 0) continue;

        const marketplace = settlement.marketplace || 'unknown';
        const periodStart = new Date(settlement.period_start + 'T00:00:00Z');
        const periodEnd = new Date(settlement.period_end + 'T00:00:00Z');

        let bestMatch: any = null;
        let bestConfidence = 0;
        let bestMatchMethod = 'fuzzy_amount_date';

        for (const inv of recentInvoices) {
          if (matchedInvoiceIds.has(inv.InvoiceID)) continue;

          const invAmount = Math.abs(inv.Total || 0);
          const amountDiff = Math.abs(invAmount - depositAmount);
          const invDate = parseXeroDate(inv.Date);
          if (!invDate) continue;

          const invDateObj = new Date(invDate + 'T00:00:00Z');
          const contactName = inv.Contact?.Name || '';
          const detectedMkt = detectMarketplaceFromContact(contactName);

          if (!detectedMkt || detectedMkt !== marketplace) {
            if (detectedMkt !== null) continue;
          }
          const marketplaceMatch = detectedMkt === marketplace;

          const pctDiff = depositAmount > 0 ? (amountDiff / depositAmount) * 100 : 100;
          if (amountDiff > 5 && pctDiff > 5) continue;

          const windowStart = new Date(periodStart);
          windowStart.setUTCDate(windowStart.getUTCDate() - 7);
          const windowEnd = new Date(periodEnd);
          windowEnd.setUTCDate(windowEnd.getUTCDate() + 7);
          if (invDateObj < windowStart || invDateObj > windowEnd) continue;

          let confidence = 0;
          let matchMethod = 'fuzzy_amount_date';

          // Fingerprint match
          if (settlement.settlement_fingerprint && marketplaceMatch) {
            const candidateFp = await generateSettlementStyleFingerprint(
              marketplace, settlement.period_start, settlement.period_end, invAmount
            );
            if (candidateFp === settlement.settlement_fingerprint) {
              confidence = 0.95;
              matchMethod = 'fingerprint';
            }
          }

          if (confidence === 0) {
            confidence = 0.5;
            if (amountDiff <= 0.05) confidence += 0.25;
            else if (amountDiff <= 1) confidence += 0.2;
            else if (pctDiff <= 1) confidence += 0.15;
            if (marketplaceMatch) confidence += 0.15;
            const daysDiff = Math.abs((invDateObj.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 2) confidence += 0.05;
            const ref = (inv.Reference || '').toLowerCase();
            const sid = settlement.settlement_id.toLowerCase();
            if (ref.includes(sid) || sid.includes(ref.replace(/\s/g, ''))) {
              confidence += 0.05;
            }
          }

          confidence = Math.min(confidence, 0.99);
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = inv;
            bestMatchMethod = matchMethod;
          }
        }

        if (bestMatch && bestConfidence >= 0.6) {
          const derivedSt = deriveStatus(bestMatch);
          const fuzzyUpdatePayload: Record<string, any> = {
            xero_invoice_number: bestMatch.InvoiceNumber || null,
            xero_status: bestMatch.Status || null,
            xero_journal_id: bestMatch.InvoiceID,
            xero_invoice_id: bestMatch.InvoiceID,
            status: derivedSt.status,
            sync_origin: derivedSt.syncOrigin,
          };
          if (bestMatch.Status === 'PAID') {
            fuzzyUpdatePayload.bank_verified = true;
            fuzzyUpdatePayload.bank_verified_at = new Date().toISOString();
            fuzzyUpdatePayload.bank_verified_by = null;
          }

          await supabase.from('settlements').update(fuzzyUpdatePayload)
            .eq('settlement_id', settlement.settlement_id).eq('user_id', userId);

          await safeUpsertXam(supabase, {
            user_id: userId,
            settlement_id: settlement.settlement_id,
            marketplace_code: marketplace,
            xero_invoice_id: bestMatch.InvoiceID,
            xero_invoice_number: bestMatch.InvoiceNumber || null,
            xero_status: bestMatch.Status || null,
            xero_type: bestMatch.Type === 'ACCPAY' ? 'bill' : 'invoice',
            match_method: bestMatchMethod,
            confidence: bestConfidence,
            matched_amount: bestMatch.Total || null,
            matched_date: parseXeroDate(bestMatch.Date),
            matched_contact: bestMatch.Contact?.Name || null,
            matched_reference: bestMatch.Reference || null,
            reference_hash: (bestMatch.Reference || '').replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase() || null,
            notes: `Auto-detected: amount diff $${Math.abs((bestMatch.Total || 0) - Math.abs(settlement.bank_deposit || 0)).toFixed(2)}, contact: ${bestMatch.Contact?.Name || 'unknown'}`,
          });

          matchedInvoiceIds.add(bestMatch.InvoiceID);
          fuzzyMatched++;
        }
      }
    }
    console.log(`[step-5] Fuzzy matching: ${fuzzyMatched} additional settlements matched`);

    // ════════════════════════════════════════════════════════════════════
    // STEP 5b: Triage unmatched 'ingested' settlements after Xero scan.
    // - Recent (≤60 days old) → promote to 'ready_to_push' (genuinely new)
    // - Older → mark is_pre_boundary=true (pre-existing, handled outside Xettle)
    // This prevents hundreds of historical payouts appearing as "Ready to Push"
    // when the user already reconciled them via LinkMyBooks/manual entry.
    // ════════════════════════════════════════════════════════════════════
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const cutoffDate = sixtyDaysAgo.toISOString().split('T')[0];

    const { data: ingestedUnmatchedRecent } = await supabase
      .from('settlements')
      .select('settlement_id')
      .eq('user_id', userId)
      .eq('status', 'ingested')
      .eq('is_pre_boundary', false)
      .is('xero_journal_id', null)
      .gte('period_end', cutoffDate);

    if (ingestedUnmatchedRecent && ingestedUnmatchedRecent.length > 0) {
      await supabase.from('settlements')
        .update({ status: 'ready_to_push' })
        .eq('user_id', userId)
        .eq('status', 'ingested')
        .eq('is_pre_boundary', false)
        .is('xero_journal_id', null)
        .gte('period_end', cutoffDate);
      console.log(`[step-5b] Promoted ${ingestedUnmatchedRecent.length} RECENT ingested settlements to ready_to_push`);
    }

    // Mark older unmatched 'ingested' as pre-boundary — they predate Xettle
    const { data: ingestedUnmatchedOld } = await supabase
      .from('settlements')
      .select('settlement_id')
      .eq('user_id', userId)
      .eq('status', 'ingested')
      .eq('is_pre_boundary', false)
      .is('xero_journal_id', null)
      .lt('period_end', cutoffDate);

    if (ingestedUnmatchedOld && ingestedUnmatchedOld.length > 0) {
      await supabase.from('settlements')
        .update({ is_pre_boundary: true })
        .eq('user_id', userId)
        .eq('status', 'ingested')
        .eq('is_pre_boundary', false)
        .is('xero_journal_id', null)
        .lt('period_end', cutoffDate);
      console.log(`[step-5b] Marked ${ingestedUnmatchedOld.length} OLD ingested settlements as pre-boundary`);
    }

    // ════════════════════════════════════════════════════════════════════
    // STEP 6: Save incremental cursor + update marketplace_validation
    // ════════════════════════════════════════════════════════════════════
    const nowIso = new Date().toISOString();
    await supabase.from('app_settings').upsert({
      user_id: userId,
      key: `xero_last_invoice_scan_at_${token.tenant_id}`,
      value: nowIso,
    }, { onConflict: 'user_id,key' });

    // Update marketplace_validation for reference-matched settlements
    for (const [settlementId, inv] of seen.entries()) {
      if (cacheBySettlement.has(settlementId)) continue;
      const { data: sett } = await supabase.from('settlements')
        .select('marketplace, period_start, period_end')
        .eq('settlement_id', settlementId).eq('user_id', userId).maybeSingle();
      if (sett) {
        const periodLabel = `${sett.period_start} → ${sett.period_end}`;
        await supabase.from('marketplace_validation').upsert({
          user_id: userId,
          marketplace_code: sett.marketplace || 'amazon_au',
          period_label: periodLabel,
          period_start: sett.period_start,
          period_end: sett.period_end,
          xero_pushed: true,
          xero_invoice_id: inv.InvoiceID,
          xero_pushed_at: nowIso,
        }, { onConflict: 'user_id,marketplace_code,period_label' });
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // AUTO-RESOLVE: Move ready_to_push settlements with PAID external matches to already_recorded
    // ════════════════════════════════════════════════════════════════════
    let autoResolved = 0;
    const { data: readySettlements } = await supabase
      .from('settlements').select('id, settlement_id')
      .eq('user_id', userId).eq('status', 'ready_to_push')
      .eq('is_hidden', false).is('duplicate_of_settlement_id', null);

    if (readySettlements && readySettlements.length > 0) {
      const readySids = readySettlements.map(s => s.settlement_id);
      const { data: paidMatches } = await supabase
        .from('xero_accounting_matches')
        .select('settlement_id, xero_invoice_id')
        .eq('user_id', userId)
        .in('xero_status', ['PAID', 'AUTHORISED'])
        .in('settlement_id', readySids);

      if (paidMatches && paidMatches.length > 0) {
        const matchedSids = new Map(paidMatches.map(m => [m.settlement_id, m.xero_invoice_id]));
        const idsToResolve = readySettlements
          .filter(s => matchedSids.has(s.settlement_id))
          .map(s => s.id);

        if (idsToResolve.length > 0) {
          const resolvedAt = new Date().toISOString();

          await supabase.from('settlements')
            .update({ status: 'already_recorded', sync_origin: 'external' })
            .in('id', idsToResolve);
          autoResolved = idsToResolve.length;
          console.log(`[sync-xero-status] Auto-resolved ${autoResolved} ready_to_push settlements with PAID/AUTHORISED external matches`);

          // Update all existing marketplace_validation rows for these settlement_ids, including legacy period labels
          for (const s of readySettlements.filter(s => matchedSids.has(s.settlement_id))) {
            const xeroInvId = matchedSids.get(s.settlement_id);
            await supabase.from('marketplace_validation')
              .update({
                xero_pushed: true,
                xero_invoice_id: xeroInvId,
                xero_pushed_at: resolvedAt,
                overall_status: 'already_recorded',
                updated_at: resolvedAt,
                last_checked_at: resolvedAt,
                processing_state: 'processed',
                processing_completed_at: resolvedAt,
                processing_error: null,
              })
              .eq('user_id', userId)
              .eq('settlement_id', s.settlement_id);
          }
        }
      }
    }

    // Count remaining unmatched (only ready_to_push, not saved — saved means still being checked)
    const { data: stillUnmatched } = await supabase
      .from('settlements').select('settlement_id').eq('user_id', userId)
      .is('xero_journal_id', null).in('status', ['ingested', 'ready_to_push']);
    const unmatchedCount = stillUnmatched?.length || 0;

    // Log both xero_audit_complete (detailed) and xero_sync_complete (scanner telemetry)
    const eventDetails = {
      mode: 'cache_first_incremental',
      cache_verified: cacheVerified,
      cache_status_changed: cacheStatusChanged,
      new_reference_matches: updated,
      fuzzy_matched: fuzzyMatched,
      auto_resolved: autoResolved,
      invoices_scanned: dedupedInvoices.length,
      uncached_settlements: uncachedSettlements.length,
      unmatched: unmatchedCount,
      cursor_saved: nowIso,
    };
    await supabase.from('system_events').insert([
      { user_id: userId, event_type: 'xero_audit_complete', severity: 'info', details: eventDetails },
      { user_id: userId, event_type: 'xero_sync_complete', severity: 'info', details: eventDetails },
    ]);

    console.log(`[sync-xero-status] ═══ Complete: ${cacheVerified} cached, ${updated} new refs, ${fuzzyMatched} fuzzy, ${unmatchedCount} unmatched ═══`);

    return new Response(JSON.stringify({
      success: true,
      updated: updated + cacheStatusChanged,
      fuzzy_matched: fuzzyMatched,
      unmatched: unmatchedCount,
      total: cacheVerified + updated + fuzzyMatched,
      mode: 'cache_first_incremental',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('sync-xero-status error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
