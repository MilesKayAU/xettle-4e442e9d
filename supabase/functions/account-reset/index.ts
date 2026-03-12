import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the calling user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roleData } = await userClient.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const userId = user.id;

    // Tables to clear, in dependency-safe order
    const tables = [
      "settlement_lines",
      "settlement_unmapped",
      "settlement_profit",
      "settlement_id_aliases",
      "marketplace_fee_observations",
      "marketplace_fee_alerts",
      "marketplace_file_fingerprints",
      "marketplace_ad_spend",
      "marketplace_shipping_costs",
      "marketplace_validation",
      "reconciliation_checks",
      "reconciliation_notes",
      "xero_accounting_matches",
      "payment_verifications",
      "settlements",
      "shopify_orders",
      "shopify_sub_channels",
      "channel_alerts",
      "bank_transactions",
      "system_events",
      "sync_history",
      "product_costs",
      "marketplace_connections",
      "marketplace_discovery_log",
      "user_contact_classifications",
      "xero_contact_account_mappings",
      "xero_chart_of_accounts",
      "xero_tokens",
      "amazon_tokens",
      "shopify_tokens",
      "ai_usage",
      "entity_library",
    ];

    const results: Record<string, string> = {};

    for (const table of tables) {
      const { error } = await adminClient.from(table).delete().eq("user_id", userId);
      results[table] = error ? `error: ${error.message}` : "cleared";
    }

    // Clear app_settings except user_roles-related ones, keep the account alive
    const { error: settingsErr } = await adminClient
      .from("app_settings")
      .delete()
      .eq("user_id", userId);
    results["app_settings"] = settingsErr ? `error: ${settingsErr.message}` : "cleared";

    // Clear marketplace_fingerprints (user-specific only)
    const { error: fpErr } = await adminClient
      .from("marketplace_fingerprints")
      .delete()
      .eq("user_id", userId);
    results["marketplace_fingerprints"] = fpErr ? `error: ${fpErr.message}` : "cleared";

    return new Response(
      JSON.stringify({ success: true, user_id: userId, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
