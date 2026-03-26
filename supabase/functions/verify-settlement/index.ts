import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader } from "../_shared/mirakl-token.ts";

/**
 * verify-settlement — Universal API verification for ANY marketplace.
 *
 * Routes to the correct verification path based on marketplace type:
 *   - Mirakl (Bunnings, Catch, MyDeal, etc.)
 *   - eBay (Sell Finances API)
 *   - Amazon (SP-API settlement reports)
 *   - No API connection → returns { verdict: "no_api_connection" }
 *
 * POST body: { settlement_id: string }
 * Requires admin role.
 */

interface TxSummary {
  transaction_type: string;
  count: number;
  total_amount: number;
}

interface StandardResponse {
  settlement_id: string;
  marketplace: string;
  source: string;
  verdict: "match" | "discrepancy" | "no_data" | "api_error" | "no_api_connection";
  filter_method: string;
  transaction_count: number;
  api_transactions: TxSummary[];
  api_totals: {
    sales: number;
    shipping: number;
    fees: number;
    refunds: number;
    payment: number;
    sales_tax: number;
  };
  stored_settlement: Record<string, number>;
  discrepancies: Array<{ field: string; stored_value: number; api_value: number; difference: number }>;
  missing_transaction_types: Array<{ transaction_type: string; count: number; total_amount: number }>;
  error?: string;
  detail?: string;
}

// ── Marketplace detection helpers ──

const MIRAKL_MARKETPLACES = ["bunnings", "catch", "mydeal", "kogan_mirakl"];

function isMiraklMarketplace(marketplace: string): boolean {
  const lower = marketplace.toLowerCase();
  return MIRAKL_MARKETPLACES.some(m => lower.includes(m)) || lower.includes("mirakl");
}

function isEbayMarketplace(marketplace: string): boolean {
  return marketplace.toLowerCase().includes("ebay");
}

function isAmazonMarketplace(marketplace: string): boolean {
  return marketplace.toLowerCase().includes("amazon");
}

// ── Shared helpers ──

function buildStoredValues(settlement: any): Record<string, number> {
  return {
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
}

function buildDiscrepancies(
  stored: Record<string, number>,
  comparisons: Array<[string, number, number]>,
): StandardResponse["discrepancies"] {
  const discrepancies: StandardResponse["discrepancies"] = [];
  for (const [field, storedVal, apiVal] of comparisons) {
    const diff = Math.round((apiVal - storedVal) * 100) / 100;
    if (Math.abs(diff) > 0.01) {
      discrepancies.push({ field, stored_value: storedVal, api_value: apiVal, difference: diff });
    }
  }
  return discrepancies;
}

// ── Mirakl verification path ──

async function verifyMirakl(
  adminClient: any,
  settlement: any,
  userId: string,
): Promise<StandardResponse> {
  const stored = buildStoredValues(settlement);
  const settlementId = settlement.settlement_id;
  const source = settlement.source || "csv_upload";

  // Find Mirakl connection
  const { data: miraklRows } = await adminClient
    .from("mirakl_tokens")
    .select("*")
    .eq("user_id", userId);

  if (!miraklRows || miraklRows.length === 0) {
    return {
      settlement_id: settlementId,
      marketplace: settlement.marketplace,
      source,
      verdict: "no_api_connection",
      filter_method: "none",
      transaction_count: 0,
      api_transactions: [],
      api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
      stored_settlement: stored,
      discrepancies: [],
      missing_transaction_types: [],
      error: "No Mirakl API connection found. Connect in Settings > API Connections.",
    };
  }

  // FIX 4: Marketplace-aware Mirakl token matching
  const miraklRow = miraklRows.find(r => {
    const label = (r.marketplace_label ?? '').toLowerCase();
    const mkt = (settlement.marketplace ?? '').toLowerCase();
    return mkt.includes(label) || label.includes(mkt);
  }) ?? miraklRows[0];
  console.log(`[verify-settlement] Matched Mirakl token: label=${miraklRow.marketplace_label}, base_url=${miraklRow.base_url}`);

  // Auth
  let authResult;
  try {
    authResult = await getMiraklAuthHeader(adminClient, miraklRow);
  } catch (authErr: any) {
    console.error("[verify-settlement] Mirakl auth failed:", authErr.message);
    return {
      settlement_id: settlementId,
      marketplace: settlement.marketplace,
      source,
      verdict: "api_error",
      filter_method: "none",
      transaction_count: 0,
      api_transactions: [],
      api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
      stored_settlement: stored,
      discrepancies: [],
      missing_transaction_types: [],
      error: "Mirakl connection expired or invalid — please reconnect in Settings",
      detail: authErr.message,
    };
  }

  // Build date range with 1-day buffer
  const dateFrom = settlement.period_start
    ? new Date(`${settlement.period_start}T00:00:00.000Z`)
    : null;
  if (dateFrom) dateFrom.setUTCDate(dateFrom.getUTCDate() - 1);

  const dateTo = settlement.period_end
    ? new Date(`${settlement.period_end}T23:59:59.999Z`)
    : null;
  if (dateTo) dateTo.setUTCDate(dateTo.getUTCDate() + 1);

  const baseUrl = miraklRow.base_url.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (dateFrom) params.set("start_date", dateFrom.toISOString());
  params.set("paginate", "false");
  if (miraklRow.seller_company_id && miraklRow.seller_company_id !== "default") {
    params.set("shop", miraklRow.seller_company_id);
  }

  const apiUrl = `${baseUrl}/api/sellerpayment/transactions_logs?${params.toString()}`;
  console.log(`[verify-settlement] Mirakl fetch: ${apiUrl}`);

  // Auth fallback candidates
  const authCandidates = [
    { headerName: authResult.headerName, headerValue: authResult.headerValue, label: "primary" },
  ];
  if ((miraklRow.auth_mode === "api_key" || miraklRow.auth_mode === "both") && miraklRow.api_key) {
    const fallbacks = [
      { headerName: "Authorization", headerValue: miraklRow.api_key, label: "authorization" },
      { headerName: "Authorization", headerValue: `Bearer ${miraklRow.api_key}`, label: "authorization_bearer" },
      { headerName: "X-API-KEY", headerValue: miraklRow.api_key, label: "x_api_key" },
    ];
    for (const c of fallbacks) {
      if (!authCandidates.some(e => e.headerName === c.headerName && e.headerValue === c.headerValue)) {
        authCandidates.push(c);
      }
    }
  }

  let apiRes: Response | null = null;
  let last401Body = "";
  for (const candidate of authCandidates) {
    console.log(`[verify-settlement] Trying auth: ${candidate.label}`);
    apiRes = await fetch(apiUrl, {
      method: "GET",
      headers: { [candidate.headerName]: candidate.headerValue, Accept: "application/json" },
    });
    if (apiRes.status !== 401) break;
    last401Body = await apiRes.text().catch(() => "");
    console.warn(`[verify-settlement] 401 with ${candidate.label}`);
  }

  if (!apiRes || !apiRes.ok) {
    const errorText = apiRes?.status === 401 ? last401Body : await apiRes?.text().catch(() => "") || "";
    return {
      settlement_id: settlementId,
      marketplace: settlement.marketplace,
      source,
      verdict: "api_error",
      filter_method: "none",
      transaction_count: 0,
      api_transactions: [],
      api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
      stored_settlement: stored,
      discrepancies: [],
      missing_transaction_types: [],
      error: `Mirakl API returned ${apiRes?.status || "no response"}`,
      detail: errorText.slice(0, 500),
    };
  }

  const apiData = await apiRes.json();
  const rawTransactions: any[] = apiData.transactions || apiData.transaction_logs || apiData.data || apiData.lines || [];

  // ── FILTER LOGIC — source-aware ──
  // For csv_upload/manual: date range only (no doc number matching — these have no Mirakl-native ref)
  // For mirakl_api: match by payout reference from raw_payload or settlement_id pattern
  const useDateRangeOnly = source === "csv_upload" || source === "manual";

  let payoutRef: string | null = null;
  if (!useDateRangeOnly) {
    // Extract payout reference from raw_payload or settlement_id
    const rawPayload = settlement.raw_payload && typeof settlement.raw_payload === "object"
      ? settlement.raw_payload : null;
    payoutRef = rawPayload?.payment_reference
      || rawPayload?.accounting_document_number
      || rawPayload?.payout_id
      || null;

    // Fallback: extract from mirakl-{marketplace}-{ref} pattern
    if (!payoutRef) {
      const match = String(settlementId).match(/^mirakl-[^-]+-(.+)$/i);
      if (match) payoutRef = match[1];
    }
  }

  const filterMethod = useDateRangeOnly ? "date_range_only" : (payoutRef ? "payout_reference" : "date_range_only");
  console.log(`[verify-settlement] Filter: ${filterMethod}, payoutRef=${payoutRef ?? "none"}, source=${source}, raw txns: ${rawTransactions.length}`);

  // Log sample transaction references for diagnostics
  if (rawTransactions.length > 0) {
    const sample = rawTransactions[0];
    console.log(`[verify-settlement] Sample tx refs: accounting_document_number=${sample.accounting_document_number}, payment_reference=${sample.payment_reference}, payout_id=${sample.payout_id}`);
  }

  const transactions = rawTransactions.filter((tx: any) => {
    const txDateRaw = tx.date_created || tx.date || tx.creation_date || tx.accounting_document_creation_date || null;
    const txDate = txDateRaw ? new Date(txDateRaw) : null;
    const inRange = !txDate || ((!dateFrom || txDate >= dateFrom) && (!dateTo || txDate <= dateTo));

    if (!inRange) return false;

    if (filterMethod === "date_range_only") {
      return true;
    }

    // Match by payout reference
    const txDocNumber = String(
      tx.accounting_document_number || tx.payment_voucher || tx.payment_reference || tx.payout_id || ""
    ).trim();
    return payoutRef ? txDocNumber === payoutRef : true;
  });

  console.log(`[verify-settlement] Filtered: ${transactions.length}/${rawTransactions.length}`);

  // Summarize by transaction type
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

  const getTotal = (types: string[]): number =>
    apiTransactions.filter(t => types.includes(t.transaction_type)).reduce((s, t) => s + t.total_amount, 0);

  const apiTotals = {
    sales: getTotal(["ORDER_AMOUNT"]),
    shipping: getTotal(["ORDER_SHIPPING_AMOUNT"]),
    fees: getTotal(["COMMISSION_FEE", "COMMISSION_VAT"]),
    refunds: getTotal([
      "REFUND_ORDER_AMOUNT", "REFUND_ORDER_AMOUNT_TAX",
      "REFUND_ORDER_SHIPPING_AMOUNT", "REFUND_ORDER_SHIPPING_AMOUNT_TAX",
      "REFUND_COMMISSION_FEE", "REFUND_COMMISSION_VAT",
    ]),
    payment: getTotal(["PAYMENT"]),
    sales_tax: getTotal(["ORDER_AMOUNT_TAX", "ORDER_SHIPPING_AMOUNT_TAX"]),
  };

  const discrepancies = buildDiscrepancies(stored, [
    ["sales_principal", stored.sales_principal, apiTotals.sales],
    ["sales_shipping", stored.sales_shipping, apiTotals.shipping],
    ["seller_fees", stored.fees, apiTotals.fees],
    ["refunds", stored.refunds, apiTotals.refunds],
    ["bank_deposit", stored.bank_deposit, apiTotals.payment],
    ["gst_on_income", stored.gst_on_income, apiTotals.sales_tax],
  ]);

  const knownTypes = new Set([
    "ORDER_AMOUNT", "ORDER_AMOUNT_TAX", "ORDER_SHIPPING_AMOUNT", "ORDER_SHIPPING_AMOUNT_TAX",
    "COMMISSION_FEE", "COMMISSION_VAT",
    "REFUND_ORDER_AMOUNT", "REFUND_ORDER_AMOUNT_TAX",
    "REFUND_ORDER_SHIPPING_AMOUNT", "REFUND_ORDER_SHIPPING_AMOUNT_TAX",
    "REFUND_COMMISSION_FEE", "REFUND_COMMISSION_VAT", "PAYMENT",
  ]);
  const missingTypes = apiTransactions
    .filter(t => !knownTypes.has(t.transaction_type) && Math.abs(t.total_amount) > 0.01)
    .map(t => ({ transaction_type: t.transaction_type, count: t.count, total_amount: t.total_amount }));

  let verdict: StandardResponse["verdict"] = "match";
  if (transactions.length === 0) verdict = "no_data";
  else if (discrepancies.length > 0 || missingTypes.length > 0) verdict = "discrepancy";

  return {
    settlement_id: settlementId,
    marketplace: settlement.marketplace,
    source,
    verdict,
    filter_method: filterMethod,
    transaction_count: transactions.length,
    api_transactions: apiTransactions,
    api_totals: apiTotals,
    stored_settlement: stored,
    discrepancies,
    missing_transaction_types: missingTypes,
  };
}

// ── eBay verification path ──

async function verifyEbay(
  adminClient: any,
  settlement: any,
  userId: string,
): Promise<StandardResponse> {
  const stored = buildStoredValues(settlement);
  const settlementId = settlement.settlement_id;
  const source = settlement.source || "csv_upload";

  // Find eBay connection
  const { data: ebayRows } = await adminClient
    .from("ebay_tokens")
    .select("*")
    .eq("user_id", userId);

  if (!ebayRows || ebayRows.length === 0) {
    return {
      settlement_id: settlementId,
      marketplace: settlement.marketplace,
      source,
      verdict: "no_api_connection",
      filter_method: "none",
      transaction_count: 0,
      api_transactions: [],
      api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
      stored_settlement: stored,
      discrepancies: [],
      missing_transaction_types: [],
      error: "No eBay API connection found. Connect in Settings > API Connections.",
    };
  }

  const ebayRow = ebayRows[0];

  // Refresh token if needed
  let accessToken = ebayRow.access_token;
  if (!accessToken || !ebayRow.expires_at || new Date(ebayRow.expires_at) <= new Date()) {
    try {
      const clientId = Deno.env.get("EBAY_CLIENT_ID")!;
      const certId = Deno.env.get("EBAY_CERT_ID")!;
      const basicAuth = btoa(`${clientId}:${certId}`);

      const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: ebayRow.refresh_token,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => "");
        return {
          settlement_id: settlementId, marketplace: settlement.marketplace, source,
          verdict: "api_error", filter_method: "none", transaction_count: 0,
          api_transactions: [], api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
          stored_settlement: stored, discrepancies: [], missing_transaction_types: [],
          error: `eBay token refresh failed (${tokenRes.status})`, detail: errText.slice(0, 300),
        };
      }

      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
      const newExpiry = new Date(Date.now() + (tokenData.expires_in || 7200) * 1000).toISOString();

      await adminClient.from("ebay_tokens").update({
        access_token: accessToken,
        expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      }).eq("id", ebayRow.id);
    } catch (err: any) {
      return {
        settlement_id: settlementId, marketplace: settlement.marketplace, source,
        verdict: "api_error", filter_method: "none", transaction_count: 0,
        api_transactions: [], api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
        stored_settlement: stored, discrepancies: [], missing_transaction_types: [],
        error: "eBay token refresh failed", detail: err.message,
      };
    }
  }

  // Fetch payouts from eBay Sell Finances API
  const dateFrom = settlement.period_start ? `${settlement.period_start}T00:00:00.000Z` : null;
  const dateTo = settlement.period_end ? `${settlement.period_end}T23:59:59.999Z` : null;

  const filterParts: string[] = [];
  if (dateFrom) filterParts.push(`payoutDate:[${dateFrom}..${dateTo || ""}]`);

  const payoutUrl = `https://apiz.ebay.com/sell/finances/v1/payout?filter=${encodeURIComponent(filterParts.join(","))}&limit=100`;
  console.log(`[verify-settlement] eBay fetch: ${payoutUrl}`);

  const payoutRes = await fetch(payoutUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (!payoutRes.ok) {
    const errText = await payoutRes.text().catch(() => "");
    return {
      settlement_id: settlementId, marketplace: settlement.marketplace, source,
      verdict: "api_error", filter_method: "date_range_only", transaction_count: 0,
      api_transactions: [], api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
      stored_settlement: stored, discrepancies: [], missing_transaction_types: [],
      error: `eBay API returned ${payoutRes.status}`, detail: errText.slice(0, 500),
    };
  }

  const payoutData = await payoutRes.json();
  const payouts = payoutData.payouts || [];

  if (payouts.length === 0) {
    return {
      settlement_id: settlementId, marketplace: settlement.marketplace, source,
      verdict: "no_data", filter_method: "date_range_only", transaction_count: 0,
      api_transactions: [], api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
      stored_settlement: stored, discrepancies: [], missing_transaction_types: [],
    };
  }

  // Aggregate payout amounts
  let totalPayout = 0;
  for (const p of payouts) {
    totalPayout += parseFloat(p.amount?.value || p.payoutAmount?.value || "0");
  }

  const apiTotals = {
    sales: 0, shipping: 0, fees: 0, refunds: 0,
    payment: Math.round(totalPayout * 100) / 100,
    sales_tax: 0,
  };

  // eBay payout-level doesn't break down sales/fees — only compare bank_deposit
  const discrepancies = buildDiscrepancies(stored, [
    ["bank_deposit", stored.bank_deposit, apiTotals.payment],
  ]);

  const apiTransactions: TxSummary[] = payouts.map((p: any) => ({
    transaction_type: "PAYOUT",
    count: 1,
    total_amount: parseFloat(p.amount?.value || p.payoutAmount?.value || "0"),
  }));

  return {
    settlement_id: settlementId,
    marketplace: settlement.marketplace,
    source,
    verdict: discrepancies.length > 0 ? "discrepancy" : "match",
    filter_method: "date_range_only",
    transaction_count: payouts.length,
    api_transactions: apiTransactions,
    api_totals: apiTotals,
    stored_settlement: stored,
    discrepancies,
    missing_transaction_types: [],
  };
}

// ── Amazon verification path ──

async function verifyAmazon(
  adminClient: any,
  settlement: any,
  userId: string,
): Promise<StandardResponse> {
  const stored = buildStoredValues(settlement);
  const settlementId = settlement.settlement_id;
  const source = settlement.source || "csv_upload";

  const { data: amazonRows } = await adminClient
    .from("amazon_tokens")
    .select("*")
    .eq("user_id", userId);

  if (!amazonRows || amazonRows.length === 0) {
    return {
      settlement_id: settlementId, marketplace: settlement.marketplace, source,
      verdict: "no_api_connection", filter_method: "none", transaction_count: 0,
      api_transactions: [], api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
      stored_settlement: stored, discrepancies: [], missing_transaction_types: [],
      error: "No Amazon API connection found. Connect in Settings > API Connections.",
    };
  }

  // Amazon SP-API settlement verification is complex (requires requesting settlement reports).
  // For now, return a structured "not yet supported" message so the UI handles it gracefully.
  return {
    settlement_id: settlementId, marketplace: settlement.marketplace, source,
    verdict: "api_error", filter_method: "none", transaction_count: 0,
    api_transactions: [], api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
    stored_settlement: stored, discrepancies: [], missing_transaction_types: [],
    error: "Amazon settlement verification is not yet available — Amazon SP-API requires requesting settlement reports which take time to generate. This feature is coming soon.",
  };
}

// ── Main handler ──

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
    const { settlement_id, auto_correct } = body;

    if (!settlement_id) {
      return new Response(
        JSON.stringify({ error: "Missing settlement_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load settlement
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

    const marketplace = (settlement.marketplace || "").toLowerCase();
    console.log(`[verify-settlement] Routing: marketplace=${marketplace}, source=${settlement.source}, auto_correct=${!!auto_correct}`);

    let result: StandardResponse;

    if (isMiraklMarketplace(marketplace) || settlement.source === "mirakl_api") {
      result = await verifyMirakl(adminClient, settlement, userId);
    } else if (isEbayMarketplace(marketplace) || settlement.source === "ebay_api") {
      result = await verifyEbay(adminClient, settlement, userId);
    } else if (isAmazonMarketplace(marketplace) || settlement.source === "amazon_api") {
      result = await verifyAmazon(adminClient, settlement, userId);
    } else {
      // Check if any API connection exists for this user
      const [{ data: mirakl }, { data: ebay }, { data: amazon }] = await Promise.all([
        adminClient.from("mirakl_tokens").select("id").eq("user_id", userId).limit(1),
        adminClient.from("ebay_tokens").select("id").eq("user_id", userId).limit(1),
        adminClient.from("amazon_tokens").select("id").eq("user_id", userId).limit(1),
      ]);

      result = {
        settlement_id,
        marketplace: settlement.marketplace,
        source: settlement.source || "unknown",
        verdict: "no_api_connection",
        filter_method: "none",
        transaction_count: 0,
        api_transactions: [],
        api_totals: { sales: 0, shipping: 0, fees: 0, refunds: 0, payment: 0, sales_tax: 0 },
        stored_settlement: buildStoredValues(settlement),
        discrepancies: [],
        missing_transaction_types: [],
        error: `No API verification path available for marketplace "${settlement.marketplace}". API connections found: Mirakl=${(mirakl?.length || 0) > 0}, eBay=${(ebay?.length || 0) > 0}, Amazon=${(amazon?.length || 0) > 0}.`,
      };
    }

    // ── Auto-correct logic ──
    let autoCorrected = false;
    if (
      auto_correct &&
      result.verdict === "discrepancy" &&
      result.discrepancies.length > 0 &&
      !["pushed_to_xero", "already_recorded"].includes(settlement.status)
    ) {
      // Build update payload from API-verified values
      const corrections: Record<string, { old: number; new: number }> = {};
      const updatePayload: Record<string, any> = {};

      const FIELD_MAP: Record<string, string> = {
        bank_deposit: "bank_deposit",
        sales_principal: "sales_principal",
        sales_shipping: "sales_shipping",
        seller_fees: "seller_fees",
        refunds: "refunds",
        gst_on_income: "gst_on_income",
      };

      for (const d of result.discrepancies) {
        const dbField = FIELD_MAP[d.field];
        if (dbField && Math.abs(d.difference) > 1.00) {
          corrections[dbField] = { old: d.stored_value, new: d.api_value };
          updatePayload[dbField] = d.api_value;
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        // Log BEFORE writing correction
        await adminClient.from("system_events").insert({
          user_id: userId,
          event_type: "gap_auto_corrected",
          severity: "info",
          details: {
            settlement_id,
            marketplace: settlement.marketplace,
            corrections,
            triggered_by: "resolve_gaps_button",
            corrected_at: new Date().toISOString(),
          },
        });

        // Apply corrections
        updatePayload.sync_origin = "api_corrected";
        updatePayload.updated_at = new Date().toISOString();

        const { error: updateErr } = await adminClient
          .from("settlements")
          .update(updatePayload)
          .eq("settlement_id", settlement_id)
          .eq("user_id", userId);

        if (updateErr) {
          console.error("[verify-settlement] Auto-correct update failed:", updateErr.message);
        } else {
          autoCorrected = true;
          console.log(`[verify-settlement] Auto-corrected ${settlement_id}: ${JSON.stringify(corrections)}`);
        }
      }
    }

    // FIX 3: Log every resolution attempt for diagnostic trail
    try {
      await adminClient.from('system_events').insert({
        user_id: userId,
        event_type: 'gap_resolve_attempt',
        severity: ['no_data', 'api_error'].includes(result.verdict) ? 'warning' : 'info',
        marketplace_code: settlement.marketplace,
        settlement_id: settlement_id,
        details: {
          settlement_id,
          marketplace: settlement.marketplace,
          source: settlement.source,
          verdict: result.verdict,
          auto_correct_requested: !!auto_correct,
          auto_corrected: autoCorrected,
          transaction_count: result.transaction_count,
          discrepancy_count: result.discrepancies.length,
          filter_method: result.filter_method,
          error_message: result.error ?? null,
          triggered_by: body.triggered_by ?? 'unknown',
        },
      });
    } catch (logErr: any) {
      console.error('[verify-settlement] Failed to log gap_resolve_attempt:', logErr.message);
    }

    return new Response(
      JSON.stringify({ ...result, auto_corrected: autoCorrected }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[verify-settlement] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message, verdict: "api_error" }),
      {
        status: err.message?.includes("Forbidden") ? 403 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
