import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader } from "../_shared/mirakl-token.ts";
// MIRAKL_MARKETPLACE_ENDPOINTS removed — using inline URL to match fetch-mirakl-settlements pattern

/**
 * verify-mirakl-settlement — Read-only diagnostic that fetches raw Mirakl
 * transaction logs and compares them against a stored Xettle settlement.
 *
 * POST body: { settlement_id: string }
 * Requires admin role.
 */

interface TxSummary {
  transaction_type: string;
  count: number;
  total_amount: number;
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
    const { userId } = await verifyRequest(req, { requireAdmin: true });
    const body = await req.json();
    const { settlement_id } = body;

    if (!settlement_id) {
      return new Response(
        JSON.stringify({ error: "Missing settlement_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── Step 0: Load settlement from DB ─────────────────────────
    const { data: settlement, error: settErr } = await adminClient
      .from("settlements")
      .select("*")
      .eq("settlement_id", settlement_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (settErr || !settlement) {
      return new Response(
        JSON.stringify({ error: "Settlement not found", detail: settErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── Step 1: Find Mirakl connection for this user ────────────
    const { data: miraklRows } = await adminClient
      .from("mirakl_tokens")
      .select("*")
      .eq("user_id", userId);

    if (!miraklRows || miraklRows.length === 0) {
      return new Response(
        JSON.stringify({ error: "No Mirakl connection found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pick the first connection (or match by marketplace label if possible)
    const miraklRow = miraklRows[0];

    // ─── Step 2: Extract doc number from settlement_id ───────────
    // BUN-2301-2026-03-14 → accounting_document_number = 2301
    const parts = settlement_id.split("-");
    const docNumber = parts.length >= 2 ? parts[1] : null;

    // Build date range from settlement period (with 1-day buffer)
    const dateFrom = settlement.period_start
      ? new Date(new Date(settlement.period_start).getTime() - 86400000).toISOString()
      : undefined;
    const dateTo = settlement.period_end
      ? new Date(new Date(settlement.period_end).getTime() + 86400000).toISOString()
      : undefined;

    // ─── Step 3: Fetch from Mirakl API ───────────────────────────
    let authResult;
    try {
      authResult = await getMiraklAuthHeader(adminClient, miraklRow);
    } catch (authErr: any) {
      console.error("[verify-mirakl] Auth failed:", authErr.message);
      return new Response(
        JSON.stringify({
          verdict: "api_error",
          settlement_id,
          error: "Mirakl connection expired or invalid — please reconnect in Settings",
          error_code: "AUTH_FAILED",
          detail: authErr.message,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const baseUrl = miraklRow.base_url.replace(/\/$/, "");

    // Use the same endpoint pattern as fetch-mirakl-settlements (which works)
    const params = new URLSearchParams();
    if (dateFrom) params.set("start_date", dateFrom);
    if (dateTo) params.set("end_date", dateTo);
    if (docNumber) params.set("accounting_document_number", docNumber);
    params.set("paginate", "false");

    // Include shop parameter if set (same as fetch-mirakl-settlements)
    if (miraklRow.seller_company_id && miraklRow.seller_company_id !== "default") {
      params.set("shop", miraklRow.seller_company_id);
    }

    const apiUrl = `${baseUrl}/api/sellerpayment/transactions_logs?${params.toString()}`;
    console.log(`[verify-mirakl] Fetching: ${apiUrl}`);
    console.log(`[verify-mirakl] Auth header: ${authResult.headerName}: ${authResult.headerValue.slice(0, 20)}...`);

    const authCandidates = [
      { headerName: authResult.headerName, headerValue: authResult.headerValue, label: "primary" },
    ];

    if ((miraklRow.auth_mode === "api_key" || miraklRow.auth_mode === "both") && miraklRow.api_key) {
      const fallbackCandidates = [
        { headerName: "Authorization", headerValue: miraklRow.api_key, label: "authorization" },
        { headerName: "Authorization", headerValue: `Bearer ${miraklRow.api_key}`, label: "authorization_bearer" },
        { headerName: "X-API-KEY", headerValue: miraklRow.api_key, label: "x_api_key" },
      ];

      for (const candidate of fallbackCandidates) {
        if (!authCandidates.some(existing => existing.headerName === candidate.headerName && existing.headerValue === candidate.headerValue)) {
          authCandidates.push(candidate);
        }
      }
    }

    let apiRes: Response | null = null;
    let authAttemptLabel = "primary";
    let last401Body = "";

    for (const candidate of authCandidates) {
      authAttemptLabel = candidate.label;
      console.log(`[verify-mirakl] Trying auth variant: ${candidate.label} (${candidate.headerName})`);
      apiRes = await fetch(apiUrl, {
        method: "GET",
        headers: {
          [candidate.headerName]: candidate.headerValue,
          Accept: "application/json",
        },
      });

      if (apiRes.status !== 401) {
        break;
      }

      last401Body = await apiRes.text().catch(() => "");
      console.warn(`[verify-mirakl] Auth variant failed with 401: ${candidate.label}`);
    }

    if (!apiRes) {
      throw new Error("Mirakl API request was not executed");
    }

    if (!apiRes.ok) {
      const errorText = apiRes.status === 401 ? last401Body : await apiRes.text().catch(() => "");
      return new Response(
        JSON.stringify({
          verdict: "api_error",
          settlement_id,
          error: `Mirakl API returned ${apiRes.status}`,
          detail: errorText.slice(0, 500),
          auth_attempt: authAttemptLabel,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiData = await apiRes.json();

    // Mirakl returns { transaction_logs: [...] } or { data: [...] }
    const transactions: any[] = apiData.transaction_logs || apiData.data || apiData.lines || [];

    // ─── Step 4: Summarize by transaction_type ───────────────────
    const typeSummary: Record<string, TxSummary> = {};
    for (const tx of transactions) {
      const txType = tx.type || tx.transaction_type || "UNKNOWN";
      const amount = parseFloat(tx.amount || tx.amount_credited || "0") -
                     parseFloat(tx.amount_debited || "0");
      if (!typeSummary[txType]) {
        typeSummary[txType] = { transaction_type: txType, count: 0, total_amount: 0 };
      }
      typeSummary[txType].count++;
      typeSummary[txType].total_amount = Math.round((typeSummary[txType].total_amount + amount) * 100) / 100;
    }

    const apiTransactions = Object.values(typeSummary);

    // ─── Step 5: Map API totals to settlement fields ─────────────
    const getTotal = (types: string[]): number =>
      apiTransactions
        .filter(t => types.includes(t.transaction_type))
        .reduce((sum, t) => sum + t.total_amount, 0);

    const apiSales = getTotal(["ORDER_AMOUNT"]);
    const apiShipping = getTotal(["ORDER_SHIPPING_AMOUNT"]);
    const apiFees = getTotal(["COMMISSION_FEE", "COMMISSION_VAT"]);
    const apiRefunds = getTotal([
      "REFUND_ORDER_AMOUNT", "REFUND_ORDER_AMOUNT_TAX",
      "REFUND_ORDER_SHIPPING_AMOUNT", "REFUND_ORDER_SHIPPING_AMOUNT_TAX",
      "REFUND_COMMISSION_FEE", "REFUND_COMMISSION_VAT",
    ]);
    const apiPayment = getTotal(["PAYMENT"]);
    const apiSalesTax = getTotal(["ORDER_AMOUNT_TAX", "ORDER_SHIPPING_AMOUNT_TAX"]);

    // Stored settlement values
    const stored = {
      sales: (settlement.sales_principal || 0) + (settlement.sales_shipping || 0),
      sales_principal: settlement.sales_principal || 0,
      sales_shipping: settlement.sales_shipping || 0,
      fees: settlement.seller_fees || 0,
      refunds: settlement.refunds || 0,
      bank_deposit: settlement.bank_deposit || 0,
      reimbursements: settlement.reimbursements || 0,
      other_fees: settlement.other_fees || 0,
      gst_on_income: settlement.gst_on_income || 0,
    };

    // ─── Step 6: Build discrepancies ─────────────────────────────
    const discrepancies: Array<{
      field: string;
      stored_value: number;
      api_value: number;
      difference: number;
    }> = [];

    const compare = (field: string, storedVal: number, apiVal: number) => {
      const diff = Math.round((apiVal - storedVal) * 100) / 100;
      if (Math.abs(diff) > 0.01) {
        discrepancies.push({ field, stored_value: storedVal, api_value: apiVal, difference: diff });
      }
    };

    compare("sales_principal", stored.sales_principal, apiSales);
    compare("sales_shipping", stored.sales_shipping, apiShipping);
    compare("seller_fees", stored.fees, apiFees);
    compare("refunds", stored.refunds, apiRefunds);
    compare("bank_deposit", stored.bank_deposit, apiPayment);
    compare("gst_on_income", stored.gst_on_income, apiSalesTax);

    // ─── Step 7: Find missing transaction types ──────────────────
    const knownTypes = new Set([
      "ORDER_AMOUNT", "ORDER_AMOUNT_TAX",
      "ORDER_SHIPPING_AMOUNT", "ORDER_SHIPPING_AMOUNT_TAX",
      "COMMISSION_FEE", "COMMISSION_VAT",
      "REFUND_ORDER_AMOUNT", "REFUND_ORDER_AMOUNT_TAX",
      "REFUND_ORDER_SHIPPING_AMOUNT", "REFUND_ORDER_SHIPPING_AMOUNT_TAX",
      "REFUND_COMMISSION_FEE", "REFUND_COMMISSION_VAT",
      "PAYMENT",
    ]);

    const missingTransactionTypes = apiTransactions
      .filter(t => !knownTypes.has(t.transaction_type) && Math.abs(t.total_amount) > 0.01)
      .map(t => ({
        transaction_type: t.transaction_type,
        count: t.count,
        total_amount: t.total_amount,
      }));

    // ─── Step 8: Verdict ─────────────────────────────────────────
    let verdict: "match" | "discrepancy" | "api_error" | "no_data" = "match";
    if (transactions.length === 0) {
      verdict = "no_data";
    } else if (discrepancies.length > 0 || missingTransactionTypes.length > 0) {
      verdict = "discrepancy";
    }

    return new Response(
      JSON.stringify({
        settlement_id,
        verdict,
        transaction_count: transactions.length,
        api_transactions: apiTransactions,
        api_totals: {
          sales: apiSales,
          shipping: apiShipping,
          fees: apiFees,
          refunds: apiRefunds,
          payment: apiPayment,
          sales_tax: apiSalesTax,
        },
        stored_settlement: stored,
        discrepancies,
        missing_transaction_types: missingTransactionTypes,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[verify-mirakl] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message, verdict: "api_error" }),
      {
        status: err.message?.includes("Forbidden") ? 403 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
