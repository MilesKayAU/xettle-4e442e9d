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
// CORE FETCH — HYBRID: IV01 billing cycle calendar + TL05 transactions
//
// IV01 (/api/invoices) returns COMMISSION invoices — operator fees
// charged TO the seller. These give us authoritative billing cycle
// date ranges and fee breakdowns.
//
// TL05 (/api/sellerpayment/transactions_logs) returns individual
// order transactions — sales, refunds, payments. These give us
// the full settlement data including bank_deposit (payout amount).
//
// Hybrid approach:
//   1. IV01 → discover billing cycle date ranges + fee amounts
//   2. TL05 → fetch all transactions, group by IV01 cycle dates
//   3. Sum TL05 transactions per cycle for authoritative totals
// ═══════════════════════════════════════════════════════════════

interface BillingCycle {
  cycleNumber: string;
  periodStart: string;
  periodEnd: string;
  iv01Commission: number;
  iv01Tax: number;
  iv01Subscription: number;
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
  // STEP 1: Fetch billing cycles from IV01 (Accounting Documents)
  // These are COMMISSION invoices, not payouts.
  // We use them to discover billing cycle date ranges.
  // ═══════════════════════════════════════════════════════════════

  let billingCycles: BillingCycle[] = [];

  try {
    const iv01Url = `${baseUrl}/api/invoices?${new URLSearchParams({
      type: "ALL",
      limit: "50",
      start_date: `${dateFrom}T00:00:00Z`,
    })}`;

    console.log(`[fetch-mirakl-settlements] 🌐 IV01 URL: ${iv01Url}`);

    const iv01Res = await fetch(iv01Url, {
      headers: {
        [authResult.headerName]: authResult.headerValue,
        Accept: "application/json",
      },
    });

    console.log(`[fetch-mirakl-settlements] 📡 IV01 Response status: ${iv01Res.status}`);

    if (iv01Res.ok) {
      const iv01Data = await iv01Res.json();
      const invoices = iv01Data.invoices || iv01Data.data || [];
      console.log(`[fetch-mirakl-settlements] 📦 IV01 invoices count: ${Array.isArray(invoices) ? invoices.length : 0}`);

      if (Array.isArray(invoices)) {
        for (const inv of invoices) {
          const cycleNumber = inv.invoice_id || inv.accounting_document_number || inv.id;
          if (!cycleNumber) continue;

          // Bunnings uses start_time/end_time
          const periodStart = inv.start_time?.split("T")[0] || inv.start_date?.split("T")[0] || dateFrom;
          const periodEnd = inv.end_time?.split("T")[0] || inv.end_date?.split("T")[0]
            || inv.issue_date?.split("T")[0] || new Date().toISOString().split("T")[0];

          // Extract fee breakdown from IV01 detail lines
          let commission = 0;
          let subscription = 0;
          let tax = 0;
          if (Array.isArray(inv.details)) {
            for (const detail of inv.details) {
              const desc = (detail.description || "").toLowerCase();
              const amount = parseFloat(String(detail.amount_excl_taxes || detail.amount || 0)) || 0;
              const detailTax = Array.isArray(detail.taxes)
                ? detail.taxes.reduce((s: number, t: any) => s + (parseFloat(String(t.amount)) || 0), 0)
                : 0;

              if (desc.includes("commission")) {
                commission += amount;
              } else if (desc.includes("subscription")) {
                subscription += amount;
              } else {
                commission += amount;
              }
              tax += detailTax;
            }
          } else {
            commission = parseFloat(String(inv.total_amount_excl_taxes || 0)) || 0;
            tax = parseFloat(String(inv.total_taxes || 0)) || 0;
          }

          billingCycles.push({
            cycleNumber: String(cycleNumber),
            periodStart,
            periodEnd,
            iv01Commission: round2(commission),
            iv01Tax: round2(tax),
            iv01Subscription: round2(subscription),
          });

          console.log(`[fetch-mirakl-settlements] 📊 IV01 cycle ${cycleNumber}: ${periodStart}→${periodEnd}, commission=${round2(commission)}, sub=${round2(subscription)}, tax=${round2(tax)}`);
        }
      }
    } else {
      console.warn(`[fetch-mirakl-settlements] ⚠️ IV01 returned ${iv01Res.status} — will use TL05-only mode`);
    }
  } catch (iv01Err: any) {
    console.warn(`[fetch-mirakl-settlements] ⚠️ IV01 fetch failed: ${iv01Err.message} — will use TL05-only mode`);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Fetch ALL TL05 transactions for the full date range
  // TL05 returns order-level transactions — sales, refunds, payouts
  // ═══════════════════════════════════════════════════════════════

  let apiUrl = `${baseUrl}/api/sellerpayment/transactions_logs?start_date=${dateFrom}T00:00:00Z&paginate=false`;
  if (shopId) apiUrl += `&shop=${shopId}`;

  console.log(`[fetch-mirakl-settlements] 🌐 TL05 URL: ${apiUrl}`);

  const tl05Res = await fetch(apiUrl, {
    headers: {
      [authResult.headerName]: authResult.headerValue,
      Accept: "application/json",
    },
  });

  if (!tl05Res.ok) {
    const errorText = await tl05Res.text().catch(() => "");
    throw new Error(`Mirakl TL05 API error ${tl05Res.status}: ${errorText.slice(0, 200)}`);
  }

  const tl05Data = await tl05Res.json();
  const transactions = tl05Data.transactions || tl05Data.transaction_logs || tl05Data.data || [];
  console.log(`[fetch-mirakl-settlements] 📦 TL05 transactions count: ${Array.isArray(transactions) ? transactions.length : 0}`);

  if (Array.isArray(transactions) && transactions.length > 0) {
    console.log(`[fetch-mirakl-settlements] 📦 TL05 txn[0] keys: ${Object.keys(transactions[0]).join(", ")}`);
    console.log(`[fetch-mirakl-settlements] 📦 TL05 txn[0] sample: ${JSON.stringify(transactions[0]).slice(0, 300)}`);
  }

  if (!Array.isArray(transactions) || transactions.length === 0) {
    console.log(`[fetch-mirakl-settlements] ⚠️ TL05 returned no transactions`);
    return { imported: 0, skipped: 0, empty_skipped: 0, message: "No transactions found" };
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Group TL05 transactions by billing cycle date ranges
  // If IV01 gave us cycles, use those. Otherwise use payment_reference.
  // ═══════════════════════════════════════════════════════════════

  type GroupedTxns = { cycle: BillingCycle | null; txns: any[] };
  const groups = new Map<string, GroupedTxns>();

  if (billingCycles.length > 0) {
    // Sort cycles by periodStart ascending
    billingCycles.sort((a, b) => a.periodStart.localeCompare(b.periodStart));

    // Initialize groups for each cycle
    for (const cycle of billingCycles) {
      groups.set(cycle.cycleNumber, { cycle, txns: [] });
    }

    // Assign each TL05 transaction to the matching billing cycle
    for (const txn of transactions) {
      const txnDate = (txn.date_created || txn.transaction_date || txn.created_date || "").split("T")[0];
      if (!txnDate) continue;

      let matched = false;
      for (const cycle of billingCycles) {
        if (txnDate >= cycle.periodStart && txnDate <= cycle.periodEnd) {
          groups.get(cycle.cycleNumber)!.txns.push(txn);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Transaction outside any known cycle — overflow bucket
        if (!groups.has("overflow")) {
          groups.set("overflow", { cycle: null, txns: [] });
        }
        groups.get("overflow")!.txns.push(txn);
      }
    }
  } else {
    // No IV01 data — fall back to payment_reference grouping
    for (const txn of transactions) {
      const key = txn.payment_reference || txn.payout_id || txn.accounting_document_number || "ungrouped";
      if (!groups.has(key)) groups.set(key, { cycle: null, txns: [] });
      groups.get(key)!.txns.push(txn);
    }
  }

  console.log(`[fetch-mirakl-settlements] 📊 Grouped into ${groups.size} settlement groups (IV01 cycles: ${billingCycles.length})`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Process each group into a settlement
  // ═══════════════════════════════════════════════════════════════

  let imported = 0;
  let skipped = 0;
  let emptySkipped = 0;

  for (const [groupKey, { cycle, txns }] of groups) {
    if (groupKey === "overflow" || txns.length === 0) continue;

    // Accumulate TL05 transactions using MIRAKL_TYPE_MAP
    const totals: Record<string, number> = {
      sales_principal: 0, sales_shipping: 0, seller_fees: 0, refunds: 0,
      reimbursements: 0, other_fees: 0, gst_on_income: 0, gst_on_expenses: 0, bank_deposit: 0,
    };
    let periodStart = cycle?.periodStart || "";
    let periodEnd = cycle?.periodEnd || "";
    const lineRows: any[] = [];

    for (const txn of txns) {
      const amount = Number(txn.amount) || 0;
      const type = (txn.transaction_type || txn.type || "").toUpperCase();
      const txnDate = (txn.date_created || txn.transaction_date || txn.created_date || "").split("T")[0];

      // Track date range if no cycle dates
      if (txnDate && !cycle) {
        if (!periodStart || txnDate < periodStart) periodStart = txnDate;
        if (!periodEnd || txnDate > periodEnd) periodEnd = txnDate;
      }

      let accountingCategory = "adjustment";
      if (type.includes("PAYMENT") || type.includes("PAYOUT") || type.includes("TRANSFER")) {
        totals.bank_deposit += amount;
      } else if (MIRAKL_TYPE_MAP[type]) {
        const mapping = MIRAKL_TYPE_MAP[type];
        totals[mapping.field] += amount * mapping.sign;
        accountingCategory = mapping.accountingCategory;
      } else {
        totals.other_fees += amount;
      }

      lineRows.push({
        user_id: userId,
        settlement_id: "", // Set below
        order_id: txn.order_id || txn.order_commercial_id || null,
        sku: null,
        amount: round2(amount),
        amount_description: type,
        transaction_type: txn.transaction_type || txn.type || "Unknown",
        amount_type: type,
        accounting_category: accountingCategory,
        marketplace_name: connection.marketplace_label || "Mirakl",
        posted_date: txnDate || null,
        source: "mirakl_api",
      });
    }

    // Skip empty settlements
    const hasActivity = Object.values(totals).some(v => Math.abs(v) > 0.001);
    if (!hasActivity) { emptySkipped++; continue; }

    // Build settlement ID
    const effectivePeriodEnd = periodEnd || new Date().toISOString().split("T")[0];
    let settlementId: string;
    if (cycle) {
      // Match CSV convention: BUN-{shop_id}-{end_date}
      const shopPrefix = shopId || "2301";
      settlementId = `BUN-${shopPrefix}-${effectivePeriodEnd}`;
    } else if (groupKey === "ungrouped") {
      const dateBucket = (periodStart || dateFrom).replace(/-/g, "");
      settlementId = `mirakl-${marketplaceCode}-${dateBucket}`;
    } else {
      settlementId = `mirakl-${marketplaceCode}-${groupKey}`;
    }

    for (const row of lineRows) { row.settlement_id = settlementId; }

    // If IV01 gave us fee data, use it as authoritative for seller_fees
    // IV01 commission is what operator charges — should be negative in settlement convention
    if (cycle && (cycle.iv01Commission > 0 || cycle.iv01Subscription > 0)) {
      const iv01TotalFees = -(cycle.iv01Commission + cycle.iv01Subscription);
      const iv01TotalTax = -(cycle.iv01Tax);
      // Only override if TL05 didn't capture fees
      if (Math.abs(totals.seller_fees) < 0.01) {
        totals.seller_fees = iv01TotalFees;
        totals.gst_on_expenses = iv01TotalTax;
      }
    }

    // Boundary check
    let isPreBoundary = false;
    if (accountingBoundary && effectivePeriodEnd < accountingBoundary) {
      isPreBoundary = true;
    }

    // Reconciliation check
    const calculatedSum = round2(
      totals.sales_principal + totals.sales_shipping + totals.seller_fees + totals.refunds +
      totals.reimbursements + totals.other_fees + totals.gst_on_income + totals.gst_on_expenses,
    );
    const reconDiff = Math.abs(calculatedSum - totals.bank_deposit);
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
          calculated_sum: calculatedSum,
          bank_deposit: totals.bank_deposit,
          difference: round2(reconDiff),
          cycle_number: cycle?.cycleNumber,
          source: cycle ? "iv01_tl05_hybrid" : "tl05_only",
        },
      });
    }

    const settlementStatus = isPreBoundary ? "pre_boundary"
      : reconStatus === "recon_warning" ? "recon_warning" : "saved";

    console.log(`[fetch-mirakl-settlements] 📊 Settlement ${settlementId}: bank_deposit=${round2(totals.bank_deposit)}, sales=${round2(totals.sales_principal)}, fees=${round2(totals.seller_fees)}, txns=${txns.length}`);

    // Upsert — unique constraint is (user_id, marketplace, settlement_id)
    const { error: upsertErr } = await adminClient.from("settlements").upsert({
      user_id: userId,
      settlement_id: settlementId,
      marketplace: marketplaceCode,
      period_start: periodStart || dateFrom,
      period_end: effectivePeriodEnd,
      bank_deposit: round2(totals.bank_deposit),
      sales_principal: round2(totals.sales_principal),
      sales_shipping: round2(totals.sales_shipping),
      seller_fees: round2(totals.seller_fees),
      refunds: round2(totals.refunds),
      reimbursements: round2(totals.reimbursements),
      other_fees: round2(totals.other_fees),
      gst_on_income: round2(totals.gst_on_income),
      gst_on_expenses: round2(totals.gst_on_expenses),
      status: settlementStatus,
      source: "mirakl_api",
      is_pre_boundary: isPreBoundary,
    }, { onConflict: "user_id,marketplace,settlement_id" });

    if (upsertErr) {
      console.error(`[fetch-mirakl-settlements] Upsert failed for ${settlementId}:`, upsertErr);
      continue;
    }

    // Write settlement_lines (delete-then-insert for idempotency)
    try {
      await adminClient.from("settlement_lines").delete().eq("user_id", userId).eq("settlement_id", settlementId);
      for (let i = 0; i < lineRows.length; i += 500) {
        const { error: lineErr } = await adminClient.from("settlement_lines").insert(lineRows.slice(i, i + 500));
        if (lineErr) console.error(`[fetch-mirakl-settlements] Lines insert failed:`, lineErr);
      }
      console.log(`[fetch-mirakl-settlements] 📝 Wrote ${lineRows.length} settlement_lines for ${settlementId}`);
    } catch (e: any) {
      console.error(`[fetch-mirakl-settlements] Lines write failed:`, e);
    }

    // Source priority check — self-suppress if CSV already exists
    try {
      await serverSideSourcePriority(adminClient, userId, marketplaceCode, periodStart || dateFrom, effectivePeriodEnd, settlementId);
    } catch (e: any) { /* ignore */ }

    // CSV mismatch detection
    try {
      await detectAndCorrectCsvMismatch(adminClient, userId, marketplaceCode, periodStart || dateFrom, effectivePeriodEnd, round2(totals.bank_deposit), settlementId);
    } catch (e: any) { /* ignore */ }

    imported++;
  }

  return { imported, skipped, empty_skipped: emptySkipped, source: billingCycles.length > 0 ? "iv01_tl05_hybrid" : "tl05_only" };
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
