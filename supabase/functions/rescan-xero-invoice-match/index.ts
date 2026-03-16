/**
 * rescan-xero-invoice-match — Re-scan a single Xero invoice for settlement matches.
 * 
 * Input: { xeroInvoiceId: string }
 * Auth: Bearer token → resolves user_id
 * 
 * Matching strategy:
 *   1. Deterministic: Xettle-{id}, AMZN-{id}, LMB-*-{id}-* reference patterns
 *   2. Heuristic: amount + date + contact window matching
 * 
 * Tables written: xero_accounting_matches (upsert), system_events (insert)
 * Idempotency: upsert on (user_id, xero_invoice_id)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getCorsHeaders } from '../_shared/cors.ts';
import { safeUpsertXam } from '../_shared/xam-safe-upsert.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function extractSettlementId(reference: string | null): string | null {
  if (!reference) return null;
  // Xettle-{id} or Xettle-{id}-P1/P2
  const xettleMatch = reference.match(/^Xettle-(.+?)(?:-P[12])?$/);
  if (xettleMatch) return xettleMatch[1];
  // AMZN-{id}
  const amznMatch = reference.match(/^AMZN-(.+)$/);
  if (amznMatch) return amznMatch[1];
  // LMB-{marketplace}-{id}-{seq}
  const lmbMatch = reference.match(/^LMB-\w+-(\d+)-\d+$/);
  if (lmbMatch) return lmbMatch[1];
  return null;
}

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { xeroInvoiceId } = await req.json();
    if (!xeroInvoiceId) return new Response(JSON.stringify({ error: 'xeroInvoiceId required' }), { status: 400, headers: corsHeaders });

    // Get cached invoice (or from outstanding_invoices_cache)
    const [cacheRes, outRes] = await Promise.all([
      supabase.from('xero_invoice_cache').select('*').eq('user_id', user.id).eq('xero_invoice_id', xeroInvoiceId).maybeSingle(),
      supabase.from('outstanding_invoices_cache').select('*').eq('user_id', user.id).eq('xero_invoice_id', xeroInvoiceId).maybeSingle(),
    ]);

    const cachedInvoice = cacheRes.data;
    const outInvoice = outRes.data;
    const reference = cachedInvoice?.reference || outInvoice?.reference || null;
    const amount = cachedInvoice?.total ?? outInvoice?.total ?? null;
    const contactName = cachedInvoice?.contact_name || outInvoice?.contact_name || null;
    const invoiceDate = cachedInvoice?.date || outInvoice?.date || null;
    const invoiceNumber = cachedInvoice?.xero_invoice_number || outInvoice?.invoice_number || null;

    // Step 1: Deterministic reference matching
    const settlementId = extractSettlementId(reference);
    let matchResult: { settlement_id: string; match_method: string; confidence: number; evidence: string } | null = null;

    if (settlementId) {
      const { data: settlement } = await supabase
        .from('settlements')
        .select('settlement_id, marketplace, bank_deposit, net_ex_gst, period_start, period_end')
        .eq('user_id', user.id)
        .eq('settlement_id', settlementId)
        .is('duplicate_of_settlement_id', null)
        .eq('is_hidden', false)
        .maybeSingle();

      if (settlement) {
        matchResult = {
          settlement_id: settlement.settlement_id,
          match_method: 'deterministic_reference',
          confidence: 1.0,
          evidence: `Reference "${reference}" → settlement_id "${settlementId}"`,
        };
      }
    }

    // Step 2: Heuristic matching (amount + date window)
    if (!matchResult && amount != null) {
      const tolerance = Math.max(Math.abs(amount) * 0.02, 1); // 2% or $1
      const { data: candidates } = await supabase
        .from('settlements')
        .select('settlement_id, marketplace, bank_deposit, net_ex_gst, period_start, period_end')
        .eq('user_id', user.id)
        .is('duplicate_of_settlement_id', null)
        .eq('is_hidden', false)
        .gte('bank_deposit', amount - tolerance)
        .lte('bank_deposit', amount + tolerance)
        .limit(10);

      if (candidates?.length) {
        // Pick best by amount closeness, prefer date overlap
        let best = candidates[0];
        let bestDiff = Math.abs((best.bank_deposit || 0) - amount);
        for (const c of candidates) {
          const diff = Math.abs((c.bank_deposit || 0) - amount);
          if (diff < bestDiff) { best = c; bestDiff = diff; }
        }

        matchResult = {
          settlement_id: best.settlement_id,
          match_method: 'heuristic_amount',
          confidence: bestDiff < 0.01 ? 0.9 : 0.7,
          evidence: `Amount match: invoice ${amount} ≈ settlement ${best.bank_deposit} (diff: ${bestDiff.toFixed(2)})`,
        };
      }
    }

    // Upsert match result
    if (matchResult) {
      const { data: settlement } = await supabase
        .from('settlements')
        .select('marketplace')
        .eq('user_id', user.id)
        .eq('settlement_id', matchResult.settlement_id)
        .maybeSingle();

      await supabase.from('xero_accounting_matches').upsert({
        user_id: user.id,
        settlement_id: matchResult.settlement_id,
        marketplace_code: settlement?.marketplace || 'unknown',
        xero_invoice_id: xeroInvoiceId,
        xero_invoice_number: invoiceNumber,
        xero_status: cachedInvoice?.status || outInvoice?.status || null,
        matched_amount: amount,
        matched_contact: contactName,
        matched_date: invoiceDate,
        matched_reference: reference,
        match_method: matchResult.match_method,
        confidence: matchResult.confidence,
        notes: matchResult.evidence,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,xero_invoice_id' });
    }

    // Log event
    await supabase.from('system_events').insert({
      user_id: user.id,
      event_type: matchResult ? 'xero_invoice_match_found' : 'xero_invoice_match_not_found',
      severity: 'info',
      details: {
        xero_invoice_id: xeroInvoiceId,
        reference,
        match_method: matchResult?.match_method || null,
        matched_settlement_id: matchResult?.settlement_id || null,
        confidence: matchResult?.confidence || null,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      matched: !!matchResult,
      settlement_id: matchResult?.settlement_id || null,
      match_method: matchResult?.match_method || null,
      confidence: matchResult?.confidence || null,
      evidence: matchResult?.evidence || null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('rescan-xero-invoice-match error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
