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

    // Fetch at multiple offsets to find the gap
    const offsets = [85, 90, 95, 100];
    const results: any[] = [];

    for (const off of offsets) {
      const url = `${baseUrl}/api/invoices?type=ALL&limit=20&offset=${off}`;
      console.log(`[probe4] offset=${off}: ${url}`);
      const res = await fetch(url, {
        headers: { [authResult.headerName]: authResult.headerValue, "Accept": "application/json" },
      });
      const data = await res.json();
      const invoices = (data.invoices || []).map((inv: any) => ({
        invoice_id: inv.invoice_id,
        date_created: inv.date_created,
        start_time: inv.start_time,
        end_time: inv.end_time,
        amount_transferred: inv.summary?.amount_transferred,
        total_payable_orders_incl_tax: inv.summary?.total_payable_orders_incl_tax,
        total_commissions_incl_tax: inv.summary?.total_commissions_incl_tax,
        total_refund_orders_incl_tax: inv.summary?.total_refund_orders_incl_tax || 0,
        payment_state: inv.payment?.state,
        payment_date: inv.payment?.transaction_date,
        state: inv.state,
        type: inv.type,
      }));
      results.push({ offset: off, total_count: data.total_count, returned: invoices.length, invoices });
      await new Promise(r => setTimeout(r, 1100));
    }

    // Also try sort_by or date filter for recent
    const url2 = `${baseUrl}/api/invoices?type=ALL&limit=20&sort=date_created:desc`;
    console.log(`[probe4] desc sort: ${url2}`);
    const res2 = await fetch(url2, {
      headers: { [authResult.headerName]: authResult.headerValue, "Accept": "application/json" },
    });
    const data2 = await res2.json();
    const descInvoices = (data2.invoices || []).map((inv: any) => ({
      invoice_id: inv.invoice_id,
      date_created: inv.date_created,
      amount_transferred: inv.summary?.amount_transferred,
      payment_date: inv.payment?.transaction_date,
      payment_state: inv.payment?.state,
      state: inv.state,
      type: inv.type,
    }));

    return new Response(JSON.stringify({
      offset_results: results,
      desc_sort: { status: res2.status, total_count: data2.total_count, returned: descInvoices.length, invoices: descInvoices },
    }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
