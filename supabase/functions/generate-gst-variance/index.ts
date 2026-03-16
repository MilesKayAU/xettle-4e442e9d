
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const GST_INCOME_CATEGORIES = ['gst_income'];
const GST_EXPENSE_CATEGORIES = ['gst_expense'];
const REFUND_CATEGORY = 'refund';
const ADJUSTMENT_CATEGORY = 'adjustment';
const PUSHED_STATUSES = ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'];
const KNOWN_CATEGORIES = ['revenue', 'marketplace_fee', 'payment_fee', 'shipping_income', 'shipping_cost', 'fba_fee', 'storage_fee', 'advertising', 'promotion', 'gst_income', 'gst_expense', 'refund', 'adjustment'];

// Variance codes that are line-driven
const LINE_DRIVEN_CODES = ['UNCLASSIFIED_GST', 'ROUNDING', 'ADJUSTMENT_GST'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatAUD(n: number): string {
  const prefix = n < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(n).toFixed(2)}`;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    const body = await req.json();
    const { period_start, period_end } = body;

    if (!period_start || !period_end) {
      return new Response(JSON.stringify({ error: 'period_start and period_end required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── Step 1: Get settlements in period ───────────────────────
    const { data: settlements, error: settErr } = await supabase
      .from('settlements')
      .select('id, settlement_id, marketplace, period_start, period_end, status, bank_deposit, gst_on_income, gst_on_expenses')
      .eq('user_id', userId)
      .gte('period_end', period_start)
      .lte('period_start', period_end)
      .order('period_start', { ascending: true });

    if (settErr) throw settErr;

    if (!settlements || settlements.length === 0) {
      return new Response(JSON.stringify({
        success: true, period_start, period_end,
        marketplace_gst_total_estimate: 0, xero_gst: null, difference: null,
        variance_lines: [], explained_total: 0, unexplained_remainder: null,
        confidence_score: 0, confidence_label: 'Low',
        confidence_reasons: ['No settlements found in this period'],
        xero_source_mode: 'unavailable',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const settlementIds = settlements.map((s: any) => s.settlement_id);

    // ─── Step 2: Get settlement_lines ────────────────────────────
    const { data: lines } = await supabase
      .from('settlement_lines')
      .select('settlement_id, accounting_category, amount, description')
      .eq('user_id', userId)
      .in('settlement_id', settlementIds);

    // ─── Step 3: Get xero_accounting_matches ─────────────────────
    const { data: xeroMatches } = await supabase
      .from('xero_accounting_matches')
      .select('settlement_id, xero_invoice_id, xero_invoice_number')
      .eq('user_id', userId)
      .in('settlement_id', settlementIds);

    const matchMap: Record<string, { xero_invoice_id: string | null; xero_invoice_number: string | null }> = {};
    for (const m of (xeroMatches || []) as any[]) {
      if (m.xero_invoice_id) matchMap[m.settlement_id] = { xero_invoice_id: m.xero_invoice_id, xero_invoice_number: m.xero_invoice_number };
    }
    const matchedSettlementIds = new Set(Object.keys(matchMap));

    // ─── Step 4: Compute per-settlement GST + build evidence ─────
    const linesBySettlement: Record<string, any[]> = {};
    for (const line of (lines || [])) {
      if (!linesBySettlement[line.settlement_id]) linesBySettlement[line.settlement_id] = [];
      linesBySettlement[line.settlement_id].push(line);
    }

    let totalGstOnSales = 0;
    let totalRefundGst = 0;
    let totalAdjustmentGst = 0;
    let totalUnknownGst = 0;
    let totalLineCount = 0;
    let unclassifiedLineCount = 0;

    interface SettEvidence {
      settlement_id: string;
      marketplace: string;
      period_start: string;
      period_end: string;
      status: string;
      bank_deposit: number;
      xero_invoice_id: string | null;
      xero_invoice_number: string | null;
      gst_on_sales: number;
      refund_gst: number;
      adjustment_gst: number;
      unknown_gst: number;
      unclassified_count: number;
      is_pushed: boolean;
    }

    const settEvidenceMap: Record<string, SettEvidence> = {};
    let unpushedGst = 0;
    const unpushedSettlementIds: string[] = [];
    const refundSettlementIds: string[] = [];
    const adjustmentSettlementIds: string[] = [];
    const unclassifiedSettlementIds: string[] = [];

    for (const sett of settlements) {
      const settLines = linesBySettlement[sett.settlement_id] || [];
      let settGstSales = 0;
      let settRefundGst = 0;
      let settAdjGst = 0;
      let settUnknownGst = 0;
      let settUnclassified = 0;

      if (settLines.length > 0) {
        for (const line of settLines) {
          totalLineCount++;
          const cat = line.accounting_category || '';
          const amt = Number(line.amount) || 0;

          if (GST_INCOME_CATEGORIES.includes(cat)) {
            settGstSales += amt;
          } else if (GST_EXPENSE_CATEGORIES.includes(cat)) {
            // fees GST — not part of payable comparison
          } else if (cat === REFUND_CATEGORY) {
            settRefundGst += Math.abs(amt) / 11;
          } else if (cat === ADJUSTMENT_CATEGORY) {
            settAdjGst += Math.abs(amt) / 11;
          } else if (!KNOWN_CATEGORIES.includes(cat)) {
            settUnclassified++;
            unclassifiedLineCount++;
            settUnknownGst += Math.abs(amt) / 11;
          }
        }
      } else {
        settGstSales = Number(sett.gst_on_income) || 0;
      }

      totalGstOnSales += settGstSales;
      totalRefundGst += settRefundGst;
      totalAdjustmentGst += settAdjGst;
      totalUnknownGst += settUnknownGst;

      const isPushed = PUSHED_STATUSES.includes(sett.status) || matchedSettlementIds.has(sett.settlement_id);
      const xm = matchMap[sett.settlement_id];

      settEvidenceMap[sett.settlement_id] = {
        settlement_id: sett.settlement_id,
        marketplace: sett.marketplace,
        period_start: sett.period_start,
        period_end: sett.period_end,
        status: sett.status,
        bank_deposit: sett.bank_deposit,
        xero_invoice_id: xm?.xero_invoice_id || null,
        xero_invoice_number: xm?.xero_invoice_number || null,
        gst_on_sales: round2(settGstSales),
        refund_gst: round2(settRefundGst),
        adjustment_gst: round2(settAdjGst),
        unknown_gst: round2(settUnknownGst),
        unclassified_count: settUnclassified,
        is_pushed: isPushed,
      };

      if (!isPushed) {
        const netGst = round2(settGstSales - settRefundGst);
        unpushedGst += netGst;
        unpushedSettlementIds.push(sett.settlement_id);
      }
      if (settRefundGst > 0.001) refundSettlementIds.push(sett.settlement_id);
      if (settAdjGst > 0.001) adjustmentSettlementIds.push(sett.settlement_id);
      if (settUnclassified > 0) unclassifiedSettlementIds.push(sett.settlement_id);
    }

    const marketplaceGstTotal = round2(totalGstOnSales - totalRefundGst);

    // ─── Step 5: Xero GST ───────────────────────────────────────
    let xeroGst: number | null = null;
    let xeroSourceMode: 'tax_summary' | 'xettle_invoices_only' | 'unavailable' = 'unavailable';

    if (matchedSettlementIds.size > 0) {
      let xeroGstTotal = 0;
      for (const sett of settlements) {
        if (matchedSettlementIds.has(sett.settlement_id)) {
          xeroGstTotal += Math.abs(Number(sett.gst_on_income) || 0);
          xeroGstTotal -= Math.abs(Number(sett.gst_on_expenses) || 0);
        }
      }
      xeroGst = round2(xeroGstTotal);
      xeroSourceMode = 'xettle_invoices_only';
    }

    const difference = xeroGst !== null ? round2(marketplaceGstTotal - xeroGst) : null;

    // ─── Helper: build sample array (max 20) ─────────────────────
    function buildSample(ids: string[], gstField: 'gst_on_sales' | 'refund_gst' | 'adjustment_gst' | 'unknown_gst', signed: number = 1) {
      const samples = ids.slice(0, 20).map(id => {
        const e = settEvidenceMap[id];
        return {
          settlement_id: e.settlement_id,
          marketplace: e.marketplace,
          period_start: e.period_start,
          period_end: e.period_end,
          status: e.status,
          xero_invoice_id: e.xero_invoice_id,
          gst_contribution: round2(signed * (e[gstField] || 0)),
          note: !e.is_pushed ? 'Not pushed to Xero' : undefined,
        };
      });
      return samples.sort((a, b) => Math.abs(b.gst_contribution) - Math.abs(a.gst_contribution));
    }

    // ─── Helper: build line samples for line-driven variances ────
    function buildLineSamples(ids: string[], filterFn: (line: any) => boolean, amountFn: (line: any) => number) {
      const samples: any[] = [];
      for (const id of ids) {
        const settLines = linesBySettlement[id] || [];
        for (const line of settLines) {
          if (filterFn(line)) {
            samples.push({
              settlement_id: id,
              line_type: line.accounting_category || 'unknown',
              description: line.description || undefined,
              amount: round2(Number(line.amount) || 0),
              gst_amount: round2(amountFn(line)),
              note: undefined,
            });
          }
        }
        if (samples.length >= 50) break; // cap line samples
      }
      return samples.sort((a, b) => Math.abs(b.gst_amount || 0) - Math.abs(a.gst_amount || 0)).slice(0, 30);
    }

    // ─── Step 6: Build variance lines with evidence ──────────────
    const varianceLines: any[] = [];

    // A) Settlements not pushed
    if (unpushedSettlementIds.length > 0 && unpushedGst !== 0) {
      varianceLines.push({
        code: 'SETTLEMENTS_NOT_PUSHED',
        label: 'Settlements not yet pushed to Xero',
        amount: round2(unpushedGst),
        confidence: unpushedSettlementIds.length <= 3 ? 'high' : 'medium',
        evidence_level: 'settlement',
        evidence: {
          settlement_ids: unpushedSettlementIds,
          settlement_count: unpushedSettlementIds.length,
          marketplace_codes: [...new Set(unpushedSettlementIds.map(id => settEvidenceMap[id]?.marketplace).filter(Boolean))],
          sample: buildSample(unpushedSettlementIds, 'gst_on_sales'),
          notes: [`${unpushedSettlementIds.length} settlement(s) in this period have no linked Xero invoice`],
        },
      });
    }

    // B) Unclassified GST
    if (totalUnknownGst > 0.01) {
      varianceLines.push({
        code: 'UNCLASSIFIED_GST',
        label: 'Unclassified / unknown GST components',
        amount: round2(totalUnknownGst),
        confidence: 'low',
        evidence_level: 'line',
        evidence: {
          settlement_ids: unclassifiedSettlementIds,
          settlement_count: unclassifiedSettlementIds.length,
          sample: buildSample(unclassifiedSettlementIds, 'unknown_gst'),
          line_samples: buildLineSamples(
            unclassifiedSettlementIds,
            (line) => !KNOWN_CATEGORIES.includes(line.accounting_category || ''),
            (line) => Math.abs(Number(line.amount) || 0) / 11,
          ),
          notes: [`${unclassifiedLineCount} line item(s) could not be classified into known GST buckets`],
        },
      });
    }

    // C) Refund GST
    if (Math.abs(totalRefundGst) > 0.01) {
      varianceLines.push({
        code: 'REFUND_GST',
        label: 'Refund GST adjustments',
        amount: round2(-totalRefundGst),
        confidence: 'high',
        evidence_level: 'settlement',
        evidence: {
          settlement_ids: refundSettlementIds,
          settlement_count: refundSettlementIds.length,
          sample: buildSample(refundSettlementIds, 'refund_gst', -1),
          notes: ['GST component of refunds estimated at 1/11 of refund amounts'],
        },
      });
    }

    // D) Adjustment GST
    if (Math.abs(totalAdjustmentGst) > 0.01) {
      varianceLines.push({
        code: 'ADJUSTMENT_GST',
        label: 'Settlement adjustments',
        amount: round2(totalAdjustmentGst),
        confidence: 'medium',
        evidence_level: 'line',
        evidence: {
          settlement_ids: adjustmentSettlementIds,
          settlement_count: adjustmentSettlementIds.length,
          sample: buildSample(adjustmentSettlementIds, 'adjustment_gst'),
          line_samples: buildLineSamples(
            adjustmentSettlementIds,
            (line) => (line.accounting_category || '') === ADJUSTMENT_CATEGORY,
            (line) => Math.abs(Number(line.amount) || 0) / 11,
          ),
          notes: ['GST component of adjustments/corrections estimated at 1/11'],
        },
      });
    }

    // E) Rounding variance
    let roundingDrift = 0;
    const roundingSettlementIds: string[] = [];
    for (const sett of settlements) {
      const settLines = linesBySettlement[sett.settlement_id] || [];
      if (settLines.length > 0) {
        let lineGst = 0;
        for (const line of settLines) {
          if (GST_INCOME_CATEGORIES.includes(line.accounting_category)) {
            lineGst += Number(line.amount) || 0;
          }
        }
        const headerGst = Number(sett.gst_on_income) || 0;
        if (headerGst !== 0) {
          const drift = round2(lineGst) - round2(headerGst);
          if (Math.abs(drift) >= 0.005) {
            roundingDrift += drift;
            roundingSettlementIds.push(sett.settlement_id);
          }
        }
      }
    }
    if (Math.abs(roundingDrift) >= 0.01) {
      varianceLines.push({
        code: 'ROUNDING',
        label: 'Rounding differences',
        amount: round2(roundingDrift),
        confidence: 'high',
        evidence_level: 'line',
        evidence: {
          settlement_ids: roundingSettlementIds,
          settlement_count: roundingSettlementIds.length,
          line_samples: buildLineSamples(
            roundingSettlementIds,
            (line) => GST_INCOME_CATEGORIES.includes(line.accounting_category || ''),
            (line) => Number(line.amount) || 0,
          ),
          notes: ['Cumulative rounding drift between line-level and header-level GST totals'],
        },
      });
    }

    // ─── Step 7: Explained vs unexplained ────────────────────────
    const explainedTotal = round2(varianceLines.reduce((sum: number, v: any) => sum + v.amount, 0));
    const unexplainedRemainder = difference !== null ? round2(difference - explainedTotal) : null;

    // ─── Step 8: Confidence scoring ──────────────────────────────
    let score = 100;
    const reasons: string[] = [];

    if (xeroGst === null) { score -= 40; reasons.push('Xero GST data unavailable — cannot compare'); }
    if (unexplainedRemainder !== null && Math.abs(unexplainedRemainder) >= 1.00) {
      score -= 25;
      reasons.push(`Unexplained remainder of ${formatAUD(unexplainedRemainder)} could not be traced to specific data`);
    }
    if (totalUnknownGst > 0.01) { score -= 15; reasons.push(`${unclassifiedLineCount} line item(s) have unknown GST classification`); }
    const unpushedPct = settlements.length > 0 ? unpushedSettlementIds.length / settlements.length : 0;
    if (unpushedPct > 0.2) { score -= 10; reasons.push(`${Math.round(unpushedPct * 100)}% of settlements not pushed to Xero`); }
    if (xeroSourceMode === 'xettle_invoices_only') { score -= 10; reasons.push('Using Xettle invoice data (fallback) — Xero Tax Summary not available'); }

    score = Math.max(0, score);
    const label = score >= 80 ? 'High' : score >= 50 ? 'Medium' : 'Low';

    return new Response(JSON.stringify({
      success: true, period_start, period_end,
      marketplace_gst_total_estimate: marketplaceGstTotal,
      xero_gst: xeroGst, difference,
      variance_lines: varianceLines,
      explained_total: explainedTotal,
      unexplained_remainder: unexplainedRemainder,
      confidence_score: score, confidence_label: label,
      confidence_reasons: reasons, xero_source_mode: xeroSourceMode,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('generate-gst-variance error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
