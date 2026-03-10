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

async function queryXeroInvoices(token: XeroToken, whereClause: string): Promise<any[]> {
  const url = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(whereClause)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Accept': 'application/json',
      'Xero-tenant-id': token.tenant_id,
    },
  });
  if (!resp.ok) {
    console.error(`Xero query failed (${whereClause}):`, resp.status, await resp.text());
    return [];
  }
  const result = await resp.json();
  return result.Invoices || [];
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
  // Split-month format: LMB-AU-{settlement_id}-1 or LMB-AU-{settlement_id}-2
  const lmbMatch = reference.match(/^LMB-\w+-(\d+)-\d+$/);
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();
    if (!userId) throw new Error('Missing userId');

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

    // ─── METHOD 1: Exact reference match (sequential to avoid Xero rate limits) ───────
    const newFormatInvoices = await queryXeroInvoices(token, 'Reference.StartsWith("Xettle-")');
    const oldFormatInvoices = await queryXeroInvoices(token, 'Reference.Contains("Settlement")');
    const amznFormatInvoices = await queryXeroInvoices(token, 'Reference.StartsWith("AMZN-")');
    const lmbFormatInvoices = await queryXeroInvoices(token, 'Reference.StartsWith("LMB-")');

    const allInvoices = [...newFormatInvoices, ...oldFormatInvoices, ...amznFormatInvoices, ...lmbFormatInvoices];
    const seen = new Map<string, any>();

    for (const inv of allInvoices) {
      const sid = extractSettlementId(inv.Reference || '');
      if (!sid) continue;
      if (!seen.has(sid) || inv.Reference.startsWith('Xettle-')) {
        seen.set(sid, inv);
      }
    }

    // Update settlements + cache matches for exact reference hits
    let updated = 0;
    for (const [settlementId, inv] of seen.entries()) {
      // PAID or AUTHORISED → pushed_to_xero (matches AccountingDashboard badge)
      // DRAFT or SUBMITTED → synced (still in progress at Xero)
      const derivedStatus = (inv.Status === 'PAID' || inv.Status === 'AUTHORISED') ? 'pushed_to_xero' : 'synced';
      const { error } = await supabase
        .from('settlements')
        .update({
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_journal_id: inv.InvoiceID,
          status: derivedStatus,
        })
        .eq('settlement_id', settlementId)
        .eq('user_id', userId);

      if (!error) {
        updated++;
        // Cache in xero_accounting_matches
        await supabase.from('xero_accounting_matches').upsert({
          user_id: userId,
          settlement_id: settlementId,
          marketplace_code: 'amazon_au', // Will be overridden by actual marketplace below
          xero_invoice_id: inv.InvoiceID,
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_type: inv.Type === 'ACCPAY' ? 'bill' : 'invoice',
          match_method: 'reference',
          confidence: 1.0,
          matched_amount: inv.Total || null,
          matched_date: parseXeroDate(inv.Date),
          matched_contact: inv.Contact?.Name || null,
          matched_reference: inv.Reference || null,
        }, { onConflict: 'user_id,settlement_id' });
      }
    }

    // ─── METHOD 2: Fuzzy amount+date matching for unmatched settlements ───
    // Get all settlements that don't have a Xero match yet
    const { data: unmatchedSettlements } = await supabase
      .from('settlements')
      .select('settlement_id, marketplace, period_start, period_end, bank_deposit, net_ex_gst, status')
      .eq('user_id', userId)
      .is('xero_journal_id', null)
      .not('status', 'in', '("synced","synced_external","already_recorded")');

    let fuzzyMatched = 0;

    if (unmatchedSettlements && unmatchedSettlements.length > 0) {
      // Fetch recent marketplace-related invoices for fuzzy matching
      // Query invoices from last 6 months for marketplace contacts
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const fromDate = sixMonthsAgo.toISOString().split('T')[0];
      const [y, m, d] = fromDate.split('-');
      const whereDate = `Date>=DateTime(${y},${m},${d})`;

      let recentInvoices: any[] = [];
      try {
        recentInvoices = await queryXeroInvoices(token, whereDate);
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

      for (const settlement of unmatchedSettlements) {
        if (alreadyMatchedSettlements.has(settlement.settlement_id)) continue;

        const depositAmount = Math.abs(settlement.bank_deposit || settlement.net_ex_gst || 0);
        if (depositAmount === 0) continue;

        const marketplace = settlement.marketplace || 'unknown';
        const periodStart = new Date(settlement.period_start + 'T00:00:00Z');
        const periodEnd = new Date(settlement.period_end + 'T00:00:00Z');

        let bestMatch: any = null;
        let bestConfidence = 0;

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

          // Calculate confidence
          let confidence = 0.5;
          if (amountDiff <= 0.05) confidence += 0.3;
          else if (amountDiff <= 1) confidence += 0.2;
          else if (pctDiff <= 1) confidence += 0.15;

          if (marketplaceMatch) confidence += 0.15;

          // Date proximity bonus
          const daysDiff = Math.abs((invDateObj.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff <= 2) confidence += 0.05;

          confidence = Math.min(confidence, 0.95);

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = inv;
          }
        }

        if (bestMatch && bestConfidence >= 0.6) {
          // Cache fuzzy match
          await supabase.from('xero_accounting_matches').upsert({
            user_id: userId,
            settlement_id: settlement.settlement_id,
            marketplace_code: marketplace,
            xero_invoice_id: bestMatch.InvoiceID,
            xero_invoice_number: bestMatch.InvoiceNumber || null,
            xero_status: bestMatch.Status || null,
            xero_type: bestMatch.Type === 'ACCPAY' ? 'bill' : 'invoice',
            match_method: 'fuzzy_amount_date',
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
        total_scanned: allInvoices.length,
        unmatched_settlements_checked: unmatchedSettlements?.length || 0,
      },
    });

    console.log(`[sync-xero-status] User ${userId}: ${updated} reference matches, ${fuzzyMatched} fuzzy matches, ${allInvoices.length} Xero invoices scanned, ${unmatchedCount} still unmatched`);

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
