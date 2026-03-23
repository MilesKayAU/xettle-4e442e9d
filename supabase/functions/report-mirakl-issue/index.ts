import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { userId } = await verifyRequest(req);
    const { marketplace_label, base_url, error_message } = await req.json();

    if (!marketplace_label || !error_message) {
      return new Response(
        JSON.stringify({ error: "marketplace_label and error_message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Redact API key from base_url
    const safeUrl = (base_url || "").replace(/[?&](api_key|key|token)=[^&]*/gi, "$1=REDACTED");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Fetch last 10 system events for context
    const { data: events } = await adminClient
      .from("system_events")
      .select("event_type, severity, marketplace_code, details, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    const { error: insertErr } = await adminClient
      .from("mirakl_issue_reports")
      .insert({
        user_id: userId,
        marketplace_label,
        base_url: safeUrl,
        error_message,
        event_log: events || [],
      });

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[report-mirakl-issue] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
