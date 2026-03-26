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

    // Log mirakl_fetch_complete event for Data Integrity scanner freshness tracking
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
// CORE FETCH + MAP LOGIC — IV01 PRIMARY, TL05 LINE-ITEM FALLBACK
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

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Fetch billing cycles via IV01 (Accounting Documents)
  // This is the AUTHORITATIVE source for payout amounts
  // ═══════════════════════════════════════════════════════════════

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

  if (!iv01Res.ok) {
    const errorText = await iv01Res.text().catch(() => "");
    console.error(`[fetch-mirakl-settlements] ❌ IV01 API error ${iv01Res.status}: ${errorText.slice(0, 500)}`);

    // If IV01 fails, fall back to TL05 legacy path
    console.log(`[fetch-mirakl-settlements] ⚠️ IV01 failed — falling back to TL05 transaction logs`);
    return await fetchSettlementsViaTL05(adminClient, userId, connection, authResult, dateFrom, accountingBoundary);
  }

  const iv01Data = await iv01Res.json();
  const invoices = iv01Data.invoices || iv01Data.data || [];

  console.log(`[fetch-mirakl-settlements] 📦 IV01 response keys: ${Object.keys(iv01Data).join(", ")}`);
  console.log(`[fetch-mirakl-settlements] 📦 IV01 invoices count: ${Array.isArray(invoices) ? invoices.length : "not an array"}`);

  if (Array.isArray(invoices) && invoices.length > 0) {
    console.log(`[fetch-mirakl-settlements] 📦 IV01 invoice[0] keys: ${Object.keys(invoices[0]).join(", ")}`);
    console.log(`[fetch-mirakl-settlements] 📦 IV01 invoice[0] sample: ${JSON.stringify(invoices[0]).slice(0, 500)}`);
  }

  if (!Array.isArray(invoices) || invoices.length === 0) {
    console.log(`[fetch-mirakl-settlements] ⚠️ IV01 returned no invoices — falling back to TL05`);
    return await fetchSettlementsViaTL05(adminClient, userId, connection, authResult, dateFrom, accountingBoundary);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Process each billing cycle invoice
  // ═══════════════════════════════════════════════════════════════

  let imported = 0;
  let skipped = 0;
  let emptySkipped = 0;

  for (const invoice of invoices) {
    try {
      // Extract billing cycle number — the canonical identifier
      const cycleNumber = invoice.accounting_document_number
        || invoice.invoice_id
        || invoice.id
        || null;

      if (!cycleNumber) {
        console.warn(`[fetch-mirakl-settlements] ⚠️ Invoice missing cycle number, skipping`);
        skipped++;
        continue;
      }

      // Extract authoritative payout amount from IV01
      // Bunnings IV01 actual fields: total_charged_amount, total_amount_excl_taxes,
      // total_amount_incl_taxes, total_taxes, payment (nested), summary (nested)
      const rawPayoutField =
        invoice.total_charged_amount ??
        invoice.amount_due_to_seller ??
        invoice.total_amount_due_to_seller ??
        invoice.seller_amount ??
        invoice.total_amount_incl_taxes ??
        invoice.net_amount ??
        invoice.amount_transferred ??
        invoice.total_amount ??
        invoice.amount ??
        // Check nested payment object
        (invoice.payment && typeof invoice.payment === "object" ? invoice.payment.amount : null) ??
        null;
      const bankDeposit = rawPayoutField !== null ? parseFloat(String(rawPayoutField)) : NaN;

      if (isNaN(bankDeposit)) {
        console.warn(`[fetch-mirakl-settlements] ⚠️ Invoice ${cycleNumber} has no parseable payout amount — skipping`);
        // Log the FULL invoice for diagnostics so we can see nested field values
        await adminClient.from("system_events").insert({
          user_id: userId,
          event_type: "mirakl_iv01_no_payout_amount",
          severity: "warning",
          marketplace_code: marketplaceCode,
          details: {
            cycle_number: cycleNumber,
            invoice_keys: Object.keys(invoice),
            marketplace: connection.marketplace_label,
            invoice_sample: JSON.stringify(invoice).slice(0, 2000),
          },
        });
        skipped++;
        continue;
      }

      // Zero-guard: skip zero-amount invoices
      if (Math.abs(bankDeposit) < 0.01) {
        emptySkipped++;
        continue;
      }

      // Extract dates — Bunnings uses start_time/end_time, not start_date/end_date
      const periodStart = invoice.start_time?.split("T")[0]
        || invoice.start_date?.split("T")[0]
        || invoice.date_created?.split("T")[0]
        || dateFrom;
      const periodEnd = invoice.end_time?.split("T")[0]
        || invoice.end_date?.split("T")[0]
        || invoice.due_date?.split("T")[0]
        || invoice.issue_date?.split("T")[0]
        || new Date().toISOString().split("T")[0];

      // Extract component amounts — use actual Bunnings IV01 field names
      const totalSales = parseFloat(String(
        invoice.total_amount_excl_taxes ??
        invoice.total_amount_excluding_taxes ??
        invoice.total_order_amount ?? 0
      )) || 0;
      const totalCommission = parseFloat(String(
        invoice.total_commission ??
        invoice.commission_amount ??
        invoice.operator_amount ?? 0
      )) || 0;
      const totalTax = parseFloat(String(
        invoice.total_taxes ??
        invoice.total_tax ??
        invoice.tax_amount ?? 0
      )) || 0;
      const totalRefunds = parseFloat(String(
        invoice.total_refund_amount ??
        invoice.refund_amount ?? 0
      )) || 0;

      // Build settlement ID matching the CSV convention
      const settlementId = `BUN-${cycleNumber}-${periodEnd}`;

      console.log(`[fetch-mirakl-settlements] 📊 IV01 cycle ${cycleNumber}: bank_deposit=${bankDeposit}, period=${periodStart}→${periodEnd}`);

      // ─── Boundary check ───
      let isPreBoundary = false;
      if (accountingBoundary && periodEnd < accountingBoundary) {
        isPreBoundary = true;
      }

      // ─── Reconciliation check ───
      // With IV01 the payout IS the authoritative amount, so recon is always clean
      // unless we fetched component amounts that don't add up
      const calculatedComponents = round2(totalSales + totalCommission + totalTax + totalRefunds);
      const hasComponents = Math.abs(totalSales) > 0.01 || Math.abs(totalCommission) > 0.01;
      const reconDiff = hasComponents ? Math.abs(calculatedComponents - bankDeposit) : 0;
      const reconStatus = reconDiff >= 1.0 ? "recon_warning" : "reconciled";

      if (reconDiff >= 1.0) {
        await adminClient.from("system_events").insert({
          user_id: userId,
          event_type: "mirakl_reconciliation_mismatch",
          severity: "warning",
          marketplace_code: marketplaceCode,
          details: {
            cycle_number: cycleNumber,
            calculated_components: calculatedComponents,
            bank_deposit: bankDeposit,
            difference: round2(reconDiff),
            marketplace: connection.marketplace_label,
            source: "iv01",
          },
        });
      }

      const settlementStatus = isPreBoundary
        ? "pre_boundary"
        : reconStatus === "recon_warning" ? "recon_warning" : "saved";

      // ─── Upsert settlement ───
      const settlementRow = {
        user_id: userId,
        settlement_id: settlementId,
        marketplace: marketplaceCode,
        period_start: periodStart,
        period_end: periodEnd,
        bank_deposit: round2(bankDeposit),
        sales_principal: round2(totalSales),
        sales_shipping: 0,
        seller_fees: round2(totalCommission),
        refunds: round2(totalRefunds),
        reimbursements: 0,
        other_fees: 0,
        gst_on_income: round2(totalTax > 0 ? totalTax : 0),
        gst_on_expenses: 0,
        status: settlementStatus,
        source: "mirakl_api",
        is_pre_boundary: isPreBoundary,
        raw_payload: invoice,
      };

      const { error: upsertErr } = await adminClient.from("settlements").upsert(
        settlementRow,
        { onConflict: "user_id,settlement_id" },
      );

      if (upsertErr) {
        console.error(`[fetch-mirakl-settlements] Upsert failed for ${settlementId}:`, upsertErr);
        continue;
      }

      // ═══════════════════════════════════════════════════════════════
      // STEP 3: Optionally fetch TL05 transaction lines for this cycle
      // ═══════════════════════════════════════════════════════════════
      try {
        await fetchAndStoreTL05Lines(
          adminClient, userId, connection, authResult, baseUrl,
          marketplaceCode, settlementId, cycleNumber, periodStart, periodEnd,
        );
      } catch (lineErr: any) {
        console.error(`[fetch-mirakl-settlements] TL05 line fetch failed for ${settlementId}:`, lineErr.message);
      }

      // ─── Source priority check ───
      try {
        await serverSideSourcePriority(
          adminClient, userId, marketplaceCode, periodStart, periodEnd, settlementId,
        );
      } catch (spErr: any) {
        console.error(`[fetch-mirakl-settlements] Source priority check failed:`, spErr);
      }

      // ─── CSV mismatch detection ───
      try {
        await detectAndCorrectCsvMismatch(
          adminClient, userId, marketplaceCode,
          periodStart, periodEnd,
          round2(bankDeposit), settlementId,
        );
      } catch (mcErr: any) {
        console.error(`[fetch-mirakl-settlements] CSV mismatch check failed:`, mcErr);
      }

      imported++;
    } catch (invoiceErr: any) {
      console.error(`[fetch-mirakl-settlements] Error processing invoice:`, invoiceErr);
      skipped++;
    }
  }

  return { imported, skipped, empty_skipped: emptySkipped, source: "iv01" };
}

// ═══════════════════════════════════════════════════════════════
// TL05 LINE-ITEM FETCHER — fetches transaction-level detail
// for a specific billing cycle and stores as settlement_lines
// ═══════════════════════════════════════════════════════════════

async function fetchAndStoreTL05Lines(
  adminClient: any,
  userId: string,
  connection: any,
  authResult: { headerName: string; headerValue: string },
  baseUrl: string,
  marketplaceCode: string,
  settlementId: string,
  cycleNumber: string,
  periodStart: string,
  periodEnd: string,
) {
  // Fetch TL05 transactions for the date range of this billing cycle
  const tl05Url = `${baseUrl}/api/sellerpayment/transactions_logs?${new URLSearchParams({
    start_date: `${periodStart}T00:00:00Z`,
    end_date: `${periodEnd}T23:59:59Z`,
    paginate: "false",
  })}`;

  if (connection.seller_company_id && connection.seller_company_id !== "default") {
    // Add shop filter if available
  }

  console.log(`[fetch-mirakl-settlements] 📝 TL05 line fetch: ${tl05Url}`);

  const res = await fetch(tl05Url, {
    headers: {
      [authResult.headerName]: authResult.headerValue,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.warn(`[fetch-mirakl-settlements] TL05 returned ${res.status} — skipping line items`);
    return;
  }

  const data = await res.json();
  const transactions = data.transactions || data.transaction_logs || data.data || [];

  if (!Array.isArray(transactions) || transactions.length === 0) {
    console.log(`[fetch-mirakl-settlements] TL05 returned 0 transactions for ${settlementId}`);
    return;
  }

  console.log(`[fetch-mirakl-settlements] 📝 TL05 returned ${transactions.length} lines for ${settlementId}`);

  const lineRows: any[] = [];
  for (const txn of transactions) {
    const amount = Number(txn.amount) || 0;
    const type = (txn.transaction_type || txn.type || "").toUpperCase();
    const txnDate = txn.date_created || txn.transaction_date || txn.created_date || "";
    const dateOnly = txnDate ? txnDate.split("T")[0] : "";

    let accountingCategory = "adjustment";
    if (MIRAKL_TYPE_MAP[type]) {
      accountingCategory = MIRAKL_TYPE_MAP[type].accountingCategory;
    }

    lineRows.push({
      user_id: userId,
      settlement_id: settlementId,
      order_id: txn.order_id || txn.order_commercial_id || null,
      sku: null,
      amount: round2(amount),
      amount_description: type,
      transaction_type: txn.transaction_type || txn.type || "Unknown",
      amount_type: type,
      accounting_category: accountingCategory,
      marketplace_name: connection.marketplace_label || "Mirakl",
      posted_date: dateOnly || null,
      source: "mirakl_api",
    });
  }

  // Delete-then-insert for idempotency
  await adminClient
    .from("settlement_lines")
    .delete()
    .eq("user_id", userId)
    .eq("settlement_id", settlementId);

  for (let i = 0; i < lineRows.length; i += 500) {
    const chunk = lineRows.slice(i, i + 500);
    const { error: lineErr } = await adminClient.from("settlement_lines").insert(chunk);
    if (lineErr) {
      console.error(`[fetch-mirakl-settlements] settlement_lines insert failed:`, lineErr);
    }
  }
  console.log(`[fetch-mirakl-settlements] 📝 Wrote ${lineRows.length} settlement_lines for ${settlementId}`);
}

// ═══════════════════════════════════════════════════════════════
// TL05 LEGACY FALLBACK — used only if IV01 endpoint fails
// This is the original transaction-logs-based fetch path
// ═══════════════════════════════════════════════════════════════

async function fetchSettlementsViaTL05(
  adminClient: any,
  userId: string,
  connection: any,
  authResult: { headerName: string; headerValue: string },
  dateFrom: string,
  accountingBoundary?: string | null,
) {
  const baseUrl = connection.base_url.replace(/\/$/, "");
  const marketplaceCode = (connection.marketplace_label || "mirakl").toLowerCase().replace(/\s+/g, "_");

  let apiUrl = `${baseUrl}/api/sellerpayment/transactions_logs?start_date=${dateFrom}T00:00:00Z&paginate=false`;

  if (connection.seller_company_id && connection.seller_company_id !== "default") {
    apiUrl += `&shop=${connection.seller_company_id}`;
  }

  console.log(`[fetch-mirakl-settlements] 🌐 TL05 FALLBACK URL: ${apiUrl}`);

  const res = await fetch(apiUrl, {
    headers: {
      [authResult.headerName]: authResult.headerValue,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Mirakl TL05 API error ${res.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await res.json();
  const transactions = data.transactions || data.transaction_logs || data.data || [];

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return { imported: 0, skipped: 0, empty_skipped: 0, message: "No transactions found (TL05 fallback)", source: "tl05_fallback" };
  }

  // Group by payment_reference
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
    const totals: Record<string, number> = {
      sales_principal: 0, sales_shipping: 0, seller_fees: 0, refunds: 0,
      reimbursements: 0, other_fees: 0, gst_on_income: 0, gst_on_expenses: 0, bank_deposit: 0,
    };

    let periodStart = "";
    let periodEnd = "";
    const lineRows: any[] = [];

    for (const txn of txns) {
      const amount = Number(txn.amount) || 0;
      const type = (txn.transaction_type || txn.type || "").toUpperCase();
      const txnDate = txn.date_created || txn.transaction_date || txn.created_date || "";
      const dateOnly = txnDate ? txnDate.split("T")[0] : "";
      if (dateOnly) {
        if (!periodStart || dateOnly < periodStart) periodStart = dateOnly;
        if (!periodEnd || dateOnly > periodEnd) periodEnd = dateOnly;
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
        settlement_id: "",
        order_id: txn.order_id || txn.order_commercial_id || null,
        sku: null,
        amount: round2(amount),
        amount_description: type,
        transaction_type: txn.transaction_type || txn.type || "Unknown",
        amount_type: type,
        accounting_category: accountingCategory,
        marketplace_name: connection.marketplace_label || "Mirakl",
        posted_date: dateOnly || null,
        source: "mirakl_api",
      });
    }

    const hasActivity = Object.values(totals).some(v => Math.abs(v) > 0.001);
    if (!hasActivity) { emptySkipped++; continue; }

    let settlementId: string;
    if (payoutRef === "ungrouped") {
      const dateBucket = (periodStart || dateFrom).replace(/-/g, "");
      settlementId = `mirakl-${marketplaceCode}-${dateBucket}`;
    } else {
      settlementId = `mirakl-${marketplaceCode}-${payoutRef}`;
    }

    for (const row of lineRows) { row.settlement_id = settlementId; }

    let isPreBoundary = false;
    const effectivePeriodEnd = periodEnd || new Date().toISOString().split("T")[0];
    if (accountingBoundary && effectivePeriodEnd < accountingBoundary) {
      isPreBoundary = true;
    }

    const calculatedSum = round2(
      totals.sales_principal + totals.sales_shipping + totals.seller_fees + totals.refunds +
      totals.reimbursements + totals.other_fees + totals.gst_on_income + totals.gst_on_expenses,
    );
    const reconDiff = Math.abs(calculatedSum - totals.bank_deposit);
    const reconStatus = reconDiff >= 1.0 ? "recon_warning" : "reconciled";

    const settlementStatus = isPreBoundary ? "pre_boundary"
      : reconStatus === "recon_warning" ? "recon_warning" : "saved";

    const { error: upsertErr } = await adminClient.from("settlements").upsert({
      user_id: userId, settlement_id: settlementId, marketplace: marketplaceCode,
      period_start: periodStart || dateFrom, period_end: effectivePeriodEnd,
      bank_deposit: round2(totals.bank_deposit), sales_principal: round2(totals.sales_principal),
      sales_shipping: round2(totals.sales_shipping), seller_fees: round2(totals.seller_fees),
      refunds: round2(totals.refunds), reimbursements: round2(totals.reimbursements),
      other_fees: round2(totals.other_fees), gst_on_income: round2(totals.gst_on_income),
      gst_on_expenses: round2(totals.gst_on_expenses), status: settlementStatus,
      source: "mirakl_api", is_pre_boundary: isPreBoundary,
    }, { onConflict: "user_id,settlement_id" });

    if (upsertErr) { console.error(`[fetch-mirakl-settlements] TL05 upsert failed:`, upsertErr); continue; }

    // Write lines
    try {
      await adminClient.from("settlement_lines").delete().eq("user_id", userId).eq("settlement_id", settlementId);
      for (let i = 0; i < lineRows.length; i += 500) {
        await adminClient.from("settlement_lines").insert(lineRows.slice(i, i + 500));
      }
    } catch (e: any) { console.error(`[fetch-mirakl-settlements] TL05 lines failed:`, e); }

    try {
      await serverSideSourcePriority(adminClient, userId, marketplaceCode, periodStart || dateFrom, effectivePeriodEnd, settlementId);
    } catch (e: any) { /* ignore */ }

    try {
      await detectAndCorrectCsvMismatch(adminClient, userId, marketplaceCode, periodStart || dateFrom, effectivePeriodEnd, round2(totals.bank_deposit), settlementId);
    } catch (e: any) { /* ignore */ }

    imported++;
  }

  return { imported, skipped, empty_skipped: emptySkipped, source: "tl05_fallback" };
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
  // Find CSV-uploaded settlements covering the same period
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
    if (discrepancy <= 1.0) continue; // Within tolerance

    const isPushed = ["pushed_to_xero", "already_recorded"].includes(csv.status);

    // Always log the mismatch
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

    // Auto-correct only if not yet pushed to Xero
    if (!isPushed) {
      await adminClient
        .from("settlements")
        .update({
          bank_deposit: apiBankDeposit,
          sync_origin: "api_corrected",
        })
        .eq("id", csv.id);

      console.log(
        `[fetch-mirakl-settlements] ✅ Auto-corrected ${csv.settlement_id} bank_deposit: ${csv.bank_deposit} → ${apiBankDeposit}`,
      );
    } else {
      console.log(
        `[fetch-mirakl-settlements] ⚠️ Mismatch flagged for ${csv.settlement_id} (pushed): stored=${csv.bank_deposit}, api=${apiBankDeposit}`,
      );
    }
  }
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
