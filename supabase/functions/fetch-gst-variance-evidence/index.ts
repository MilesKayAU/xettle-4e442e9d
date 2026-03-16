
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders, handleCorsPreflightResponse } from '../_shared/cors.ts';

const GST_INCOME_CATEGORIES = ['gst_income'];
const REFUND_CATEGORY = 'refund';
const ADJUSTMENT_CATEGORY = 'adjustment';
const PUSHED_STATUSES = ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'];
const KNOWN_CATEGORIES = ['revenue', 'marketplace_fee', 'payment_fee', 'shipping_income', 'shipping_cost', 'fba_fee', 'storage_fee', 'advertising', 'promotion', 'gst_income', 'gst_expense', 'refund', 'adjustment'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  const preflightResponse = handleCorsPreflightResponse(req);
  if (preflightResponse) return preflightResponse;

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
    const {
      period_start, period_end, variance_code,
      settlement_ids: requestedIds,
      cursor, limit: rawLimit,
      filters,
    } = body;

    if (!period_start || !period_end || !variance_code) {
      return new Response(JSON.stringify({ error: 'period_start, period_end, and variance_code required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pageLimit = Math.min(Math.max(Number(rawLimit) || 25, 1), 100);

    // ─── Fetch settlements in period ─────────────────────────────
    let query = supabase
      .from('settlements')
      .select('id, settlement_id, marketplace, period_start, period_end, status, bank_deposit, gst_on_income, gst_on_expenses')
      .eq('user_id', userId)
      .gte('period_end', period_start)
      .lte('period_start', period_end)
      .order('period_start', { ascending: true });

    if (requestedIds && requestedIds.length > 0) {
      query = query.in('settlement_id', requestedIds);
    }

    const { data: settlements, error: settErr } = await query;
    if (settErr) throw settErr;

    if (!settlements || settlements.length === 0) {
      return new Response(JSON.stringify({
        success: true, variance_code,
        rows: [], next_cursor: null,
        totals: { gst_contribution_total: 0, settlement_count_total: 0 },
        line_samples: [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const settlementIds = settlements.map((s: any) => s.settlement_id);

    // ─── Fetch lines + xero matches ──────────────────────────────
    const [linesResult, matchesResult] = await Promise.all([
      supabase.from('settlement_lines').select('settlement_id, accounting_category, amount, description').eq('user_id', userId).in('settlement_id', settlementIds),
      supabase.from('xero_accounting_matches').select('settlement_id, xero_invoice_id, xero_invoice_number').eq('user_id', userId).in('settlement_id', settlementIds),
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

    // ─── Compute per-settlement evidence rows ────────────────────
    const allRows: any[] = [];
    let gstContributionTotal = 0;
    const allLineSamples: any[] = [];

    for (const sett of settlements) {
      const settLines = linesBySettlement[sett.settlement_id] || [];
      const xm = matchMap[sett.settlement_id];
      const isPushed = PUSHED_STATUSES.includes(sett.status) || !!xm;
      const issues: string[] = [];

      let gstContribution = 0;
      let settGstSales = 0;
      let settRefundGst = 0;
      let settAdjGst = 0;
      let settUnknownGst = 0;
      let hasUnclassified = false;

      if (settLines.length > 0) {
        for (const line of settLines) {
          const cat = line.accounting_category || '';
          const amt = Number(line.amount) || 0;
          if (GST_INCOME_CATEGORIES.includes(cat)) settGstSales += amt;
          else if (cat === REFUND_CATEGORY) settRefundGst += Math.abs(amt) / 11;
          else if (cat === ADJUSTMENT_CATEGORY) settAdjGst += Math.abs(amt) / 11;
          else if (!KNOWN_CATEGORIES.includes(cat)) { settUnknownGst += Math.abs(amt) / 11; hasUnclassified = true; }
        }
      } else {
        settGstSales = Number(sett.gst_on_income) || 0;
      }

      // Compute gst_contribution based on variance_code
      switch (variance_code) {
        case 'SETTLEMENTS_NOT_PUSHED':
          if (!isPushed) { gstContribution = round2(settGstSales - settRefundGst); } else continue;
          break;
        case 'UNCLASSIFIED_GST':
          if (hasUnclassified) { gstContribution = round2(settUnknownGst); } else continue;
          break;
        case 'REFUND_GST':
          if (settRefundGst > 0.001) { gstContribution = round2(-settRefundGst); } else continue;
          break;
        case 'ADJUSTMENT_GST':
          if (settAdjGst > 0.001) { gstContribution = round2(settAdjGst); } else continue;
          break;
        case 'ROUNDING': {
          let lineGst = 0;
          for (const line of settLines) {
            if (GST_INCOME_CATEGORIES.includes(line.accounting_category)) lineGst += Number(line.amount) || 0;
          }
          const headerGst = Number(sett.gst_on_income) || 0;
          const drift = headerGst !== 0 ? round2(round2(lineGst) - round2(headerGst)) : 0;
          if (Math.abs(drift) >= 0.005) { gstContribution = drift; } else continue;
          break;
        }
        default:
          continue;
      }

      if (!isPushed) issues.push('NOT_PUSHED');
      if (hasUnclassified) issues.push('UNCLASSIFIED_LINES');
      if (sett.status !== 'bank_verified') issues.push('NOT_BANK_VERIFIED');

      gstContributionTotal += gstContribution;

      allRows.push({
        settlement_id: sett.settlement_id,
        marketplace: sett.marketplace,
        period_start: sett.period_start,
        period_end: sett.period_end,
        status: sett.status,
        bank_verified: sett.status === 'bank_verified',
        xero_invoice_id: xm?.xero_invoice_id || null,
        xero_invoice_number: xm?.xero_invoice_number || null,
        marketplace_gst_estimate: round2(settGstSales),
        gst_contribution: gstContribution,
        issues,
      });

      // Build line samples for line-driven variance types
      const LINE_DRIVEN_CODES = ['UNCLASSIFIED_GST', 'ROUNDING', 'ADJUSTMENT_GST'];
      if (LINE_DRIVEN_CODES.includes(variance_code) && allLineSamples.length < 50) {
        for (const line of settLines) {
          const cat = line.accounting_category || '';
          const amt = Number(line.amount) || 0;
          let include = false;
          let gstAmt = 0;

          if (variance_code === 'UNCLASSIFIED_GST' && !KNOWN_CATEGORIES.includes(cat)) {
            include = true;
            gstAmt = round2(Math.abs(amt) / 11);
          } else if (variance_code === 'ADJUSTMENT_GST' && cat === ADJUSTMENT_CATEGORY) {
            include = true;
            gstAmt = round2(Math.abs(amt) / 11);
          } else if (variance_code === 'ROUNDING' && GST_INCOME_CATEGORIES.includes(cat)) {
            include = true;
            gstAmt = round2(amt);
          }

          if (include && allLineSamples.length < 50) {
            allLineSamples.push({
              settlement_id: sett.settlement_id,
              line_type: cat || 'unknown',
              description: line.description || undefined,
              amount: round2(amt),
              gst_amount: gstAmt,
            });
          }
        }
      }
    }

    // Sort by absolute GST contribution desc, then settlement_id asc
    allRows.sort((a, b) => {
      const diff = Math.abs(b.gst_contribution) - Math.abs(a.gst_contribution);
      if (diff !== 0) return diff;
      return a.settlement_id.localeCompare(b.settlement_id);
    });

    // ─── Apply server-side filters ───────────────────────────────
    let filteredRows = allRows;
    if (filters) {
      if (filters.only_not_pushed) {
        filteredRows = filteredRows.filter(r => r.issues.includes('NOT_PUSHED'));
      }
      if (filters.only_unclassified) {
        filteredRows = filteredRows.filter(r => r.issues.includes('UNCLASSIFIED_LINES'));
      }
      if (filters.top_contributors) {
        // Top 20% or abs >= median contribution
        const sorted = [...filteredRows].sort((a, b) => Math.abs(b.gst_contribution) - Math.abs(a.gst_contribution));
        const topN = Math.max(5, Math.ceil(sorted.length * 0.2));
        const topIds = new Set(sorted.slice(0, topN).map(r => r.settlement_id));
        filteredRows = filteredRows.filter(r => topIds.has(r.settlement_id));
      }
    }

    // ─── Cursor-based pagination ─────────────────────────────────
    let startIndex = 0;
    if (cursor) {
      try {
        startIndex = Number(atob(cursor));
        if (isNaN(startIndex) || startIndex < 0) startIndex = 0;
      } catch { startIndex = 0; }
    }

    const pageRows = filteredRows.slice(startIndex, startIndex + pageLimit);
    const hasMore = startIndex + pageLimit < filteredRows.length;
    const nextCursor = hasMore ? btoa(String(startIndex + pageLimit)) : null;

    // Sort line samples by abs gst_amount desc
    allLineSamples.sort((a, b) => Math.abs(b.gst_amount || 0) - Math.abs(a.gst_amount || 0));

    return new Response(JSON.stringify({
      success: true,
      variance_code,
      rows: pageRows,
      next_cursor: nextCursor,
      totals: {
        gst_contribution_total: round2(gstContributionTotal),
        settlement_count_total: allRows.length,
      },
      line_samples: allLineSamples.slice(0, 30),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('fetch-gst-variance-evidence error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
