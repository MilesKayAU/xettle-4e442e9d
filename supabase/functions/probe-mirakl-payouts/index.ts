import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader } from "../_shared/mirakl-token.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { userId } = await verifyRequest(req);
    const { data: connections } = await adminClient.from("mirakl_tokens").select("*").eq("user_id", userId);
    const bunnings = connections?.find((c: any) => (c.marketplace_label || "").toLowerCase().includes("bunning")) || connections?.[0];
    if (!bunnings) return new Response(JSON.stringify({ error: "No connection" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const baseUrl = bunnings.base_url.replace(/\/$/, "");
    const authResult = await getMiraklAuthHeader(adminClient, bunnings);

    // Fetch invoices at offset 80 to get the last 25
    const url = `${baseUrl}/api/invoices?type=ALL&limit=50&offset=80`;
    console.log(`[probe3] Fetching: ${url}`);
    
    const res = await fetch(url, {
      headers: { [authResult.headerName]: authResult.headerValue, "Accept": "application/json" },
    });

    const data = await res.json();
    const invoices = (data.invoices || []).map((inv: any) => ({
      invoice_id: inv.invoice_id,
      date_created: inv.date_created,
      start_time: inv.start_time,
      end_time: inv.end_time,
      state: inv.state,
      type: inv.type,
      amount_transferred: inv.summary?.amount_transferred,
      total_payable_orders_incl_tax: inv.summary?.total_payable_orders_incl_tax,
      total_refund_orders_incl_tax: inv.summary?.total_refund_orders_incl_tax || 0,
      total_commissions_incl_tax: inv.summary?.total_commissions_incl_tax,
      payment_state: inv.payment?.state,
      payment_date: inv.payment?.transaction_date,
      payment_reference: inv.payment?.reference,
    }));

    const targetAmounts = [174.36, 1220.14, 775.29, 526.44];
    const matches = invoices.filter((inv: any) => 
      targetAmounts.some(t => Math.abs((inv.amount_transferred || 0) - t) < 0.05)
    );

    return new Response(JSON.stringify({
      status: res.status,
      total_count: data.total_count,
      offset: 80,
      returned: invoices.length,
      target_amount_matches: matches,
      invoices,
    }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
