import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader } from "../_shared/mirakl-token.ts";

/**
 * Probe #2 — Fetch recent IV01 invoices (offset to last page) 
 * to find the target payout amounts: $174.36, $1,220.14, $775.29, $526.44
 * 
 * IV01 summary.amount_transferred = bank deposit (net payout to seller)
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

    const { data: connections } = await adminClient
      .from("mirakl_tokens")
      .select("*")
      .eq("user_id", userId);

    const bunnings = connections?.find((c: any) =>
      (c.marketplace_label || "").toLowerCase().includes("bunning")
    ) || connections?.[0];

    if (!bunnings) {
      return new Response(JSON.stringify({ error: "No Bunnings connection" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = bunnings.base_url.replace(/\/$/, "");
    const authResult = await getMiraklAuthHeader(adminClient, bunnings);

    const targetAmounts = [174.36, 1220.14, 775.29, 526.44];
    const allInvoices: any[] = [];
    let offset = 0;
    const limit = 50;
    let totalCount = 0;

    // Paginate through ALL IV01 invoices
    while (true) {
      const url = `${baseUrl}/api/invoices?type=ALL&limit=${limit}&offset=${offset}`;
      console.log(`[probe2] Fetching offset=${offset}: ${url}`);
      
      const res = await fetch(url, {
        headers: {
          [authResult.headerName]: authResult.headerValue,
          "Accept": "application/json",
        },
      });

      if (!res.ok) {
        console.log(`[probe2] Error at offset ${offset}: ${res.status}`);
        break;
      }

      const data = await res.json();
      totalCount = data.total_count || 0;
      const invoices = data.invoices || [];
      
      if (invoices.length === 0) break;
      
      for (const inv of invoices) {
        allInvoices.push({
          invoice_id: inv.invoice_id,
          date_created: inv.date_created,
          start_time: inv.start_time,
          end_time: inv.end_time,
          state: inv.state,
          type: inv.type,
          amount_transferred: inv.summary?.amount_transferred,
          amount_transferred_to_operator: inv.summary?.amount_transferred_to_operator,
          total_payable_orders_incl_tax: inv.summary?.total_payable_orders_incl_tax,
          total_refund_orders_incl_tax: inv.summary?.total_refund_orders_incl_tax || 0,
          total_commissions_incl_tax: inv.summary?.total_commissions_incl_tax,
          payment_state: inv.payment?.state,
          payment_date: inv.payment?.transaction_date,
          payment_reference: inv.payment?.reference,
        });
      }
      
      offset += invoices.length;
      if (offset >= totalCount) break;
      
      // Rate limit
      await new Promise(r => setTimeout(r, 1100));
    }

    // Find matches for target amounts
    const matches = allInvoices.filter(inv => 
      targetAmounts.some(t => Math.abs((inv.amount_transferred || 0) - t) < 0.02)
    );

    // Show recent invoices (2026)
    const recent = allInvoices.filter(inv => 
      inv.date_created && inv.date_created >= "2026-01-01"
    );

    // Also show 2025 Q4 for context
    const q4_2025 = allInvoices.filter(inv =>
      inv.date_created && inv.date_created >= "2025-10-01" && inv.date_created < "2026-01-01"
    );

    return new Response(JSON.stringify({
      total_invoices: totalCount,
      fetched: allInvoices.length,
      target_amount_matches: matches,
      recent_2026: recent,
      q4_2025_count: q4_2025.length,
      q4_2025: q4_2025.slice(-5),
      // Show last 20 invoices regardless
      last_20: allInvoices.slice(-20),
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[probe2] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
