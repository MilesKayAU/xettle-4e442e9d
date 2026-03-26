import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader } from "../_shared/mirakl-token.ts";

/**
 * Diagnostic probe — tests multiple Mirakl payout/payment endpoints
 * to determine which ones return historical payout data for Bunnings.
 * 
 * This is a ONE-TIME diagnostic function. Not for production use.
 */

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
    const { userId } = await verifyRequest(req);
    const body = await req.json().catch(() => ({}));

    // Load Bunnings connection
    const { data: connections, error: connErr } = await adminClient
      .from("mirakl_tokens")
      .select("*")
      .eq("user_id", userId);

    if (connErr) throw connErr;
    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ error: "No Mirakl connections found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find Bunnings connection
    const bunnings = connections.find((c: any) =>
      (c.marketplace_label || "").toLowerCase().includes("bunning")
    ) || connections[0];

    const baseUrl = bunnings.base_url.replace(/\/$/, "");
    const authResult = await getMiraklAuthHeader(adminClient, bunnings);

    const results: any[] = [];

    // ── Endpoint 1: /api/sellerpayment/payouts ──
    const endpoints = [
      { label: "PA11 sellerpayment/payouts", path: "/api/sellerpayment/payouts" },
      { label: "PA11 payment/shop/payouts", path: "/api/payment/shop/payouts" },
      { label: "PA12 sellerpayment/payment", path: "/api/sellerpayment/payment" },
      { label: "IV01 invoices ALL", path: "/api/invoices?type=ALL&limit=20" },
      { label: "IV01 invoices PAYOUT", path: "/api/invoices?type=PAYOUT&limit=20" },
      { label: "IV01 invoices AUTO_INVOICE", path: "/api/invoices?type=AUTO_INVOICE&limit=20" },
      { label: "IV01 invoices MANUAL_INVOICE", path: "/api/invoices?type=MANUAL_INVOICE&limit=20" },
      { label: "PA11 sellerpayment/payouts (with dates)", path: "/api/sellerpayment/payouts?start_date=2026-01-01T00:00:00Z&end_date=2026-03-26T23:59:59Z" },
    ];

    // Also try with shop_id if available
    const shopId = bunnings.seller_company_id && bunnings.seller_company_id !== "default"
      ? bunnings.seller_company_id : null;

    for (const ep of endpoints) {
      let url = `${baseUrl}${ep.path}`;
      // Add shop param if available and not already in URL
      if (shopId && !url.includes("shop=")) {
        url += (url.includes("?") ? "&" : "?") + `shop=${shopId}`;
      }

      try {
        console.log(`[probe] Trying: ${ep.label} → ${url}`);
        const res = await fetch(url, {
          method: "GET",
          headers: {
            [authResult.headerName]: authResult.headerValue,
            "Accept": "application/json",
          },
        });

        const status = res.status;
        const contentType = res.headers.get("content-type") || "";
        let responseBody: any;

        if (contentType.includes("json")) {
          responseBody = await res.json();
        } else {
          const text = await res.text();
          responseBody = text.slice(0, 2000);
        }

        // Truncate large arrays for readability
        if (responseBody && typeof responseBody === "object") {
          for (const key of Object.keys(responseBody)) {
            if (Array.isArray(responseBody[key]) && responseBody[key].length > 5) {
              const total = responseBody[key].length;
              responseBody[`${key}_total_count`] = total;
              responseBody[key] = responseBody[key].slice(0, 5);
              responseBody[`${key}_truncated`] = true;
            }
          }
        }

        results.push({
          endpoint: ep.label,
          url,
          status,
          success: status >= 200 && status < 300,
          response: responseBody,
        });

        console.log(`[probe] ${ep.label}: ${status} ${status >= 200 && status < 300 ? '✅' : '❌'}`);
      } catch (fetchErr: any) {
        results.push({
          endpoint: ep.label,
          url,
          status: "error",
          success: false,
          error: fetchErr.message,
        });
        console.log(`[probe] ${ep.label}: ERROR ${fetchErr.message}`);
      }

      // Rate limit: 1 req/sec
      await new Promise(r => setTimeout(r, 1100));
    }

    // Summary: which endpoints returned data?
    const working = results.filter(r => r.success);
    const withData = working.filter(r => {
      const resp = r.response;
      if (!resp || typeof resp !== "object") return false;
      // Check for any array field with items
      return Object.values(resp).some((v: any) => Array.isArray(v) && v.length > 0);
    });

    // Check for target amounts
    const targetAmounts = [174.36, 1220.14, 775.29, 526.44];
    const amountMatches: any[] = [];
    for (const r of withData) {
      const resp = r.response;
      for (const key of Object.keys(resp)) {
        if (Array.isArray(resp[key])) {
          for (const item of resp[key]) {
            for (const amt of targetAmounts) {
              // Check common amount field names
              const amountFields = ["amount", "total_amount", "amount_due_to_seller", "payout_amount", "net_amount", "total_credited"];
              for (const af of amountFields) {
                if (item[af] !== undefined && Math.abs(Number(item[af]) - amt) < 0.01) {
                  amountMatches.push({
                    endpoint: r.endpoint,
                    field: af,
                    value: item[af],
                    target: amt,
                    item_preview: JSON.stringify(item).slice(0, 500),
                  });
                }
              }
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      connection: {
        marketplace_label: bunnings.marketplace_label,
        base_url: baseUrl,
        auth_mode: bunnings.auth_mode,
        seller_company_id: bunnings.seller_company_id,
      },
      endpoints_tested: results.length,
      endpoints_working: working.length,
      endpoints_with_data: withData.length,
      target_amounts: targetAmounts,
      amount_matches: amountMatches,
      results,
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[probe-mirakl-payouts] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
