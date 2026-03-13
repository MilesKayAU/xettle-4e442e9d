
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ══════════════════════════════════════════════════════════════
// INTERNAL FINANCIAL CATEGORIES (canonical)
// Source: src/constants/financial-categories.ts
//
//   gst_income       — GST collected on sales
//   gst_expense      — GST on fees
//   refund           — refunded sale
//   adjustment       — reserve, correction, reimbursement
// ══════════════════════════════════════════════════════════════

const GST_INCOME_CATEGORIES = ['gst_income'];
const GST_EXPENSE_CATEGORIES = ['gst_expense'];
const REFUND_CATEGORY = 'refund';
const ADJUSTMENT_CATEGORY = 'adjustment';
const PUSHED_STATUSES = ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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
        success: true,
        period_start, period_end,
        marketplace_gst_total_estimate: 0,
        xero_gst: null,
        difference: null,
        variance_lines: [],
        explained_total: 0,
        unexplained_remainder: null,
        confidence_score: 0,
        confidence_label: 'Low',
        confidence_reasons: ['No settlements found in this period'],
        xero_source_mode: 'unavailable',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const settlementIds = settlements.map((s: any) => s.settlement_id);

    // ─── Step 2: Get settlement_lines ────────────────────────────
    const { data: lines } = await supabase
      .from('settlement_lines')
      .select('settlement_id, accounting_category, amount')
      .eq('user_id', userId)
      .in('settlement_id', settlementIds);

    // ─── Step 3: Get xero_accounting_matches ─────────────────────
    const { data: xeroMatches } = await supabase
      .from('xero_accounting_matches')
      .select('settlement_id, xero_invoice_id')
      .eq('user_id', userId)
      .in('settlement_id', settlementIds);

    const matchedSettlementIds = new Set(
      (xeroMatches || []).filter((m: any) => m.xero_invoice_id).map((m: any) => m.settlement_id)
    );

    // ─── Step 4: Compute per-settlement GST ──────────────────────
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

    // Track unpushed settlements' GST
    let unpushedGst = 0;
    const unpushedSettlementIds: string[] = [];

    for (const sett of settlements) {
      const settLines = linesBySettlement[sett.settlement_id] || [];
      let settGstSales = 0;
      let settRefundGst = 0;

      if (settLines.length > 0) {
        for (const line of settLines) {
          totalLineCount++;
          const cat = line.accounting_category || '';
          const amt = Number(line.amount) || 0;

          if (GST_INCOME_CATEGORIES.includes(cat)) {
            settGstSales += amt;
          } else if (GST_EXPENSE_CATEGORIES.includes(cat)) {
            // GST on fees — not part of payable GST comparison
          } else if (cat === REFUND_CATEGORY) {
            settRefundGst += Math.abs(amt) / 11;
          } else if (cat === ADJUSTMENT_CATEGORY) {
            totalAdjustmentGst += Math.abs(amt) / 11;
          } else if (!['revenue', 'marketplace_fee', 'payment_fee', 'shipping_income', 'shipping_cost', 'fba_fee', 'storage_fee', 'advertising', 'promotion'].includes(cat)) {
            unclassifiedLineCount++;
            totalUnknownGst += Math.abs(amt) / 11;
          }
        }
      } else {
        // Fallback: header GST fields
        settGstSales = Number(sett.gst_on_income) || 0;
      }

      totalGstOnSales += settGstSales;
      totalRefundGst += settRefundGst;

      // Check if this settlement is pushed to Xero
      const isPushed = PUSHED_STATUSES.includes(sett.status) || matchedSettlementIds.has(sett.settlement_id);
      if (!isPushed) {
        const netGst = round2(settGstSales - settRefundGst);
        unpushedGst += netGst;
        unpushedSettlementIds.push(sett.settlement_id);
      }
    }

    const marketplaceGstTotal = round2(totalGstOnSales - totalRefundGst);

    // ─── Step 5: Xero GST (fallback: from matched settlements) ──
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

    // ─── Step 6: Build variance lines ────────────────────────────
    const varianceLines: any[] = [];

    // A) Settlements not pushed
    if (unpushedSettlementIds.length > 0 && unpushedGst !== 0) {
      varianceLines.push({
        code: 'SETTLEMENTS_NOT_PUSHED',
        label: 'Settlements not yet pushed to Xero',
        amount: round2(unpushedGst),
        confidence: unpushedSettlementIds.length <= 3 ? 'high' : 'medium',
        evidence: {
          settlement_ids: unpushedSettlementIds,
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
        evidence: {
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
        evidence: {
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
        evidence: {
          notes: ['GST component of adjustments/corrections estimated at 1/11'],
        },
      });
    }

    // E) Rounding variance
    // Compute per-settlement rounding drift
    let roundingDrift = 0;
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
          roundingDrift += round2(lineGst) - round2(headerGst);
        }
      }
    }
    if (Math.abs(roundingDrift) >= 0.01) {
      varianceLines.push({
        code: 'ROUNDING',
        label: 'Rounding differences',
        amount: round2(roundingDrift),
        confidence: 'high',
        evidence: {
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

    if (xeroGst === null) {
      score -= 40;
      reasons.push('Xero GST data unavailable — cannot compare');
    }

    if (unexplainedRemainder !== null && Math.abs(unexplainedRemainder) >= 1.00) {
      score -= 25;
      reasons.push(`Unexplained remainder of ${formatAUD(unexplainedRemainder)} could not be traced to specific data`);
    }

    if (totalUnknownGst > 0.01) {
      score -= 15;
      reasons.push(`${unclassifiedLineCount} line item(s) have unknown GST classification`);
    }

    const unpushedPct = settlements.length > 0 ? unpushedSettlementIds.length / settlements.length : 0;
    if (unpushedPct > 0.2) {
      score -= 10;
      reasons.push(`${Math.round(unpushedPct * 100)}% of settlements not pushed to Xero`);
    }

    if (xeroSourceMode === 'xettle_invoices_only') {
      score -= 10;
      reasons.push('Using Xettle invoice data (fallback) — Xero Tax Summary not available');
    }

    score = Math.max(0, score);
    const label = score >= 80 ? 'High' : score >= 50 ? 'Medium' : 'Low';

    const result = {
      success: true,
      period_start,
      period_end,
      marketplace_gst_total_estimate: marketplaceGstTotal,
      xero_gst: xeroGst,
      difference,
      variance_lines: varianceLines,
      explained_total: explainedTotal,
      unexplained_remainder: unexplainedRemainder,
      confidence_score: score,
      confidence_label: label,
      confidence_reasons: reasons,
      xero_source_mode: xeroSourceMode,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('generate-gst-variance error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function formatAUD(n: number): string {
  const prefix = n < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(n).toFixed(2)}`;
}
