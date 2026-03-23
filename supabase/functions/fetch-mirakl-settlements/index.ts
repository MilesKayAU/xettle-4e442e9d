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

    // ─── Item 6: Load accounting boundary date ───
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
// CORE FETCH + MAP LOGIC
// ═══════════════════════════════════════════════════════════════

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

  // Default to 90 days if no sync_from
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 90);
  const dateFrom = syncFrom || defaultFrom.toISOString().split("T")[0];

  let apiUrl = `${baseUrl}/api/sellerpayment/transactions_logs?start_date=${dateFrom}T00:00:00Z&paginate=false`;

  if (connection.seller_company_id && connection.seller_company_id !== "default") {
    apiUrl += `&shop=${connection.seller_company_id}`;
  }

  console.log(`[fetch-mirakl-settlements] 🌐 API URL: ${apiUrl}`);
  console.log(`[fetch-mirakl-settlements] Auth header: ${authResult.headerName}: ${authResult.headerValue.slice(0, 20)}...`);

  const res = await fetch(apiUrl, {
    headers: {
      [authResult.headerName]: authResult.headerValue,
      Accept: "application/json",
    },
  });

  console.log(`[fetch-mirakl-settlements] 📡 Response status: ${res.status}`);

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    console.error(`[fetch-mirakl-settlements] ❌ API error ${res.status}: ${errorText.slice(0, 500)}`);
    throw new Error(`Mirakl API error ${res.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await res.json();
  const transactions = data.transactions || data.transaction_logs || data.data || [];

  console.log(`[fetch-mirakl-settlements] 📦 Response keys: ${Object.keys(data).join(", ")}`);
  console.log(`[fetch-mirakl-settlements] 📦 Transactions count: ${Array.isArray(transactions) ? transactions.length : "not an array"}`);
  if (Array.isArray(transactions) && transactions.length > 0) {
    console.log(`[fetch-mirakl-settlements] 📦 Sample txn keys: ${Object.keys(transactions[0]).join(", ")}`);
    console.log(`[fetch-mirakl-settlements] 📦 Sample txn: ${JSON.stringify(transactions[0]).slice(0, 300)}`);
  }

  if (!Array.isArray(transactions) || transactions.length === 0) {
    console.log(`[fetch-mirakl-settlements] ⚠️ No transactions in response`);
    return { imported: 0, skipped: 0, empty_skipped: 0, message: "No transactions found" };
  }

  // ─── Item 4: Group transactions by payment_reference, use date-bucketed ID for ungrouped ───
  const groups = new Map<string, any[]>();
  for (const txn of transactions) {
    const key = txn.payment_reference || txn.payout_id || txn.accounting_document_number || "ungrouped";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(txn);
  }
  console.log(`[fetch-mirakl-settlements] 📊 Grouped into ${groups.size} payout groups`);

  let imported = 0;
  let skipped = 0;
  let emptySkipped = 0;

  for (const [payoutRef, txns] of groups) {
    // ─── Accumulate into standard settlement fields ───
    const totals: Record<string, number> = {
      sales_principal: 0,
      sales_shipping: 0,
      seller_fees: 0,
      refunds: 0,
      reimbursements: 0,
      other_fees: 0,
      gst_on_income: 0,
      gst_on_expenses: 0,
      bank_deposit: 0,
    };

    let periodStart = "";
    let periodEnd = "";

    // Also collect per-transaction line data for settlement_lines
    const lineRows: any[] = [];

    for (const txn of txns) {
      const amount = Number(txn.amount) || 0;
      const type = (txn.transaction_type || txn.type || "").toUpperCase();

      // Track date range
      const txnDate = txn.date_created || txn.transaction_date || txn.created_date || "";
      const dateOnly = txnDate ? txnDate.split("T")[0] : "";
      if (dateOnly) {
        if (!periodStart || dateOnly < periodStart) periodStart = dateOnly;
        if (!periodEnd || dateOnly > periodEnd) periodEnd = dateOnly;
      }

      let accountingCategory = "adjustment";

      if (type.includes("PAYMENT") || type.includes("PAYOUT") || type.includes("TRANSFER")) {
        totals.bank_deposit += amount;
        accountingCategory = "adjustment";
      } else if (MIRAKL_TYPE_MAP[type]) {
        const mapping = MIRAKL_TYPE_MAP[type];
        totals[mapping.field] += amount * mapping.sign;
        accountingCategory = mapping.accountingCategory;
      } else {
        totals.other_fees += amount;
        accountingCategory = "adjustment";
        await adminClient.from("system_events").insert({
          user_id: userId,
          event_type: "mirakl_unknown_transaction_type",
          severity: "warning",
          marketplace_code: marketplaceCode,
          details: {
            transaction_type: txn.transaction_type || txn.type,
            amount: txn.amount,
            payment_reference: payoutRef,
            marketplace: connection.marketplace_label,
            base_url: connection.base_url,
          },
        });
      }

      // ─── Item 1: Build settlement_lines row for each transaction ───
      lineRows.push({
        user_id: userId,
        settlement_id: "", // Will be set after we compute settlementId
        order_id: txn.order_id || txn.order_commercial_id || null,
        sku: null,
        amount: round2(amount),
        amount_description: type,
        transaction_type: txn.transaction_type || txn.type || "Unknown",
        amount_type: type,
        accounting_category: accountingCategory,
        marketplace_name: connection.marketplace_label || "Mirakl",
        posted_date: dateOnly || null,
      });
    }

    // ─── Rule 5: Do not save empty settlements ───
    const hasActivity =
      Math.abs(totals.sales_principal) > 0.001 ||
      Math.abs(totals.sales_shipping) > 0.001 ||
      Math.abs(totals.seller_fees) > 0.001 ||
      Math.abs(totals.refunds) > 0.001 ||
      Math.abs(totals.reimbursements) > 0.001 ||
      Math.abs(totals.other_fees) > 0.001 ||
      Math.abs(totals.bank_deposit) > 0.001;

    if (!hasActivity) {
      emptySkipped++;
      await adminClient.from("system_events").insert({
        user_id: userId,
        event_type: "mirakl_empty_settlement_skipped",
        severity: "info",
        marketplace_code: marketplaceCode,
        details: {
          payment_reference: payoutRef,
          transaction_count: txns.length,
          marketplace: connection.marketplace_label,
        },
      });
      continue;
    }

    // ─── Rule 3: Reconciliation check with tolerance ───
    const calculatedSum = round2(
      totals.sales_principal +
      totals.sales_shipping +
      totals.seller_fees +
      totals.refunds +
      totals.reimbursements +
      totals.other_fees +
      totals.gst_on_income +
      totals.gst_on_expenses,
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
          payment_reference: payoutRef,
          calculated_sum: calculatedSum,
          bank_deposit: totals.bank_deposit,
          difference: round2(reconDiff),
          marketplace: connection.marketplace_label,
        },
      });
    } else if (reconDiff >= 0.05) {
      await adminClient.from("system_events").insert({
        user_id: userId,
        event_type: "mirakl_reconciliation_rounding",
        severity: "info",
        marketplace_code: marketplaceCode,
        details: {
          payment_reference: payoutRef,
          difference: round2(reconDiff),
        },
      });
    }

    // ─── Item 4: Build settlement ID — date-bucketed for ungrouped ───
    let settlementId: string;
    if (payoutRef === "ungrouped") {
      // Use earliest transaction date, NOT today's date
      const earliestDate = periodStart || dateFrom;
      const dateBucket = earliestDate.replace(/-/g, "");
      settlementId = `mirakl-${marketplaceCode}-${dateBucket}`;
    } else {
      settlementId = `mirakl-${marketplaceCode}-${payoutRef}`;
    }

    // Set settlement_id on all line rows
    for (const row of lineRows) {
      row.settlement_id = settlementId;
    }

    // ─── Item 6: Boundary check — import always, mark pre_boundary if before boundary ───
    let isPreBoundary = false;
    const effectivePeriodEnd = periodEnd || new Date().toISOString().split("T")[0];
    if (accountingBoundary && effectivePeriodEnd < accountingBoundary) {
      isPreBoundary = true;
    }

    const settlementStatus = isPreBoundary
      ? "pre_boundary"
      : reconStatus === "recon_warning"
        ? "recon_warning"
        : "saved";

    // ─── Upsert settlement (NOT skip-if-exists) ───
    const settlementRow = {
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
    };

    const { error: upsertErr } = await adminClient.from("settlements").upsert(
      settlementRow,
      { onConflict: "user_id,settlement_id" },
    );

    if (upsertErr) {
      console.error(`[fetch-mirakl-settlements] Upsert failed for ${settlementId}:`, upsertErr);
      continue;
    }

    // ─── Item 1: Write settlement_lines (delete-then-insert for idempotency) ───
    try {
      // 1. Delete existing lines
      await adminClient
        .from("settlement_lines")
        .delete()
        .eq("user_id", userId)
        .eq("settlement_id", settlementId);

      // 2. Batch insert in chunks of 500
      for (let i = 0; i < lineRows.length; i += 500) {
        const chunk = lineRows.slice(i, i + 500);
        const { error: lineErr } = await adminClient
          .from("settlement_lines")
          .insert(chunk);
        if (lineErr) {
          console.error(`[fetch-mirakl-settlements] settlement_lines insert chunk failed:`, lineErr);
        }
      }
      console.log(`[fetch-mirakl-settlements] 📝 Wrote ${lineRows.length} settlement_lines for ${settlementId}`);
    } catch (lineWriteErr: any) {
      console.error(`[fetch-mirakl-settlements] settlement_lines write failed:`, lineWriteErr);
    }

    // ─── Item 3: Server-side source priority check ───
    try {
      await serverSideSourcePriority(
        adminClient, userId, marketplaceCode, periodStart || dateFrom, effectivePeriodEnd, settlementId,
      );
    } catch (spErr: any) {
      console.error(`[fetch-mirakl-settlements] Source priority check failed:`, spErr);
    }

    imported++;
  }

  return { imported, skipped, empty_skipped: emptySkipped };
}

// ═══════════════════════════════════════════════════════════════
// Item 3: Server-side source priority — mirakl_api self-suppresses
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
