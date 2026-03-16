
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, handleCorsPreflightResponse } from '../_shared/cors.ts';

// ══════════════════════════════════════════════════════════════
// INTERNAL FINANCIAL CATEGORIES (canonical)
// Source: src/constants/financial-categories.ts
//
//   revenue          — item sale (ex GST)
//   marketplace_fee  — commission / referral fee
//   payment_fee      — gateway fee (Stripe, PayPal)
//   shipping_income  — shipping charged to customer
//   shipping_cost    — shipping expense
//   refund           — refunded sale
//   gst_income       — GST collected on sales
//   gst_expense      — GST on fees
//   promotion        — discount / promotional rebate
//   adjustment       — reserve, correction, reimbursement
//   fba_fee          — fulfilment fee (Amazon FBA)
//   storage_fee      — storage / warehousing
//   advertising      — sponsored product costs
// ══════════════════════════════════════════════════════════════

const GST_INCOME_CATEGORIES = ['gst_income'];
const GST_EXPENSE_CATEGORIES = ['gst_expense'];
const REVENUE_CATEGORIES = ['revenue', 'shipping_income'];
const FEE_CATEGORIES = ['marketplace_fee', 'payment_fee', 'fba_fee', 'storage_fee', 'advertising', 'shipping_cost'];
const REFUND_CATEGORY = 'refund';
const ADJUSTMENT_CATEGORY = 'adjustment';
const PROMOTION_CATEGORY = 'promotion';

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  const preflightResponse = handleCorsPreflightResponse(req);
  if (preflightResponse) return preflightResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user from JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    const body = await req.json();
    const { period_start, period_end } = body;

    if (!period_start || !period_end) {
      return new Response(JSON.stringify({ error: 'period_start and period_end required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      const emptyResult = {
        period_start,
        period_end,
        marketplace_sales_ex_gst: 0,
        marketplace_gst_on_sales_estimate: 0,
        marketplace_fees_ex_gst: 0,
        marketplace_gst_on_fees_estimate: 0,
        marketplace_refund_gst_estimate: 0,
        marketplace_adjustment_gst_estimate: 0,
        marketplace_tax_collected_by_platform: 0,
        marketplace_unknown_gst: 0,
        xero_gst: null,
        difference: null,
        confidence_score: 0,
        confidence_label: 'Low',
        notes: ['No settlements found in this period'],
        breakdown: { marketplaces: {}, settlements: [] },
      };
      return new Response(JSON.stringify(emptyResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const settlementIds = settlements.map((s: any) => s.settlement_id);

    // ─── Step 2: Get settlement_lines for these settlements ──────
    const { data: lines, error: linesErr } = await supabase
      .from('settlement_lines')
      .select('settlement_id, accounting_category, amount, transaction_type')
      .eq('user_id', userId)
      .in('settlement_id', settlementIds);

    if (linesErr) throw linesErr;

    // ─── Step 3: Aggregate marketplace GST from lines ────────────
    // Use actual gst_income / gst_expense categories from settlement_lines
    // Fall back to settlement header fields if lines don't have GST categories
    let totalGstOnSales = 0;
    let totalGstOnFees = 0;
    let totalRevenueExGst = 0;
    let totalFeesExGst = 0;
    let totalRefundGst = 0;
    let totalAdjustmentGst = 0;
    let totalTaxByPlatform = 0;
    let totalUnknownGst = 0;

    // Per-marketplace breakdown
    const marketplaceBreakdown: Record<string, {
      gst_on_sales: number;
      gst_on_fees: number;
      revenue_ex_gst: number;
      fees_ex_gst: number;
      refund_gst: number;
      settlement_count: number;
    }> = {};

    // Per-settlement breakdown
    const settlementBreakdown: any[] = [];

    // Group lines by settlement
    const linesBySettlement: Record<string, any[]> = {};
    for (const line of (lines || [])) {
      if (!linesBySettlement[line.settlement_id]) linesBySettlement[line.settlement_id] = [];
      linesBySettlement[line.settlement_id].push(line);
    }

    // Track classification stats for confidence
    let totalLineCount = 0;
    let unclassifiedLineCount = 0;

    for (const sett of settlements) {
      const marketplace = sett.marketplace || 'unknown';
      if (!marketplaceBreakdown[marketplace]) {
        marketplaceBreakdown[marketplace] = {
          gst_on_sales: 0, gst_on_fees: 0, revenue_ex_gst: 0,
          fees_ex_gst: 0, refund_gst: 0, settlement_count: 0,
        };
      }
      marketplaceBreakdown[marketplace].settlement_count++;

      const settLines = linesBySettlement[sett.settlement_id] || [];
      let settGstSales = 0;
      let settGstFees = 0;
      let settRevenue = 0;
      let settFees = 0;
      let settRefundGst = 0;

      if (settLines.length > 0) {
        for (const line of settLines) {
          totalLineCount++;
          const cat = line.accounting_category || '';
          const amt = Number(line.amount) || 0;

          if (GST_INCOME_CATEGORIES.includes(cat)) {
            settGstSales += amt;
          } else if (GST_EXPENSE_CATEGORIES.includes(cat)) {
            settGstFees += amt;
          } else if (REVENUE_CATEGORIES.includes(cat)) {
            settRevenue += amt;
          } else if (FEE_CATEGORIES.includes(cat)) {
            settFees += amt;
          } else if (cat === REFUND_CATEGORY) {
            // Estimate GST component of refund: refund / 11
            settRefundGst += Math.abs(amt) / 11;
          } else if (cat === ADJUSTMENT_CATEGORY) {
            totalAdjustmentGst += Math.abs(amt) / 11;
          } else if (cat === PROMOTION_CATEGORY) {
            // Promotions don't typically carry GST
          } else {
            unclassifiedLineCount++;
            totalUnknownGst += Math.abs(amt) / 11;
          }
        }
      } else {
        // Fallback: use settlement header GST fields
        settGstSales = Number(sett.gst_on_income) || 0;
        settGstFees = Number(sett.gst_on_expenses) || 0;
      }

      totalGstOnSales += settGstSales;
      totalGstOnFees += Math.abs(settGstFees);
      totalRevenueExGst += settRevenue;
      totalFeesExGst += settFees;
      totalRefundGst += settRefundGst;

      marketplaceBreakdown[marketplace].gst_on_sales += settGstSales;
      marketplaceBreakdown[marketplace].gst_on_fees += Math.abs(settGstFees);
      marketplaceBreakdown[marketplace].revenue_ex_gst += settRevenue;
      marketplaceBreakdown[marketplace].fees_ex_gst += settFees;
      marketplaceBreakdown[marketplace].refund_gst += settRefundGst;

      settlementBreakdown.push({
        settlement_id: sett.settlement_id,
        marketplace,
        period_start: sett.period_start,
        period_end: sett.period_end,
        status: sett.status,
        bank_deposit: sett.bank_deposit,
        gst_on_sales: round2(settGstSales),
        gst_on_fees: round2(Math.abs(settGstFees)),
        refund_gst: round2(settRefundGst),
      });
    }

    // ─── Step 4: Xero GST comparison ────────────────────────────
    // Fallback mode: compute from Xettle-created invoices only
    let xeroGst: number | null = null;
    let usedFallback = false;

    try {
      // Get Xettle-created invoices linked to settlements in this period
      const { data: matches } = await supabase
        .from('xero_accounting_matches')
        .select('xero_invoice_id, settlement_id')
        .eq('user_id', userId)
        .in('settlement_id', settlementIds)
        .not('xero_invoice_id', 'is', null);

      if (matches && matches.length > 0) {
        // Sum GST from the settlement header fields for matched settlements
        let xeroGstTotal = 0;
        for (const match of matches) {
          const sett = settlements.find((s: any) => s.settlement_id === match.settlement_id);
          if (sett) {
            xeroGstTotal += Math.abs(Number(sett.gst_on_income) || 0);
            xeroGstTotal -= Math.abs(Number(sett.gst_on_expenses) || 0);
          }
        }
        xeroGst = round2(xeroGstTotal);
        usedFallback = true; // We're using Xettle invoice data, not Xero Tax Summary
      }
    } catch {
      // Xero comparison unavailable
    }

    // ─── Step 5: Compute totals and confidence ──────────────────
    const marketplaceGstTotal = round2(totalGstOnSales - totalRefundGst);
    const diff = xeroGst !== null ? round2(marketplaceGstTotal - xeroGst) : null;

    // Confidence scoring
    let score = 100;
    const warnings: string[] = [];

    if (xeroGst === null) {
      score -= 40;
      warnings.push('Xero GST data unavailable — cannot compare');
    }

    const settlementsWithXero = settlements.filter((s: any) =>
      settlementBreakdown.find((sb: any) => sb.settlement_id === s.settlement_id)
    );
    // Check how many settlements are linked to Xero
    const linkedCount = settlementBreakdown.filter((sb: any) => {
      return ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(sb.status);
    }).length;
    const unlinkedPct = settlements.length > 0 ? (settlements.length - linkedCount) / settlements.length : 1;
    if (unlinkedPct > 0.2) {
      score -= 20;
      warnings.push(`${Math.round(unlinkedPct * 100)}% of settlements not pushed to Xero`);
    }

    if (totalLineCount > 0) {
      const unclassifiedPct = unclassifiedLineCount / totalLineCount;
      if (unclassifiedPct > 0.2) {
        score -= 15;
        warnings.push(`${Math.round(unclassifiedPct * 100)}% of line items have unknown GST classification`);
      }
    }

    const bankVerifiedCount = settlementBreakdown.filter((sb: any) => sb.status === 'bank_verified').length;
    if (settlements.length > 0 && bankVerifiedCount / settlements.length < 0.5) {
      score -= 10;
      warnings.push('Majority of settlements not bank-verified');
    }

    if (usedFallback) {
      score -= 10;
      warnings.push('Using Xettle invoice data (fallback) — Xero Tax Summary not available');
    }

    score = Math.max(0, score);
    const label = score >= 80 ? 'High' : score >= 50 ? 'Medium' : 'Low';

    const result = {
      period_start,
      period_end,
      marketplace_sales_ex_gst: round2(totalRevenueExGst),
      marketplace_gst_on_sales_estimate: round2(totalGstOnSales),
      marketplace_fees_ex_gst: round2(totalFeesExGst),
      marketplace_gst_on_fees_estimate: round2(totalGstOnFees),
      marketplace_refund_gst_estimate: round2(totalRefundGst),
      marketplace_adjustment_gst_estimate: round2(totalAdjustmentGst),
      marketplace_tax_collected_by_platform: round2(totalTaxByPlatform),
      marketplace_unknown_gst: round2(totalUnknownGst),
      xero_gst: xeroGst,
      difference: diff,
      confidence_score: score,
      confidence_label: label,
      notes: warnings,
      breakdown: {
        marketplaces: marketplaceBreakdown,
        settlements: settlementBreakdown,
      },
    };

    // ─── Step 6: Cache result ────────────────────────────────────
    await supabase.from('gst_audit_summary').upsert({
      user_id: userId,
      period_start,
      period_end,
      marketplace_sales_ex_gst: result.marketplace_sales_ex_gst,
      marketplace_gst_on_sales_estimate: result.marketplace_gst_on_sales_estimate,
      marketplace_fees_ex_gst: result.marketplace_fees_ex_gst,
      marketplace_gst_on_fees_estimate: result.marketplace_gst_on_fees_estimate,
      marketplace_refund_gst_estimate: result.marketplace_refund_gst_estimate,
      marketplace_adjustment_gst_estimate: result.marketplace_adjustment_gst_estimate,
      marketplace_tax_collected_by_platform: result.marketplace_tax_collected_by_platform,
      marketplace_unknown_gst: result.marketplace_unknown_gst,
      xero_gst: result.xero_gst,
      difference: result.difference,
      confidence_score: result.confidence_score,
      confidence_label: result.confidence_label,
      notes: result.notes,
      breakdown: result.breakdown,
    }, { onConflict: 'user_id,period_start,period_end' });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('generate-gst-summary error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
