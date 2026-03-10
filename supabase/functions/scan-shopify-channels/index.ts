import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Source names that are core Shopify — never alert on these
const IGNORED_SOURCES = new Set([
  "web", "shopify", "pos", "online_store", "iphone", "android",
  "unknown", "", "shopify_draft_order", "draft_orders", "buy_button",
  "checkout", "subscription_contract_checkout_one",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const { userId } = body;

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Query local shopify_orders table — zero API calls ───────
    const { data: channelRows, error: queryError } = await adminClient
      .from("shopify_orders")
      .select("source_name")
      .eq("user_id", userId)
      .not("source_name", "is", null);

    if (queryError) {
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If no orders in local table, report it — don't attempt API calls
    if (!channelRows || channelRows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, new_channels: 0, scanned_sources: [], needs_initial_sync: true, message: "shopify_orders table is empty for this user. A manual Shopify sync is needed first." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Aggregate locally (supabase JS client doesn't support GROUP BY)
    const sourceNameCounts: Record<string, { count: number; revenue: number }> = {};

    // We need revenue too, so fetch with total_price
    const { data: orderRows } = await adminClient
      .from("shopify_orders")
      .select("source_name, total_price")
      .eq("user_id", userId)
      .not("source_name", "is", null);

    for (const row of orderRows || []) {
      const src = (row.source_name || "").toLowerCase().trim();
      if (!src || IGNORED_SOURCES.has(src)) continue;
      if (!sourceNameCounts[src]) sourceNameCounts[src] = { count: 0, revenue: 0 };
      sourceNameCounts[src].count++;
      sourceNameCounts[src].revenue += parseFloat(row.total_price || "0") || 0;
    }

    const sourceNames = Object.keys(sourceNameCounts);
    if (sourceNames.length === 0) {
      return new Response(
        JSON.stringify({ success: true, new_channels: 0, scanned_sources: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check which are already known (in shopify_sub_channels)
    const { data: knownChannels } = await adminClient
      .from("shopify_sub_channels")
      .select("source_name, ignored")
      .eq("user_id", userId)
      .in("source_name", sourceNames);

    const knownSet = new Set((knownChannels || []).map((c: any) => c.source_name));

    // Check existing channel_alerts
    const { data: existingAlerts } = await adminClient
      .from("channel_alerts")
      .select("source_name, status")
      .eq("user_id", userId)
      .in("source_name", sourceNames);

    const alertedSet = new Set((existingAlerts || []).map((a: any) => a.source_name));

    // Create alerts for new channels not already known or alerted
    let newAlerts = 0;
    for (const [src, data] of Object.entries(sourceNameCounts)) {
      if (knownSet.has(src) || alertedSet.has(src)) continue;

      await adminClient.from("channel_alerts").upsert({
        user_id: userId,
        source_name: src,
        order_count: data.count,
        total_revenue: Math.round(data.revenue * 100) / 100,
        status: "pending",
      }, { onConflict: "user_id,source_name" });

      newAlerts++;
    }

    // Update counts for existing pending alerts
    for (const [src, data] of Object.entries(sourceNameCounts)) {
      if (alertedSet.has(src)) {
        const existing = (existingAlerts || []).find((a: any) => a.source_name === src);
        if (existing && existing.status === "pending") {
          await adminClient.from("channel_alerts")
            .update({
              order_count: data.count,
              total_revenue: Math.round(data.revenue * 100) / 100,
            })
            .eq("user_id", userId)
            .eq("source_name", src);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        new_channels: newAlerts,
        scanned_sources: sourceNames,
        total_orders_scanned: Object.values(sourceNameCounts).reduce((s, d) => s + d.count, 0),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
