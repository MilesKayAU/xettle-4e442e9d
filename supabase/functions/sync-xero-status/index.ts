import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  const resp = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }),
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

// Paginated Xero invoice query — fetches ALL pages (max 100 per page)
async function queryXeroInvoicesPaginated(token: XeroToken, whereClause: string): Promise<any[]> {
  const allInvoices: any[] = [];
  let page = 1;
  const maxPages = 10; // Safety limit: 1000 invoices max per query

  while (page <= maxPages) {
    const url = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(whereClause)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&page=${page}`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      },
    });
    if (!resp.ok) {
      console.error(`Xero query failed page ${page} (${whereClause}):`, resp.status, await resp.text());
      break;
    }
    const result = await resp.json();
    const invoices = result.Invoices || [];
    allInvoices.push(...invoices);

    // Xero returns max 100 per page; if fewer, we've reached the end
    if (invoices.length < 100) break;
    page++;
  }

  return allInvoices;
}

function extractSettlementId(reference: string): string | null {
  // New format: Xettle-{settlement_id} or Xettle-{settlement_id}-P1/P2
  if (reference.startsWith('Xettle-')) {
    const rest = reference.slice(7);
    return rest.replace(/-P[12]$/, '');
  }
  // Legacy format: AMZN-{settlement_id}
  if (reference.startsWith('AMZN-')) {
    return reference.slice(5);
  }
  // LMB format anywhere in string: LMB-{channel}-{settlement_id}-{part}
  // Handles prefixed references like "(A$73.39) LMB-shopify-128879853815-1"
  const lmbMatch = reference.match(/LMB-\w+-(\d+)-\d+/);
  if (lmbMatch) return lmbMatch[1];
  // Old format: "Amazon AU Settlement 12284044573 - Part 2 (March)"
  // Extract the numeric settlement ID, NOT the month in parentheses
  // Look for a long numeric ID (8+ digits) in the reference
  const numericMatch = reference.match(/\b(\d{8,})\b/);
  if (numericMatch) return numericMatch[1];
  // Shopify format: "Shopify Payout Shopify-ABC123"
  const shopifyMatch = reference.match(/(Shopify-[\w]+)/);
  if (shopifyMatch) return shopifyMatch[1];
  // Generic: look for settlement ID patterns like 290994_BigW
  const genericMatch = reference.match(/(\d+_\w+)/);
  if (genericMatch) return genericMatch[1];
  // Last resort: try parentheses but only if it looks like an ID (not a month)
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

const MARKETPLACE_CONTACT_PATTERNS: Record<string, string[]> = {
  amazon_au: ['amazon', 'amzn'],
  kogan: ['kogan'],
  bigw: ['big w', 'bigw'],
  bunnings: ['bunnings'],
  mydeal: ['mydeal', 'my deal'],
  catch: ['catch'],
  shopify_payments: ['shopify'],
  ebay_au: ['ebay'],
  woolworths: ['woolworths', 'woolies', 'everyday market'],
  theiconic: ['iconic', 'the iconic'],
  etsy: ['etsy'],
};

function detectMarketplaceFromContact(contactName: string): string | null {
  const lower = contactName.toLowerCase();
  for (const [code, patterns] of Object.entries(MARKETPLACE_CONTACT_PATTERNS)) {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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
      .from('xero_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (tokenErr || !tokens?.length) {
      return new Response(JSON.stringify({ success: false, error: 'No Xero connection found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let token = tokens[0] as XeroToken;
    token = await refreshToken(supabase, token);

    // ─── METHOD 1: Exact reference match (paginated, sequential to avoid rate limits) ───
    console.log(`[sync-xero-status] Starting reference scan for user ${userId}`);
    
    const newFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.StartsWith("Xettle-")');
    const oldFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("Settlement")');
    const amznFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.StartsWith("AMZN-")');
    // LMB format: use Contains since references may have amount prefix like "(A$73.39) LMB-..."
    const lmbFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("LMB-")');
    // Shopify: catch references like "Shopify Payout 12345" or "Payout #12345"
    const shopifyFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("Shopify")');
    const payoutFormatInvoices = await queryXeroInvoicesPaginated(token, 'Reference.Contains("Payout")');
    // Also search by Shopify contact name for invoices that may not have payout IDs in reference
    const shopifyContactInvoices = await queryXeroInvoicesPaginated(token, 'Contact.Name.Contains("Shopify")');

    const allInvoices = [...newFormatInvoices, ...oldFormatInvoices, ...amznFormatInvoices, ...lmbFormatInvoices, ...shopifyFormatInvoices, ...payoutFormatInvoices, ...shopifyContactInvoices];
    // Deduplicate by InvoiceID
    const invoiceMap = new Map<string, any>();
    for (const inv of allInvoices) {
      if (!invoiceMap.has(inv.InvoiceID)) invoiceMap.set(inv.InvoiceID, inv);
    }
    const dedupedInvoices = Array.from(invoiceMap.values());
    
    console.log(`[sync-xero-status] Found ${dedupedInvoices.length} unique Xero invoices (LMB: ${lmbFormatInvoices.length}, Shopify ref: ${shopifyFormatInvoices.length}, Shopify contact: ${shopifyContactInvoices.length})`);
    
    const seen = new Map<string, any>();

    for (const inv of dedupedInvoices) {
      const sid = extractSettlementId(inv.Reference || '');
      if (!sid) continue;
      if (!seen.has(sid) || (inv.Reference || '').startsWith('Xettle-')) {
        seen.set(sid, inv);
      }
    }

    console.log(`[sync-xero-status] Extracted ${seen.size} settlement IDs from references`);

    // Update settlements + cache matches for exact reference hits
    let updated = 0;
    for (const [settlementId, inv] of seen.entries()) {
      const ref = inv.Reference || '';
      const isXettleFormat = ref.startsWith('Xettle-');

      // Detect marketplace from contact name for accurate cache entry
      const contactName = inv.Contact?.Name || '';
      const detectedMarketplace = detectMarketplaceFromContact(contactName) || 'amazon_au';

      // Xettle-pushed: use granular lifecycle status
      // Legacy (AMZN-/LMB-/old Settlement): always synced_external
      let derivedStatus: string;
      if (isXettleFormat) {
        switch (inv.Status) {
          case 'DRAFT': derivedStatus = 'draft_in_xero'; break;
          case 'AUTHORISED': derivedStatus = 'authorised_in_xero'; break;
          case 'PAID': derivedStatus = 'reconciled_in_xero'; break;
          default: derivedStatus = 'pushed_to_xero'; break;
        }
      } else {
        derivedStatus = 'synced_external';
      }

      // Build update payload — auto-verify if PAID in Xero
      const updatePayload: Record<string, any> = {
        xero_invoice_number: inv.InvoiceNumber || null,
        xero_status: inv.Status || null,
        xero_journal_id: inv.InvoiceID,
        status: derivedStatus,
      };

      // Auto-verify: if Xero says PAID, the bank deposit is confirmed
      if (inv.Status === 'PAID') {
        updatePayload.bank_verified = true;
        updatePayload.bank_verified_at = new Date().toISOString();
        updatePayload.bank_verified_by = null; // system auto-verified
      }

      const { error } = await supabase
        .from('settlements')
        .update(updatePayload)
        .eq('settlement_id', settlementId)
        .eq('user_id', userId);

      if (!error) {
        updated++;
        // Cache in xero_accounting_matches
        await supabase.from('xero_accounting_matches').upsert({
          user_id: userId,
          settlement_id: settlementId,
          marketplace_code: detectedMarketplace,
          xero_invoice_id: inv.InvoiceID,
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_type: inv.Type === 'ACCPAY' ? 'bill' : 'invoice',
          match_method: isXettleFormat ? 'reference' : 'legacy_reference',
          confidence: 1.0,
          matched_amount: inv.Total || null,
          matched_date: parseXeroDate(inv.Date),
          matched_contact: contactName,
          matched_reference: inv.Reference || null,
        }, { onConflict: 'user_id,settlement_id' });
      }
    }

    console.log(`[sync-xero-status] Reference matching: ${updated} settlements updated`);

    // ─── METHOD 2: Fuzzy amount+date matching for unmatched settlements ───
    // Get all settlements that don't have a Xero match yet
    const { data: unmatchedSettlements } = await supabase
      .from('settlements')
      .select('settlement_id, marketplace, period_start, period_end, bank_deposit, net_ex_gst, status, settlement_fingerprint')
      .eq('user_id', userId)
      .is('xero_journal_id', null)
      .not('status', 'in', '("synced","synced_external","already_recorded","draft_in_xero","authorised_in_xero","reconciled_in_xero")');

    let fuzzyMatched = 0;

    if (unmatchedSettlements && unmatchedSettlements.length > 0) {
      console.log(`[sync-xero-status] ${unmatchedSettlements.length} settlements still unmatched, running fuzzy scan`);
      
      // Extend lookback to 12 months to cover all historical settlements
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      const fromDate = twelveMonthsAgo.toISOString().split('T')[0];
      const [y, m, d] = fromDate.split('-');
      const whereDate = `Date>=DateTime(${y},${m},${d})`;

      let recentInvoices: any[] = [];
      try {
        recentInvoices = await queryXeroInvoicesPaginated(token, whereDate);
        console.log(`[sync-xero-status] Fuzzy scan: ${recentInvoices.length} Xero invoices fetched for last 12 months`);
      } catch (e) {
        console.error('Fuzzy scan error:', e);
      }

      // Build a map of already-matched invoice IDs to avoid double-matching
      const matchedInvoiceIds = new Set(
        Array.from(seen.values()).map(inv => inv.InvoiceID)
      );

      // Also load existing cached matches
      const { data: existingMatches } = await supabase
        .from('xero_accounting_matches')
        .select('settlement_id, xero_invoice_id')
        .eq('user_id', userId);

      const alreadyMatchedSettlements = new Set(
        (existingMatches || []).map(m => m.settlement_id)
      );
      for (const m of existingMatches || []) {
        if (m.xero_invoice_id) matchedInvoiceIds.add(m.xero_invoice_id);
      }

      // Pre-build fingerprint lookup from settlements for fast matching
      const settlementFingerprints = new Map<string, typeof unmatchedSettlements[0]>();
      for (const s of unmatchedSettlements) {
        if (s.settlement_fingerprint) {
          settlementFingerprints.set(s.settlement_fingerprint, s);
        }
      }

      for (const settlement of unmatchedSettlements) {
        if (alreadyMatchedSettlements.has(settlement.settlement_id)) continue;

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

          // Check if this invoice could be for the same marketplace
          const marketplaceMatch = detectedMkt === marketplace;
          if (!marketplaceMatch && detectedMkt !== null) continue;

          // Amount within 5% or $5
          const pctDiff = depositAmount > 0 ? (amountDiff / depositAmount) * 100 : 100;
          if (amountDiff > 5 && pctDiff > 5) continue;

          // Date within settlement window ± 7 days
          const windowStart = new Date(periodStart);
          windowStart.setUTCDate(windowStart.getUTCDate() - 7);
          const windowEnd = new Date(periodEnd);
          windowEnd.setUTCDate(windowEnd.getUTCDate() + 7);

          if (invDateObj < windowStart || invDateObj > windowEnd) continue;

          // ─── Confidence scoring with fingerprint support ───
          let confidence = 0;
          let matchMethod = 'fuzzy_amount_date';

          // Fingerprint match
          if (settlement.settlement_fingerprint && marketplaceMatch) {
            const candidateFp = await generateSettlementStyleFingerprint(
              marketplace,
              settlement.period_start,
              settlement.period_end,
              invAmount
            );
            if (candidateFp === settlement.settlement_fingerprint) {
              confidence = 0.95;
              matchMethod = 'fingerprint';
            }
          }

          // If no fingerprint match, use traditional scoring
          if (confidence === 0) {
            confidence = 0.5;
            if (amountDiff <= 0.05) confidence += 0.25;
            else if (amountDiff <= 1) confidence += 0.2;
            else if (pctDiff <= 1) confidence += 0.15;

            if (marketplaceMatch) confidence += 0.15;

            // Date proximity bonus
            const daysDiff = Math.abs((invDateObj.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 2) confidence += 0.05;

            // Reference similarity bonus
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
          const bestRef = bestMatch.Reference || '';
          const isXettleFormat = bestRef.startsWith('Xettle-');

          // Derive status from Xero invoice status
          let derivedStatus: string;
          if (isXettleFormat) {
            switch (bestMatch.Status) {
              case 'DRAFT': derivedStatus = 'draft_in_xero'; break;
              case 'AUTHORISED': derivedStatus = 'authorised_in_xero'; break;
              case 'PAID': derivedStatus = 'reconciled_in_xero'; break;
              default: derivedStatus = 'pushed_to_xero'; break;
            }
          } else {
            derivedStatus = 'synced_external';
          }

          // ── Write back to settlements table (critical!) ──
          const fuzzyUpdatePayload: Record<string, any> = {
            xero_invoice_number: bestMatch.InvoiceNumber || null,
            xero_status: bestMatch.Status || null,
            xero_journal_id: bestMatch.InvoiceID,
            status: derivedStatus,
          };

          // Auto-verify if PAID
          if (bestMatch.Status === 'PAID') {
            fuzzyUpdatePayload.bank_verified = true;
            fuzzyUpdatePayload.bank_verified_at = new Date().toISOString();
            fuzzyUpdatePayload.bank_verified_by = null;
          }

          await supabase
            .from('settlements')
            .update(fuzzyUpdatePayload)
            .eq('settlement_id', settlement.settlement_id)
            .eq('user_id', userId);

          // Cache fuzzy match in xero_accounting_matches
          await supabase.from('xero_accounting_matches').upsert({
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
            notes: `Auto-detected: amount diff $${Math.abs((bestMatch.Total || 0) - Math.abs(settlement.bank_deposit || 0)).toFixed(2)}, contact: ${bestMatch.Contact?.Name || 'unknown'}`,
          }, { onConflict: 'user_id,settlement_id' });

          matchedInvoiceIds.add(bestMatch.InvoiceID);
          fuzzyMatched++;
        }
      }
    }

    console.log(`[sync-xero-status] Fuzzy matching: ${fuzzyMatched} additional settlements matched`);

    // ─── Update marketplace_validation for all matched settlements ───
    for (const [settlementId, inv] of seen.entries()) {
      const { data: sett } = await supabase
        .from('settlements')
        .select('marketplace, period_start, period_end')
        .eq('settlement_id', settlementId)
        .eq('user_id', userId)
        .maybeSingle();

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
          xero_pushed_at: new Date().toISOString(),
        }, { onConflict: 'user_id,marketplace_code,period_label' });
      }
    }

    // ─── Count remaining unmatched for logging ───
    const { data: stillUnmatched } = await supabase
      .from('settlements')
      .select('settlement_id')
      .eq('user_id', userId)
      .is('xero_journal_id', null)
      .in('status', ['saved', 'parsed', 'ready_to_push']);
    const unmatchedCount = stillUnmatched?.length || 0;

    // ─── Log to system_events ───
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'xero_audit_complete',
      severity: 'info',
      details: {
        matched: updated,
        fuzzy_matched: fuzzyMatched,
        unmatched: unmatchedCount,
        total_scanned: dedupedInvoices.length,
        unmatched_settlements_checked: unmatchedSettlements?.length || 0,
      },
    });

    console.log(`[sync-xero-status] User ${userId}: ${updated} reference matches, ${fuzzyMatched} fuzzy matches, ${dedupedInvoices.length} Xero invoices scanned, ${unmatchedCount} still unmatched`);

    return new Response(JSON.stringify({
      success: true,
      updated,
      fuzzy_matched: fuzzyMatched,
      unmatched: unmatchedCount,
      total: seen.size + fuzzyMatched,
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
