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

const MIRAKL_TYPE_MAP: Record<string, { field: string; sign: 1 }> = {
  // ── Sales ──
  ORDER_AMOUNT:                                  { field: "sales_principal", sign: 1 },
  ORDER_AMOUNT_TAX:                              { field: "gst_on_income", sign: 1 },
  ORDER_SHIPPING_AMOUNT:                         { field: "sales_shipping", sign: 1 },
  ORDER_SHIPPING_AMOUNT_TAX:                     { field: "gst_on_income", sign: 1 },
  // ── Commissions / Fees ──
  COMMISSION_FEE:                                { field: "seller_fees", sign: 1 },
  COMMISSION_VAT:                                { field: "gst_on_expenses", sign: 1 },
  // ── Refunds (official Mirakl names: REFUND_ORDER_*) ──
  REFUND_ORDER_AMOUNT:                           { field: "refunds", sign: 1 },
  REFUND_ORDER_AMOUNT_TAX:                       { field: "gst_on_income", sign: 1 },
  REFUND_ORDER_SHIPPING_AMOUNT:                  { field: "refunds", sign: 1 },
  REFUND_ORDER_SHIPPING_AMOUNT_TAX:              { field: "gst_on_income", sign: 1 },
  REFUND_COMMISSION_FEE:                         { field: "seller_fees", sign: 1 },
  REFUND_COMMISSION_VAT:                         { field: "gst_on_expenses", sign: 1 },
  // ── Operator-remitted taxes (marketplace-collected GST) ──
  OPERATOR_REMITTED_ORDER_AMOUNT_TAX:            { field: "gst_on_income", sign: 1 },
  OPERATOR_REMITTED_ORDER_SHIPPING_AMOUNT_TAX:   { field: "gst_on_income", sign: 1 },
  OPERATOR_REMITTED_REFUND_ORDER_AMOUNT_TAX:     { field: "gst_on_income", sign: 1 },
  OPERATOR_REMITTED_REFUND_ORDER_SHIPPING_AMOUNT_TAX: { field: "gst_on_income", sign: 1 },
  // ── Operator-paid shipping ──
  OPERATOR_PAID_ORDER_SHIPPING_AMOUNT:           { field: "sales_shipping", sign: 1 },
  OPERATOR_PAID_ORDER_SHIPPING_AMOUNT_TAX:       { field: "gst_on_income", sign: 1 },
  OPERATOR_PAID_REFUND_ORDER_SHIPPING_AMOUNT:    { field: "refunds", sign: 1 },
  OPERATOR_PAID_REFUND_ORDER_SHIPPING_AMOUNT_TAX:{ field: "gst_on_income", sign: 1 },
  // ── Manual adjustments ──
  MANUAL_CREDIT:                                 { field: "reimbursements", sign: 1 },
  MANUAL_CREDIT_VAT:                             { field: "gst_on_expenses", sign: 1 },
  MANUAL_INVOICE:                                { field: "other_fees", sign: 1 },
  MANUAL_INVOICE_VAT:                            { field: "gst_on_expenses", sign: 1 },
  // ── Subscription ──
  SUBSCRIPTION_FEE:                              { field: "other_fees", sign: 1 },
  SUBSCRIPTION_VAT:                              { field: "gst_on_expenses", sign: 1 },
  // ── Seller fees ──
  SELLER_FEE_ON_ORDER:                           { field: "other_fees", sign: 1 },
  SELLER_FEE_ON_ORDER_TAX:                       { field: "gst_on_expenses", sign: 1 },
  SELLER_PENALTY_FEE:                            { field: "other_fees", sign: 1 },
  SELLER_PENALTY_FEE_TAX:                        { field: "gst_on_expenses", sign: 1 },
  // ── Order fees ──
  ORDER_FEE_AMOUNT:                              { field: "other_fees", sign: 1 },
  REFUND_ORDER_FEE_AMOUNT:                       { field: "other_fees", sign: 1 },
  OPERATOR_REMITTED_ORDER_FEE_AMOUNT:            { field: "other_fees", sign: 1 },
  OPERATOR_REMITTED_REFUND_ORDER_FEE_AMOUNT:     { field: "other_fees", sign: 1 },
  // ── Purchase commissions ──
  PURCHASE_COMMISSION_FEE:                       { field: "seller_fees", sign: 1 },
  PURCHASE_SHIPPING_COMMISSION_FEE:              { field: "seller_fees", sign: 1 },
  REFUND_PURCHASE_COMMISSION_FEE:                { field: "seller_fees", sign: 1 },
  REFUND_PURCHASE_SHIPPING_COMMISSION_FEE:       { field: "seller_fees", sign: 1 },
  // ── Purchase taxes ──
  PURCHASE_ORDER_AMOUNT_TAX:                     { field: "gst_on_income", sign: 1 },
  PURCHASE_ORDER_SHIPPING_AMOUNT_TAX:            { field: "gst_on_income", sign: 1 },
  REFUND_PURCHASE_ORDER_AMOUNT_TAX:              { field: "gst_on_income", sign: 1 },
  REFUND_PURCHASE_ORDER_SHIPPING_AMOUNT_TAX:     { field: "gst_on_income", sign: 1 },
  PURCHASE_FEE_COMMISSION_FEE:                   { field: "seller_fees", sign: 1 },
  REFUND_PURCHASE_FEE_COMMISSION_FEE:            { field: "seller_fees", sign: 1 },
  // ── Reserve ──
  RESERVE_FUNDING:                               { field: "other_fees", sign: 1 },
  RESERVE_SETTLEMENT:                            { field: "reimbursements", sign: 1 },
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

    const allResults: any[] = [];

    for (const connection of connections) {
      try {
        // Resolve auth header based on connection's auth_mode (oauth, api_key, or both)
        const authResult = await getMiraklAuthHeader(adminClient, connection);
        const result = await fetchSettlementsForConnection(
          adminClient, targetUserId, connection, authResult, body.sync_from,
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
    console.log(`[fetch-mirakl-settlements] ✅ Done — imported: ${totalImported}, skipped: ${totalSkipped}, empty: ${totalEmpty}`);

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
) {
  const baseUrl = connection.base_url.replace(/\/$/, "");
  const marketplaceCode = (connection.marketplace_label || "mirakl").toLowerCase().replace(/\s+/g, "_");

  // Default to 90 days if no sync_from
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 90);
  const dateFrom = syncFrom || defaultFrom.toISOString().split("T")[0];

  // Fetch transaction logs from Mirakl Marketplace API (TL endpoints)
  let apiUrl = `${baseUrl}/api/sellerpayment/transactions_logs?start_date=${dateFrom}T00:00:00Z&paginate=false`;

  // Include seller_company_id as shop param if available
  if (connection.seller_company_id) {
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

  // Group transactions by payment_reference (payout group)
  const groups = new Map<string, any[]>();
  for (const txn of transactions) {
    const key = txn.payment_reference || txn.payout_id || txn.accounting_document_number || "ungrouped";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(txn);
  }

  let imported = 0;
  let skipped = 0;
  let emptySkipped = 0;

  for (const [payoutRef, txns] of groups) {
    // ─── Accumulate into standard settlement fields (Rule 1: additive, coerce to Number) ───
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

    for (const txn of txns) {
      // Rule 1: Always coerce amount to Number
      const amount = Number(txn.amount) || 0;
      const type = (txn.transaction_type || txn.type || "").toUpperCase();

      // Track date range
      const txnDate = txn.date_created || txn.transaction_date || txn.created_date || "";
      if (txnDate) {
        const dateOnly = txnDate.split("T")[0];
        if (!periodStart || dateOnly < periodStart) periodStart = dateOnly;
        if (!periodEnd || dateOnly > periodEnd) periodEnd = dateOnly;
      }

      // Rule 2: Flexible payout type detection
      if (type.includes("PAYMENT") || type.includes("PAYOUT") || type.includes("TRANSFER")) {
        totals.bank_deposit += amount;
      } else if (MIRAKL_TYPE_MAP[type]) {
        const mapping = MIRAKL_TYPE_MAP[type];
        totals[mapping.field] += amount * mapping.sign;
      } else {
        // Rule 4: Unknown type logger
        totals.other_fees += amount;
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
      // Minor rounding — log info but proceed normally
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

    // Build settlement ID
    const settlementId = `mirakl-${marketplaceCode}-${payoutRef}`;

    // Check for duplicate
    const { data: existing } = await adminClient
      .from("settlements")
      .select("id")
      .eq("settlement_id", settlementId)
      .eq("user_id", userId)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    // Save settlement
    const { error: insertErr } = await adminClient.from("settlements").insert({
      user_id: userId,
      settlement_id: settlementId,
      marketplace: marketplaceCode,
      period_start: periodStart || dateFrom,
      period_end: periodEnd || new Date().toISOString().split("T")[0],
      bank_deposit: round2(totals.bank_deposit),
      sales_principal: round2(totals.sales_principal),
      sales_shipping: round2(totals.sales_shipping),
      seller_fees: round2(totals.seller_fees),
      refunds: round2(totals.refunds),
      reimbursements: round2(totals.reimbursements),
      other_fees: round2(totals.other_fees),
      gst_on_income: round2(totals.gst_on_income),
      gst_on_expenses: round2(totals.gst_on_expenses),
      status: reconStatus === "recon_warning" ? "recon_warning" : "saved",
      source: "mirakl_api",
      currency: "AUD",
    });

    if (insertErr) {
      console.error(`[fetch-mirakl-settlements] Insert failed for ${settlementId}:`, insertErr);
      continue;
    }

    imported++;
  }

  return { imported, skipped, empty_skipped: emptySkipped };
}
