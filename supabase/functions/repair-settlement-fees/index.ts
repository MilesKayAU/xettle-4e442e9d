/**
 * repair-settlement-fees — One-off data repair edge function.
 *
 * 1. Finds old api_sync settlements with seller_fees = 0 and applies estimated commission.
 * 2. Removes stale/malformed settlement_profit rows that inflate margins.
 * 3. Flags repaired rows with fees_estimated in raw_payload.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { COMMISSION_ESTIMATES, DEFAULT_COMMISSION_RATE, getCommissionRate } from "../_shared/commission-rates.ts";

/** Paginated fetch helper — avoids the 1000-row default cap */
async function fetchAllRows<T>(
  query: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Resolve user from auth header
  let userId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    userId = body.userId || null;
  } catch { /* ignore */ }

  if (!userId) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data } = await userClient.auth.getUser();
      userId = data?.user?.id || null;
    }
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "No userId" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let settlementsRepaired = 0;
  let profitRowsRemoved = 0;

  // ─── Step 1: Fix zero-fee api_sync settlements ────────────────────
  // Load observed commission rates from app_settings
  const { data: rateSettings } = await admin
    .from("app_settings")
    .select("key, value")
    .eq("user_id", userId)
    .like("key", "observed_commission_rate:%");

  const observedRates: Record<string, number> = {};
  for (const r of rateSettings || []) {
    const code = r.key.replace("observed_commission_rate:", "");
    const num = parseFloat(r.value || "");
    if (code && !isNaN(num) && num > 0 && num < 1) observedRates[code] = num;
  }

  let zeroFeeSettlements: any[];
  try {
    zeroFeeSettlements = await fetchAllRows(
      admin
        .from("settlements")
        .select("id, settlement_id, marketplace, sales_principal, gst_on_income, bank_deposit, raw_payload, source")
        .eq("user_id", userId)
        .eq("source", "api_sync")
        .eq("is_hidden", false)
        .is("duplicate_of_settlement_id", null)
    );
  } catch (fetchErr: any) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const s of zeroFeeSettlements) {
    const sellerFees = Number(s.sales_principal) || 0;
    const existingPayload = (s.raw_payload || {}) as Record<string, unknown>;
    
    // Skip if already repaired (v3 with fees_estimated)
    if (existingPayload.fees_estimated === true && existingPayload.source_version === 'auto-generate-shopify-settlements-v3') {
      continue;
    }

    const mp = s.marketplace || '';
    const salesPrincipal = Number(s.sales_principal) || 0;
    const gstOnIncome = Number(s.gst_on_income) || 0;
    const commissionRate = getCommissionRate(mp, observedRates);
    const estimatedFees = -Math.round(salesPrincipal * commissionRate * 100) / 100;
    const adjustedBankDeposit = Math.round((salesPrincipal + gstOnIncome + estimatedFees) * 100) / 100;

    const updatedPayload = {
      ...existingPayload,
      fees_estimated: true,
      commission_rate_applied: commissionRate,
      source_version: 'auto-generate-shopify-settlements-v3',
      repaired_at: new Date().toISOString(),
      pre_repair_seller_fees: 0,
      pre_repair_bank_deposit: Number(s.bank_deposit) || 0,
    };

    const { error: updateErr } = await admin
      .from("settlements")
      .update({
        seller_fees: estimatedFees,
        bank_deposit: adjustedBankDeposit,
        raw_payload: updatedPayload,
      })
      .eq("id", s.id);

    if (!updateErr) settlementsRepaired++;
  }

  // ─── Step 2: Remove stale settlement_profit rows ──────────────────
  // Get all active settlement IDs for this user (paginated)
  const activeSettlements = await fetchAllRows<{ settlement_id: string }>(
    admin
      .from("settlements")
      .select("settlement_id")
      .eq("user_id", userId)
      .eq("is_hidden", false)
      .is("duplicate_of_settlement_id", null)
      .not("status", "in", '("push_failed_permanent","duplicate_suppressed")')
  );

  const activeIds = new Set(activeSettlements.map(s => s.settlement_id));

  // Get all profit rows (paginated)
  const profitRows = await fetchAllRows<{ id: string; settlement_id: string; marketplace_code: string; margin_percent: number; gross_revenue: number }>(
    admin
      .from("settlement_profit")
      .select("id, settlement_id, marketplace_code, margin_percent, gross_revenue")
      .eq("user_id", userId)
  );

  const toDelete: string[] = [];
  for (const pr of (profitRows || [])) {
    // Remove if settlement no longer exists
    if (!activeIds.has(pr.settlement_id)) {
      toDelete.push(pr.id);
      continue;
    }
    // Remove if margin is suspiciously high (> 95%) for a marketplace with known fees
    const knownRate = COMMISSION_ESTIMATES[pr.marketplace_code];
    if (knownRate && Number(pr.margin_percent) > 95) {
      toDelete.push(pr.id);
      continue;
    }
    // Remove if gross_revenue is 0 or negative (malformed)
    if ((Number(pr.gross_revenue) || 0) <= 0) {
      toDelete.push(pr.id);
    }
  }

  if (toDelete.length > 0) {
    // Delete in batches
    for (let i = 0; i < toDelete.length; i += 50) {
      const batch = toDelete.slice(i, i + 50);
      const { error: delErr } = await admin
        .from("settlement_profit")
        .delete()
        .in("id", batch);
      if (!delErr) profitRowsRemoved += batch.length;
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      settlements_repaired: settlementsRepaired,
      profit_rows_removed: profitRowsRemoved,
      total_zero_fee_checked: (zeroFeeSettlements || []).length,
      total_profit_rows_checked: (profitRows || []).length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
