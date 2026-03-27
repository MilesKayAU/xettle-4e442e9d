import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader, type MiraklAuthResult } from "../_shared/mirakl-token.ts";

// ═══════════════════════════════════════════════════════════════
// MIRAKL TRANSACTION TYPE → STANDARD SETTLEMENT FIELD MAP
// Official Mirakl enum from developer.mirakl.com TL05 docs.
// All signs = 1 because Mirakl's `amount` field carries its own sign
// (credits positive, debits negative).
// ═══════════════════════════════════════════════════════════════

const MIRAKL_TYPE_MAP: Record<string, { field: string; sign: 1; accountingCategory: string }> = {
  // ── Sales ──
  ORDER_AMOUNT:                                  { field: "sales_principal", sign: 1, accountingCategory: "revenue" },
  ORDER_AMOUNT_TAX:                              { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  ORDER_SHIPPING_AMOUNT:                         { field: "sales_shipping", sign: 1, accountingCategory: "shipping_income" },
  ORDER_SHIPPING_AMOUNT_TAX:                     { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  // ── Commissions / Fees ──
  COMMISSION_FEE:                                { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  COMMISSION_VAT:                                { field: "gst_on_expenses", sign: 1, accountingCategory: "gst_expense" },
  // ── Refunds ──
  REFUND_ORDER_AMOUNT:                           { field: "refunds", sign: 1, accountingCategory: "refund" },
  REFUND_ORDER_AMOUNT_TAX:                       { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  REFUND_ORDER_SHIPPING_AMOUNT:                  { field: "refunds", sign: 1, accountingCategory: "refund" },
  REFUND_ORDER_SHIPPING_AMOUNT_TAX:              { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  REFUND_COMMISSION_FEE:                         { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  REFUND_COMMISSION_VAT:                         { field: "gst_on_expenses", sign: 1, accountingCategory: "gst_expense" },
  // ── Operator-remitted taxes ──
  OPERATOR_REMITTED_ORDER_AMOUNT_TAX:            { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  OPERATOR_REMITTED_ORDER_SHIPPING_AMOUNT_TAX:   { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  OPERATOR_REMITTED_REFUND_ORDER_AMOUNT_TAX:     { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  OPERATOR_REMITTED_REFUND_ORDER_SHIPPING_AMOUNT_TAX: { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  // ── Operator-paid shipping ──
  OPERATOR_PAID_ORDER_SHIPPING_AMOUNT:           { field: "sales_shipping", sign: 1, accountingCategory: "shipping_income" },
  OPERATOR_PAID_ORDER_SHIPPING_AMOUNT_TAX:       { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  OPERATOR_PAID_REFUND_ORDER_SHIPPING_AMOUNT:    { field: "refunds", sign: 1, accountingCategory: "refund" },
  OPERATOR_PAID_REFUND_ORDER_SHIPPING_AMOUNT_TAX:{ field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  // ── Manual adjustments ──
  MANUAL_CREDIT:                                 { field: "reimbursements", sign: 1, accountingCategory: "adjustment" },
  MANUAL_CREDIT_VAT:                             { field: "gst_on_expenses", sign: 1, accountingCategory: "gst_expense" },
  MANUAL_INVOICE:                                { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  MANUAL_INVOICE_VAT:                            { field: "gst_on_expenses", sign: 1, accountingCategory: "gst_expense" },
  // ── Subscription ──
  SUBSCRIPTION_FEE:                              { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  SUBSCRIPTION_VAT:                              { field: "gst_on_expenses", sign: 1, accountingCategory: "gst_expense" },
  // ── Seller fees ──
  SELLER_FEE_ON_ORDER:                           { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  SELLER_FEE_ON_ORDER_TAX:                       { field: "gst_on_expenses", sign: 1, accountingCategory: "gst_expense" },
  SELLER_PENALTY_FEE:                            { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  SELLER_PENALTY_FEE_TAX:                        { field: "gst_on_expenses", sign: 1, accountingCategory: "gst_expense" },
  // ── Order fees ──
  ORDER_FEE_AMOUNT:                              { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  REFUND_ORDER_FEE_AMOUNT:                       { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  OPERATOR_REMITTED_ORDER_FEE_AMOUNT:            { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  OPERATOR_REMITTED_REFUND_ORDER_FEE_AMOUNT:     { field: "other_fees", sign: 1, accountingCategory: "marketplace_fee" },
  // ── Purchase commissions ──
  PURCHASE_COMMISSION_FEE:                       { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  PURCHASE_SHIPPING_COMMISSION_FEE:              { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  REFUND_PURCHASE_COMMISSION_FEE:                { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  REFUND_PURCHASE_SHIPPING_COMMISSION_FEE:       { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  // ── Purchase taxes ──
  PURCHASE_ORDER_AMOUNT_TAX:                     { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  PURCHASE_ORDER_SHIPPING_AMOUNT_TAX:            { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  REFUND_PURCHASE_ORDER_AMOUNT_TAX:              { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  REFUND_PURCHASE_ORDER_SHIPPING_AMOUNT_TAX:     { field: "gst_on_income", sign: 1, accountingCategory: "gst_income" },
  PURCHASE_FEE_COMMISSION_FEE:                   { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  REFUND_PURCHASE_FEE_COMMISSION_FEE:            { field: "seller_fees", sign: 1, accountingCategory: "marketplace_fee" },
  // ── Reserve ──
  RESERVE_FUNDING:                               { field: "other_fees", sign: 1, accountingCategory: "adjustment" },
  RESERVE_SETTLEMENT:                            { field: "reimbursements", sign: 1, accountingCategory: "adjustment" },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    console.log("[fetch-mirakl-settlements] ▶ Invoked");
    const { userId, isCron } = await verifyRequest(req, { allowCron: true });
    const body = await req.json().catch(() => ({}));
    console.log("[fetch-mirakl-settlements] userId:", userId, "isCron:", isCron, "body:", JSON.stringify(body));

    // Determine which user(s) to fetch for
    const targetUserId = isCron ? (body.userId || null) : userId;
    if (!targetUserId) {
      console.log("[fetch-mirakl-settlements] No target user — aborting");
      return new Response(
        JSON.stringify({ error: "No target user" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load Mirakl connections for user (service role bypasses RLS)
    const { data: connections, error: connErr } = await adminClient
      .from("mirakl_tokens")
      .select("*")
      .eq("user_id", targetUserId);

    if (connErr) throw connErr;
    console.log("[fetch-mirakl-settlements] Connections found:", connections?.length ?? 0);
    if (!connections || connections.length === 0) {
      return new Response(
        JSON.stringify({ error: "No Bunnings connections found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load accounting boundary date
    const { data: boundaryRow } = await adminClient
      .from("app_settings")
      .select("value")
      .eq("user_id", targetUserId)
      .eq("key", "accounting_boundary_date")
      .maybeSingle();
    const accountingBoundary = boundaryRow?.value || null;

    const allResults: any[] = [];

    for (const connection of connections) {
      try {
        const authResult = await getMiraklAuthHeader(adminClient, connection);
        const result = await fetchSettlementsForConnection(
          adminClient, targetUserId, connection, authResult, body.sync_from, accountingBoundary,
        );
        allResults.push({
          marketplace_label: connection.marketplace_label,
          base_url: connection.base_url,
          ...result,
        });
      } catch (connError: any) {
        allResults.push({
          marketplace_label: connection.marketplace_label,
          base_url: connection.base_url,
          error: connError.message,
        });
      }
    }

    const totalImported = allResults.reduce((s, r) => s + (r.imported || 0), 0);
    const totalSkipped = allResults.reduce((s, r) => s + (r.skipped || 0), 0);
    const totalEmpty = allResults.reduce((s, r) => s + (r.empty_skipped || 0), 0);
    const errors = allResults.filter((r) => r.error);
    console.log(`[fetch-mirakl-settlements] ✅ Done — imported: ${totalImported}, skipped: ${totalSkipped}, empty: ${totalEmpty}, errors: ${errors.length}`);

    // Log mirakl_fetch_complete event
    await adminClient.from("system_events").insert({
      user_id: targetUserId,
      event_type: "mirakl_fetch_complete",
      severity: errors.length > 0 ? "warning" : "info",
      marketplace_code: "bunnings",
      details: {
        imported: totalImported,
        skipped: totalSkipped,
        empty_skipped: totalEmpty,
        errors: errors.length,
        connections_count: connections.length,
      },
    });

    if (errors.length > 0 && errors.length === allResults.length) {
      const firstError = errors[0].error;
      return new Response(
        JSON.stringify({ error: firstError, connections: allResults }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported: totalImported,
        skipped: totalSkipped,
        empty_skipped: totalEmpty,
        connections: allResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[fetch-mirakl-settlements] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: err.message?.includes("Forbidden") ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ═══════════════════════════════════════════════════════════════
// CORE FETCH — IV01 PRIMARY
//
// IV01 (/api/invoices) returns AUTO_INVOICE billing cycles with a
// rich `summary` block containing ALL the data we need:
//   - amount_transferred = bank_deposit (net payout to seller)
//   - total_payable_orders_incl_tax = gross sales
//   - total_refund_orders_incl_tax = refunds (negative)
//   - total_commissions_incl_tax = seller fees (negative)
//   - total_subscription_incl_tax = subscription fees (negative)
//   - payment.transaction_date = payment date
//   - payment.state = PAID / PENDING
//
// PA11 endpoints do NOT exist on Bunnings. TL05 only has unfunded
// pending transactions. IV01 is the single source of truth.
//
// Pagination: IV01 returns max 50 per page. We paginate with offset
// to fetch ALL invoices (Bunnings has 105+ as of Mar 2026).
// ═══════════════════════════════════════════════════════════════

interface IV01Invoice {
  invoice_id: number;
  date_created: string;
  start_time: string;
  end_time: string;
  state: string;
  type: string;
  payment?: {
    reference?: string;
    state?: string;
    transaction_date?: string;
  };
  summary?: {
    amount_transferred?: number;
    amount_transferred_to_operator?: number;
    total_payable_orders_incl_tax?: number;
    total_refund_orders_incl_tax?: number;
    total_commissions_incl_tax?: number;
    total_commissions_excl_tax?: number;
    total_subscription_incl_tax?: number;
    total_subscription_excl_tax?: number;
    total_other_credits_incl_tax?: number;
    total_other_invoices_incl_tax?: number;
    total_seller_fees_on_orders_incl_tax?: number;
    total_seller_penalty_fees_incl_tax?: number;
    total_operator_remitted_taxes?: number;
    total_refund_commissions_incl_tax?: number;
    total_refund_commissions_excl_tax?: number;
  };
  details?: Array<{
    amount_excl_taxes?: number;
    description?: string;
    taxes?: Array<{ amount: number; code: string }>;
  }>;
}

async function fetchSettlementsForConnection(
  adminClient: any,
  userId: string,
  connection: any,
  authResult: { headerName: string; headerValue: string },
  syncFrom?: string,
  accountingBoundary?: string | null,
) {
  const baseUrl = connection.base_url.replace(/\/$/, "");
  const marketplaceCode = (connection.marketplace_label || "mirakl").toLowerCase().replace(/\s+/g, "_");
  const shopId = connection.seller_company_id && connection.seller_company_id !== "default"
    ? connection.seller_company_id : null;

  // Default to 90 days if no sync_from
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 90);
  const dateFrom = syncFrom || defaultFrom.toISOString().split("T")[0];

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Paginate through ALL IV01 invoices
  // IV01 is the ONLY source of truth for Bunnings payouts.
  // ═══════════════════════════════════════════════════════════════

  const allInvoices: IV01Invoice[] = [];
  let offset = 0;
  const pageSize = 50;
  let totalCount = 0;

  while (true) {
    const iv01Url = `${baseUrl}/api/invoices?${new URLSearchParams({
      type: "ALL",
      limit: String(pageSize),
      offset: String(offset),
    })}`;

    console.log(`[fetch-mirakl-settlements] 🌐 IV01 page offset=${offset}: ${iv01Url}`);

    const iv01Res = await fetch(iv01Url, {
      headers: {
        [authResult.headerName]: authResult.headerValue,
        Accept: "application/json",
      },
    });

    if (!iv01Res.ok) {
      const errText = await iv01Res.text().catch(() => "");
      if (offset === 0) {
        throw new Error(`Mirakl IV01 API error ${iv01Res.status}: ${errText.slice(0, 200)}`);
      }
      console.warn(`[fetch-mirakl-settlements] ⚠️ IV01 page at offset=${offset} failed: ${iv01Res.status}`);
      break;
    }

    const pageData = await iv01Res.json();
    totalCount = pageData.total_count || 0;
    const invoices: IV01Invoice[] = pageData.invoices || [];

    if (invoices.length === 0) break;
    allInvoices.push(...invoices);

    offset += invoices.length;
    if (offset >= totalCount) break;

    // Rate limit: 1 req/sec
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`[fetch-mirakl-settlements] 📦 IV01 total: ${totalCount}, fetched: ${allInvoices.length}`);

  if (allInvoices.length === 0) {
    return { imported: 0, skipped: 0, empty_skipped: 0, message: "No IV01 invoices found" };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Filter to invoices within date range and process each
  // ═══════════════════════════════════════════════════════════════

  let imported = 0;
  let skipped = 0;
  let emptySkipped = 0;

  for (const inv of allInvoices) {
    // Map Mirakl IV01 state + payment.state to canonical payout_status
    const miraklPayoutStatus = mapMiraklPayoutStatus(inv.state, inv.payment?.state);

    // Skip CANCELLED invoices entirely
    if (miraklPayoutStatus === "cancelled") {
      console.log(`[fetch-mirakl-settlements] ⏭️ Skipping ${inv.invoice_id}: state=${inv.state} (cancelled)`);
      skipped++;
      continue;
    }

    const periodStart = inv.start_time?.split("T")[0] || dateFrom;
    const periodEnd = inv.end_time?.split("T")[0] || new Date().toISOString().split("T")[0];
    const paymentDate = inv.payment?.transaction_date?.split("T")[0] || periodEnd;

    // Date range filter: only process invoices where payment_date >= dateFrom
    if (paymentDate < dateFrom) {
      skipped++;
      continue;
    }

    const summary = inv.summary || {};
    const bankDeposit = round2(summary.amount_transferred || 0);

    // Skip zero-amount invoices
    if (Math.abs(bankDeposit) < 0.01 && Math.abs(summary.total_payable_orders_incl_tax || 0) < 0.01) {
      emptySkipped++;
      continue;
    }

    // Build settlement ID matching CSV convention: BUN-{shop_id}-{end_date}
    const shopPrefix = shopId || (inv as any).shop_id || "2301";
    const settlementId = `BUN-${shopPrefix}-${periodEnd}`;

    // Extract financial data directly from IV01 summary
    // All amounts are from the seller's perspective:
    //   total_payable_orders_incl_tax = gross sales (positive)
    //   total_refund_orders_incl_tax = refunds (negative)
    //   total_commissions_incl_tax = commission fees (negative)
    //   amount_transferred = net payout (positive)
    const grossSales = round2(summary.total_payable_orders_incl_tax || 0);
    const refunds = round2(summary.total_refund_orders_incl_tax || 0); // Already negative
    const commissionInclTax = round2(summary.total_commissions_incl_tax || 0); // Already negative
    const commissionExclTax = round2(summary.total_commissions_excl_tax || 0); // Already negative
    const subscriptionInclTax = round2(summary.total_subscription_incl_tax || 0);
    const subscriptionExclTax = round2(summary.total_subscription_excl_tax || 0);
    const refundCommissionInclTax = round2(summary.total_refund_commissions_incl_tax || 0);
    const refundCommissionExclTax = round2(summary.total_refund_commissions_excl_tax || 0);
    const otherCreditsInclTax = round2(summary.total_other_credits_incl_tax || 0);
    const otherInvoicesInclTax = round2(summary.total_other_invoices_incl_tax || 0);
    const sellerFeesOnOrders = round2(summary.total_seller_fees_on_orders_incl_tax || 0);
    const sellerPenaltyFees = round2(summary.total_seller_penalty_fees_incl_tax || 0);

    // GST on fees = difference between incl and excl tax amounts
    const commissionGst = round2(commissionInclTax - commissionExclTax);
    const subscriptionGst = round2(subscriptionInclTax - subscriptionExclTax);
    const refundCommissionGst = round2(refundCommissionInclTax - refundCommissionExclTax);

    // For Australian GST: sales are GST-inclusive, so GST on income = sales / 11
    const gstOnIncome = round2(grossSales / 11);
    const salesExGst = round2(grossSales - gstOnIncome);

    // Total seller fees (excl tax) — all negative values
    const totalFeesExclTax = round2(
      commissionExclTax + subscriptionExclTax + refundCommissionExclTax +
      sellerFeesOnOrders + sellerPenaltyFees
    );
    const totalFeesGst = round2(commissionGst + subscriptionGst + refundCommissionGst);

    // Boundary check
    let isPreBoundary = false;
    if (accountingBoundary && periodEnd < accountingBoundary) {
      isPreBoundary = true;
    }

    // Reconciliation: verify bank_deposit ≈ gross_sales + refunds + fees + other
    const calculatedPayout = round2(grossSales + refunds + commissionInclTax +
      subscriptionInclTax + refundCommissionInclTax + otherCreditsInclTax +
      otherInvoicesInclTax + sellerFeesOnOrders + sellerPenaltyFees);
    const reconDiff = round2(Math.abs(calculatedPayout - bankDeposit));
    let reconStatus = "reconciled";
    if (reconDiff >= 1.0) {
      reconStatus = "recon_warning";
      await adminClient.from("system_events").insert({
        user_id: userId,
        event_type: "mirakl_reconciliation_mismatch",
        severity: "warning",
        marketplace_code: marketplaceCode,
        details: {
          settlement_id: settlementId,
          invoice_id: inv.invoice_id,
          calculated_payout: calculatedPayout,
          bank_deposit: bankDeposit,
          difference: reconDiff,
          source: "iv01_primary",
        },
      });
    }

    const settlementStatus = isPreBoundary ? "pre_boundary"
      : reconStatus === "recon_warning" ? "recon_warning" : "saved";

    console.log(`[fetch-mirakl-settlements] 📊 ${settlementId}: bank_deposit=${bankDeposit}, gross=${grossSales}, refunds=${refunds}, fees=${totalFeesExclTax}, payment=${paymentDate}`);

    // Upsert settlement
    const { error: upsertErr } = await adminClient.from("settlements").upsert({
      user_id: userId,
      settlement_id: settlementId,
      marketplace: marketplaceCode,
      period_start: periodStart,
      period_end: periodEnd,
      bank_deposit: bankDeposit,
      sales_principal: salesExGst,
      sales_shipping: 0, // IV01 doesn't break out shipping separately
      seller_fees: totalFeesExclTax,
      refunds: refunds,
      reimbursements: round2(otherCreditsInclTax),
      other_fees: round2(otherInvoicesInclTax + sellerFeesOnOrders + sellerPenaltyFees),
      gst_on_income: gstOnIncome,
      gst_on_expenses: totalFeesGst,
      status: settlementStatus,
      source: "mirakl_api",
      source_reference: `iv01_invoice_${inv.invoice_id}`,
      is_pre_boundary: isPreBoundary,
    }, { onConflict: "user_id,marketplace,settlement_id" });

    if (upsertErr) {
      console.error(`[fetch-mirakl-settlements] Upsert failed for ${settlementId}:`, upsertErr);
      continue;
    }

    // Source priority check — self-suppress if CSV already exists
    try {
      await serverSideSourcePriority(adminClient, userId, marketplaceCode, periodStart, periodEnd, settlementId);
    } catch (e: any) { /* ignore */ }

    // CSV mismatch detection
    try {
      await detectAndCorrectCsvMismatch(adminClient, userId, marketplaceCode, periodStart, periodEnd, bankDeposit, settlementId);
    } catch (e: any) { /* ignore */ }

    imported++;
  }

  return { imported, skipped, empty_skipped: emptySkipped, source: "iv01_primary", total_iv01: allInvoices.length };
}

// ═══════════════════════════════════════════════════════════════
// API/CSV mismatch detection — when API data disagrees with a
// previously-uploaded CSV settlement, auto-correct if unpushed
// or flag for manual correction if already pushed to Xero.
// ═══════════════════════════════════════════════════════════════

async function detectAndCorrectCsvMismatch(
  adminClient: any,
  userId: string,
  marketplace: string,
  periodStart: string,
  periodEnd: string,
  apiBankDeposit: number,
  apiSettlementId: string,
) {
  const { data: csvSettlements } = await adminClient
    .from("settlements")
    .select("id, settlement_id, bank_deposit, source, status")
    .eq("user_id", userId)
    .eq("marketplace", marketplace)
    .in("source", ["csv_upload", "manual"])
    .neq("status", "duplicate_suppressed")
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart);

  if (!csvSettlements || csvSettlements.length === 0) return;

  for (const csv of csvSettlements) {
    const discrepancy = Math.abs(apiBankDeposit - (csv.bank_deposit || 0));
    if (discrepancy <= 1.0) continue;

    const isPushed = ["pushed_to_xero", "already_recorded"].includes(csv.status);

    await adminClient.from("system_events").insert({
      user_id: userId,
      event_type: "api_csv_bank_deposit_mismatch",
      severity: isPushed ? "warning" : "info",
      marketplace_code: marketplace,
      settlement_id: csv.settlement_id,
      details: {
        settlement_id: csv.settlement_id,
        api_settlement_id: apiSettlementId,
        marketplace,
        stored_bank_deposit: csv.bank_deposit,
        api_bank_deposit: apiBankDeposit,
        discrepancy: round2(discrepancy),
        settlement_status: csv.status,
        source: csv.source,
        auto_corrected: !isPushed,
        correction_reason: isPushed
          ? "already_pushed_to_xero_needs_manual_correction"
          : "api_is_source_of_truth",
      },
    });

    if (!isPushed) {
      await adminClient
        .from("settlements")
        .update({ bank_deposit: apiBankDeposit, sync_origin: "api_corrected" })
        .eq("id", csv.id);
      console.log(`[fetch-mirakl-settlements] ✅ Auto-corrected ${csv.settlement_id} bank_deposit: ${csv.bank_deposit} → ${apiBankDeposit}`);
    } else {
      console.log(`[fetch-mirakl-settlements] ⚠️ Mismatch flagged for ${csv.settlement_id} (pushed): stored=${csv.bank_deposit}, api=${apiBankDeposit}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Server-side source priority — mirakl_api self-suppresses
// if a manual/csv_upload settlement already exists for the period
// ═══════════════════════════════════════════════════════════════

async function serverSideSourcePriority(
  adminClient: any,
  userId: string,
  marketplace: string,
  periodStart: string,
  periodEnd: string,
  settlementId: string,
) {
  const { data: manualExists } = await adminClient
    .from("settlements")
    .select("id, settlement_id")
    .eq("user_id", userId)
    .in("source", ["manual", "csv_upload"])
    .eq("marketplace", marketplace)
    .neq("status", "duplicate_suppressed")
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart)
    .limit(1);

  if (manualExists && manualExists.length > 0) {
    await adminClient
      .from("settlements")
      .update({
        status: "duplicate_suppressed",
        duplicate_of_settlement_id: manualExists[0].settlement_id,
        duplicate_reason: "Manual CSV upload already exists for this period",
      })
      .eq("settlement_id", settlementId)
      .eq("user_id", userId);

    await adminClient.from("system_events").insert({
      user_id: userId,
      event_type: "settlement_self_suppressed_by_source_priority",
      severity: "info",
      marketplace_code: marketplace,
      settlement_id: settlementId,
      details: {
        existing_manual_id: manualExists[0].settlement_id,
        reason: "mirakl_api record auto-suppressed because manual CSV already exists",
        period: `${periodStart} → ${periodEnd}`,
      },
    });

    console.log(`[fetch-mirakl-settlements] ⚠️ Self-suppressed ${settlementId} — manual CSV exists`);
  }
}
