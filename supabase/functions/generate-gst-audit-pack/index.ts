
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'https://esm.sh/jszip@3.10.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GST_INCOME_CATEGORIES = ['gst_income'];
const GST_EXPENSE_CATEGORIES = ['gst_expense'];
const REFUND_CATEGORY = 'refund';
const ADJUSTMENT_CATEGORY = 'adjustment';
const PUSHED_STATUSES = ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'];
const KNOWN_CATEGORIES = ['revenue', 'marketplace_fee', 'payment_fee', 'shipping_income', 'shipping_cost', 'fba_fee', 'storage_fee', 'advertising', 'promotion', 'gst_income', 'gst_expense', 'refund', 'adjustment'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function csvEscape(val: any): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: Record<string, any>[]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
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
    const { period_start, period_end, include_line_evidence = false } = body;

    if (!period_start || !period_end) {
      return new Response(JSON.stringify({ error: 'period_start and period_end required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── Fetch settlements ───────────────────────────────────────
    const { data: settlements, error: settErr } = await supabase
      .from('settlements')
      .select('id, settlement_id, marketplace, period_start, period_end, status, bank_deposit, gst_on_income, gst_on_expenses, bank_verified')
      .eq('user_id', userId)
      .gte('period_end', period_start)
      .lte('period_start', period_end)
      .order('period_start', { ascending: true });

    if (settErr) throw settErr;
    const allSettlements = settlements || [];
    const settlementIds = allSettlements.map((s: any) => s.settlement_id);

    // ─── Fetch lines (paginated) + xero matches in parallel ─────
    async function fetchAllLines(sIds: string[]): Promise<any[]> {
      if (sIds.length === 0) return [];
      const allLines: any[] = [];
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('settlement_lines')
          .select('settlement_id, accounting_category, amount, description, transaction_type')
          .eq('user_id', userId)
          .in('settlement_id', sIds)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data || [];
        allLines.push(...rows);
        hasMore = rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }
      return allLines;
    }

    const [allLines, matchesResult] = await Promise.all([
      fetchAllLines(settlementIds),
      settlementIds.length > 0
        ? supabase.from('xero_accounting_matches').select('settlement_id, xero_invoice_id, xero_invoice_number').eq('user_id', userId).in('settlement_id', settlementIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const linesBySettlement: Record<string, any[]> = {};
    for (const line of (linesResult.data || [])) {
      if (!linesBySettlement[line.settlement_id]) linesBySettlement[line.settlement_id] = [];
      linesBySettlement[line.settlement_id].push(line);
    }

    const matchMap: Record<string, any> = {};
    for (const m of (matchesResult.data || []) as any[]) {
      if (m.xero_invoice_id) matchMap[m.settlement_id] = m;
    }
    const matchedSettlementIds = new Set(Object.keys(matchMap));

    // ─── Compute per-settlement GST (same logic as generate-gst-variance) ──
    let totalGstOnSales = 0;
    let totalRefundGst = 0;
    let totalAdjustmentGst = 0;
    let totalUnknownGst = 0;
    let totalLineCount = 0;
    let unclassifiedLineCount = 0;

    interface SettRow {
      settlement_id: string;
      marketplace: string;
      period_start: string;
      period_end: string;
      status: string;
      bank_verified: boolean;
      marketplace_gst_estimate: number;
      xero_invoice_number: string;
      gst_contribution_total: number;
      flags: string;
    }

    const settRows: SettRow[] = [];
    const varianceData: {
      unpushedGst: number;
      unpushedIds: string[];
      refundGst: number;
      refundIds: string[];
      adjustmentGst: number;
      adjustmentIds: string[];
      unknownGst: number;
      unclassifiedIds: string[];
      roundingDrift: number;
      roundingIds: string[];
    } = {
      unpushedGst: 0, unpushedIds: [],
      refundGst: 0, refundIds: [],
      adjustmentGst: 0, adjustmentIds: [],
      unknownGst: 0, unclassifiedIds: [],
      roundingDrift: 0, roundingIds: [],
    };

    // Line evidence collection
    const lineEvidence: Array<{
      variance_code: string;
      settlement_id: string;
      line_type: string;
      description: string;
      amount: number;
      gst_amount: number;
    }> = [];

    for (const sett of allSettlements) {
      const settLines = linesBySettlement[sett.settlement_id] || [];
      const xm = matchMap[sett.settlement_id];
      const isPushed = PUSHED_STATUSES.includes(sett.status) || !!xm;

      let settGstSales = 0;
      let settRefundGst = 0;
      let settAdjGst = 0;
      let settUnknownGst = 0;
      let hasUnclassified = false;

      if (settLines.length > 0) {
        for (const line of settLines) {
          totalLineCount++;
          const cat = line.accounting_category || '';
          const amt = Number(line.amount) || 0;

          if (GST_INCOME_CATEGORIES.includes(cat)) {
            settGstSales += amt;
          } else if (GST_EXPENSE_CATEGORIES.includes(cat)) {
            // fees GST
          } else if (cat === REFUND_CATEGORY) {
            settRefundGst += Math.abs(amt) / 11;
            if (include_line_evidence) {
              lineEvidence.push({
                variance_code: 'REFUND_GST',
                settlement_id: sett.settlement_id,
                line_type: cat,
                description: line.description || '',
                amount: round2(amt),
                gst_amount: round2(Math.abs(amt) / 11),
              });
            }
          } else if (cat === ADJUSTMENT_CATEGORY) {
            settAdjGst += Math.abs(amt) / 11;
            if (include_line_evidence) {
              lineEvidence.push({
                variance_code: 'ADJUSTMENT_GST',
                settlement_id: sett.settlement_id,
                line_type: cat,
                description: line.description || '',
                amount: round2(amt),
                gst_amount: round2(Math.abs(amt) / 11),
              });
            }
          } else if (!KNOWN_CATEGORIES.includes(cat)) {
            unclassifiedLineCount++;
            settUnknownGst += Math.abs(amt) / 11;
            hasUnclassified = true;
            if (include_line_evidence) {
              lineEvidence.push({
                variance_code: 'UNCLASSIFIED_GST',
                settlement_id: sett.settlement_id,
                line_type: cat || 'unknown',
                description: line.description || '',
                amount: round2(amt),
                gst_amount: round2(Math.abs(amt) / 11),
              });
            }
          }
        }
      } else {
        settGstSales = Number(sett.gst_on_income) || 0;
      }

      totalGstOnSales += settGstSales;
      totalRefundGst += settRefundGst;
      totalAdjustmentGst += settAdjGst;
      totalUnknownGst += settUnknownGst;

      // Track variance buckets
      if (!isPushed) {
        const netGst = round2(settGstSales - settRefundGst);
        varianceData.unpushedGst += netGst;
        varianceData.unpushedIds.push(sett.settlement_id);
      }
      if (settRefundGst > 0.001) varianceData.refundIds.push(sett.settlement_id);
      if (settAdjGst > 0.001) varianceData.adjustmentIds.push(sett.settlement_id);
      if (hasUnclassified) varianceData.unclassifiedIds.push(sett.settlement_id);

      // Rounding drift
      if (settLines.length > 0) {
        let lineGst = 0;
        for (const line of settLines) {
          if (GST_INCOME_CATEGORIES.includes(line.accounting_category)) lineGst += Number(line.amount) || 0;
        }
        const headerGst = Number(sett.gst_on_income) || 0;
        if (headerGst !== 0) {
          const drift = round2(lineGst) - round2(headerGst);
          if (Math.abs(drift) >= 0.005) {
            varianceData.roundingDrift += drift;
            varianceData.roundingIds.push(sett.settlement_id);
            if (include_line_evidence) {
              for (const line of settLines) {
                if (GST_INCOME_CATEGORIES.includes(line.accounting_category || '')) {
                  lineEvidence.push({
                    variance_code: 'ROUNDING',
                    settlement_id: sett.settlement_id,
                    line_type: line.accounting_category,
                    description: line.description || '',
                    amount: round2(Number(line.amount) || 0),
                    gst_amount: round2(Number(line.amount) || 0),
                  });
                }
              }
            }
          }
        }
      }

      // Build settlement row for gst_settlements.csv
      const flags: string[] = [];
      if (!isPushed) flags.push('NOT_PUSHED');
      if (hasUnclassified) flags.push('UNCLASSIFIED_LINES');
      if (!sett.bank_verified && sett.status !== 'bank_verified') flags.push('NOT_BANK_VERIFIED');

      settRows.push({
        settlement_id: sett.settlement_id,
        marketplace: sett.marketplace || 'unknown',
        period_start: sett.period_start,
        period_end: sett.period_end,
        status: sett.status || '',
        bank_verified: sett.status === 'bank_verified' || !!sett.bank_verified,
        marketplace_gst_estimate: round2(settGstSales),
        xero_invoice_number: xm?.xero_invoice_number || xm?.xero_invoice_id || '',
        gst_contribution_total: round2(settGstSales - settRefundGst),
        flags: flags.join('|'),
      });
    }

    varianceData.refundGst = round2(totalRefundGst);
    varianceData.adjustmentGst = round2(totalAdjustmentGst);
    varianceData.unknownGst = round2(totalUnknownGst);
    varianceData.roundingDrift = round2(varianceData.roundingDrift);

    // ─── Xero GST ────────────────────────────────────────────────
    let xeroGst: number | null = null;
    let xeroSourceMode = 'unavailable';

    if (matchedSettlementIds.size > 0) {
      let xeroGstTotal = 0;
      for (const sett of allSettlements) {
        if (matchedSettlementIds.has(sett.settlement_id)) {
          xeroGstTotal += Math.abs(Number(sett.gst_on_income) || 0);
          xeroGstTotal -= Math.abs(Number(sett.gst_on_expenses) || 0);
        }
      }
      xeroGst = round2(xeroGstTotal);
      xeroSourceMode = 'xettle_invoices_only';
    }

    const marketplaceGstTotal = round2(totalGstOnSales - totalRefundGst);
    const difference = xeroGst !== null ? round2(marketplaceGstTotal - xeroGst) : null;

    // Confidence
    let score = 100;
    if (xeroGst === null) score -= 40;
    if (totalUnknownGst > 0.01) score -= 15;
    const unpushedPct = allSettlements.length > 0 ? varianceData.unpushedIds.length / allSettlements.length : 0;
    if (unpushedPct > 0.2) score -= 10;
    if (xeroSourceMode === 'xettle_invoices_only') score -= 10;
    score = Math.max(0, score);
    const confidenceLabel = score >= 80 ? 'High' : score >= 50 ? 'Medium' : 'Low';

    const generatedAt = new Date().toISOString();

    // ─── Build CSV files ─────────────────────────────────────────

    // 1. gst_summary.csv
    const summaryHeaders = ['period_start', 'period_end', 'marketplace_gst_estimate', 'linked_xero_gst_estimate', 'difference', 'confidence_score', 'confidence_label', 'xero_source_mode', 'generated_at'];
    const summaryCsv = toCsv(summaryHeaders, [{
      period_start,
      period_end,
      marketplace_gst_estimate: marketplaceGstTotal,
      linked_xero_gst_estimate: xeroGst ?? '',
      difference: difference ?? '',
      confidence_score: score,
      confidence_label: confidenceLabel,
      xero_source_mode: xeroSourceMode,
      generated_at: generatedAt,
    }]);

    // 2. gst_variance.csv
    const varianceHeaders = ['code', 'label', 'amount', 'confidence', 'evidence_level', 'settlement_count', 'notes'];
    const varianceRows: any[] = [];

    if (varianceData.unpushedIds.length > 0 && varianceData.unpushedGst !== 0) {
      varianceRows.push({
        code: 'SETTLEMENTS_NOT_PUSHED',
        label: 'Settlements not yet pushed to Xero',
        amount: round2(varianceData.unpushedGst),
        confidence: varianceData.unpushedIds.length <= 3 ? 'high' : 'medium',
        evidence_level: 'settlement',
        settlement_count: varianceData.unpushedIds.length,
        notes: `${varianceData.unpushedIds.length} settlement(s) have no linked Xero invoice`,
      });
    }
    if (varianceData.unknownGst > 0.01) {
      varianceRows.push({
        code: 'UNCLASSIFIED_GST',
        label: 'Unclassified / unknown GST components',
        amount: varianceData.unknownGst,
        confidence: 'low',
        evidence_level: 'line',
        settlement_count: varianceData.unclassifiedIds.length,
        notes: `${unclassifiedLineCount} line item(s) could not be classified`,
      });
    }
    if (Math.abs(varianceData.refundGst) > 0.01) {
      varianceRows.push({
        code: 'REFUND_GST',
        label: 'Refund GST adjustments',
        amount: round2(-varianceData.refundGst),
        confidence: 'high',
        evidence_level: 'settlement',
        settlement_count: varianceData.refundIds.length,
        notes: 'GST component of refunds estimated at 1/11 of refund amounts',
      });
    }
    if (Math.abs(varianceData.adjustmentGst) > 0.01) {
      varianceRows.push({
        code: 'ADJUSTMENT_GST',
        label: 'Settlement adjustments',
        amount: varianceData.adjustmentGst,
        confidence: 'medium',
        evidence_level: 'line',
        settlement_count: varianceData.adjustmentIds.length,
        notes: 'GST component of adjustments estimated at 1/11',
      });
    }
    if (Math.abs(varianceData.roundingDrift) >= 0.01) {
      varianceRows.push({
        code: 'ROUNDING',
        label: 'Rounding differences',
        amount: varianceData.roundingDrift,
        confidence: 'high',
        evidence_level: 'line',
        settlement_count: varianceData.roundingIds.length,
        notes: 'Cumulative rounding drift between line-level and header-level GST totals',
      });
    }
    const varianceCsv = toCsv(varianceHeaders, varianceRows);

    // 3. gst_settlements.csv
    const settHeaders = ['settlement_id', 'marketplace', 'period_start', 'period_end', 'status', 'bank_verified', 'marketplace_gst_estimate', 'xero_invoice_number', 'gst_contribution_total', 'flags'];
    const settCsv = toCsv(settHeaders, settRows);

    // 4. gst_lines.csv (headers-only if not requested or empty)
    const lineHeaders = ['variance_code', 'settlement_id', 'line_type', 'description', 'amount', 'gst_amount'];
    const lineCsv = toCsv(lineHeaders, include_line_evidence ? lineEvidence : []);

    // 5. README.txt
    const readme = `Marketplace GST Audit Report — Reconciliation Pack

This report is an estimate derived from marketplace settlement data. It is not a BAS return and must be reviewed by a qualified accountant before filing.

──────────────────────────────────────────────
Metadata
──────────────────────────────────────────────
Period:              ${period_start} to ${period_end}
Generated at:        ${generatedAt}
Xero source mode:    ${xeroSourceMode}
Confidence score:    ${score}
Confidence label:    ${confidenceLabel}

──────────────────────────────────────────────
Files in this pack
──────────────────────────────────────────────
gst_summary.csv      Single-row summary of marketplace vs Xero GST
gst_variance.csv     Variance analysis breakdown
gst_settlements.csv  Per-settlement evidence table
gst_lines.csv        Line-level evidence (${include_line_evidence ? lineEvidence.length + ' rows' : 'headers only — line evidence not requested'})
README.txt           This file

──────────────────────────────────────────────
Disclaimer
──────────────────────────────────────────────
• Marketplace GST figures are estimates derived from settlement data.
• "Linked Xero GST" is computed from settlements linked to Xero invoices via Xettle — it is NOT sourced from Xero's Tax Summary API.
• Refund and adjustment GST components are estimated at 1/11 of the gross amount.
• These figures should be cross-referenced with your Xero BAS report and verified by your accountant.
• Xettle accepts no liability for GST filing errors arising from use of this report.
`;

    // ─── Build ZIP ───────────────────────────────────────────────
    const zip = new JSZip();
    zip.file('gst_summary.csv', summaryCsv);
    zip.file('gst_variance.csv', varianceCsv);
    zip.file('gst_settlements.csv', settCsv);
    zip.file('gst_lines.csv', lineCsv);
    zip.file('README.txt', readme);

    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });

    const filename = `gst-reconciliation-pack_${period_start}_to_${period_end}.zip`;

    return new Response(zipBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

  } catch (err: any) {
    console.error('generate-gst-audit-pack error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
