import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { logger } from '../_shared/logger.ts';

const SP_API_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

interface AuditResult {
  settlement_id: string;
  period: string;
  deposit_date: string;
  amounts: {
    sales: number; refunds: number; fees: number;
    fba_fees: number; other: number; advertising: number;
    net: number; gst_income: number; gst_expense: number;
  };
  reconciled_pct: number;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse request
    const body = await req.json().catch(() => ({}));
    const days = Math.min(body.days || 90, 180); // max 180 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    logger.debug(`[historical-audit] User ${userId}: Auditing last ${days} days from ${cutoffStr}`);

    const results: AuditResult[] = [];

    // ─── Get all existing settlements for this user ─────────────
    const { data: existingSettlements } = await supabase
      .from('settlements')
      .select('settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_status, bank_verified')
      .eq('user_id', userId)
      .gte('period_start', cutoffStr);

    const existingByMarketplace: Record<string, any[]> = {};
    const existingIdSet = new Set<string>();
    for (const s of (existingSettlements || [])) {
      const mkt = s.marketplace || 'unknown';
      if (!existingByMarketplace[mkt]) existingByMarketplace[mkt] = [];
      existingByMarketplace[mkt].push(s);
      existingIdSet.add(s.settlement_id);
    }

    // ─── Amazon audit: fetch settlement report headers ──────────
    const { data: amazonToken } = await supabase
      .from('amazon_tokens')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (amazonToken) {
      try {
        const clientId = Deno.env.get('AMAZON_SP_CLIENT_ID')!;
        const clientSecret = Deno.env.get('AMAZON_SP_CLIENT_SECRET')!;

        // Refresh token
        const tokenResp = await fetch('https://api.amazon.com/auth/o2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: amazonToken.refresh_token,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });

        if (tokenResp.ok) {
          const tokenData = await tokenResp.json();
          const accessToken = tokenData.access_token;
          const region = amazonToken.region || 'fe';
          const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe;

          // Fetch report list (headers only — no downloads)
          const params = new URLSearchParams({
            reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
            processingStatuses: 'DONE',
            pageSize: '100',
            createdSince: cutoffDate.toISOString(),
          });

          const reportsResp = await fetch(`${baseUrl}/reports/2021-06-30/reports?${params}`, {
            headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
          });

          if (reportsResp.ok) {
            const reportsData = await reportsResp.json();
            const reports = reportsData.reports || [];

            const amazonExisting = existingByMarketplace['amazon_au'] || [];
            const amazonExistingIds = new Set(amazonExisting.map(s => s.settlement_id));

            // Match reports to existing settlements via report metadata
            const missingReports: Array<{ id: string; date: string; amount: number; status: string }> = [];

            for (const report of reports) {
              const reportId = report.reportId;
              // We don't have settlement_id from report headers alone,
              // so check if we have a settlement covering this report's date range
              const reportDate = report.dataEndTime?.split('T')[0] || report.createdTime?.split('T')[0] || '';

              // Check if any existing settlement covers this report date
              const hasCoverage = amazonExisting.some(s => {
                return s.period_start <= reportDate && s.period_end >= reportDate;
              });

              if (!hasCoverage) {
                missingReports.push({
                  id: reportId,
                  date: reportDate,
                  amount: 0, // headers don't include amount
                  status: 'missing_in_db',
                });
              }
            }

            const alreadyRecorded = reports.length - missingReports.length;
            const reconciledCount = amazonExisting.filter(s =>
              ['reconciled_in_xero', 'bank_verified', 'pushed_to_xero'].includes(s.status)
            ).length;

            results.push({
              marketplace: 'Amazon AU',
              total_headers: reports.length,
              already_recorded: alreadyRecorded,
              missing: missingReports.length,
              missing_settlements: missingReports.slice(0, 20),
              reconciled_pct: amazonExisting.length > 0
                ? Math.round((reconciledCount / amazonExisting.length) * 100)
                : (reports.length === 0 ? 100 : 0),
            });
          }
        }
      } catch (err) {
        console.error('[historical-audit] Amazon audit error:', err);
        results.push({
          marketplace: 'Amazon AU',
          total_headers: 0,
          already_recorded: 0,
          missing: 0,
          missing_settlements: [],
          reconciled_pct: 0,
        });
      }
    }

    // ─── Shopify audit: fetch payout headers ────────────────────
    const { data: shopifyToken } = await supabase
      .from('shopify_tokens')
      .select('access_token, shop_domain')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (shopifyToken) {
      try {
        const params = new URLSearchParams({
          status: 'paid',
          date_min: cutoffStr,
        });

        const payoutsResp = await fetch(
          `https://${shopifyToken.shop_domain}/admin/api/2026-01/shopify_payments/payouts.json?${params}`,
          {
            headers: {
              'X-Shopify-Access-Token': shopifyToken.access_token,
              'Content-Type': 'application/json',
            },
          }
        );

        if (payoutsResp.ok) {
          const payoutsData = await payoutsResp.json();
          const payouts = payoutsData.payouts || [];

          const shopifyExisting = existingByMarketplace['shopify_payments'] || [];
          const shopifyExistingIds = new Set(shopifyExisting.map(s => s.settlement_id));

          const missingPayouts: Array<{ id: string; date: string; amount: number; status: string }> = [];

          for (const payout of payouts) {
            const payoutId = String(payout.id);
            if (!shopifyExistingIds.has(payoutId)) {
              // Also check fingerprint (date + amount ±$0.05)
              const payoutAmount = parseFloat(payout.amount) || 0;
              const hasFingerprint = shopifyExisting.some(s =>
                s.period_end === payout.date && Math.abs((s.bank_deposit || 0) - payoutAmount) <= 0.05
              );

              if (!hasFingerprint) {
                missingPayouts.push({
                  id: payoutId,
                  date: payout.date,
                  amount: payoutAmount,
                  status: 'missing_in_db',
                });
              }
            }
          }

          const alreadyRecorded = payouts.length - missingPayouts.length;
          const reconciledCount = shopifyExisting.filter(s =>
            ['reconciled_in_xero', 'bank_verified', 'pushed_to_xero'].includes(s.status)
          ).length;

          results.push({
            marketplace: 'Shopify Payments',
            total_headers: payouts.length,
            already_recorded: alreadyRecorded,
            missing: missingPayouts.length,
            missing_settlements: missingPayouts.slice(0, 20),
            reconciled_pct: shopifyExisting.length > 0
              ? Math.round((reconciledCount / shopifyExisting.length) * 100)
              : (payouts.length === 0 ? 100 : 0),
          });
        }
      } catch (err) {
        console.error('[historical-audit] Shopify audit error:', err);
        results.push({
          marketplace: 'Shopify Payments',
          total_headers: 0,
          already_recorded: 0,
          missing: 0,
          missing_settlements: [],
          reconciled_pct: 0,
        });
      }
    }

    // ─── Bank verification audit ────────────────────────────────
    const allSettlements = existingSettlements || [];
    const bankVerifiedCount = allSettlements.filter(s => s.bank_verified).length;
    const bankMatchPct = allSettlements.length > 0
      ? Math.round((bankVerifiedCount / allSettlements.length) * 100)
      : 100;

    // ─── Overall health score ───────────────────────────────────
    const totalMissing = results.reduce((s, r) => s + r.missing, 0);
    const totalHeaders = results.reduce((s, r) => s + r.total_headers, 0);
    const overallReconPct = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.reconciled_pct, 0) / results.length)
      : 100;

    // Log audit event
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'historical_audit_complete',
      severity: 'info',
      details: {
        days,
        marketplaces: results.map(r => r.marketplace),
        total_missing: totalMissing,
        overall_reconciled_pct: overallReconPct,
        bank_match_pct: bankMatchPct,
      },
    } as any);

    logger.debug(`[historical-audit] User ${userId}: ${results.length} marketplaces audited, ${totalMissing} missing, ${overallReconPct}% reconciled`);

    return new Response(JSON.stringify({
      success: true,
      audit_period_days: days,
      audit_from: cutoffStr,
      marketplaces: results,
      bank_match_pct: bankMatchPct,
      overall_reconciled_pct: overallReconPct,
      total_settlements_checked: totalHeaders,
      total_missing: totalMissing,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[historical-audit] Error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
