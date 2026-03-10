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
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Support both service-role calls (from scheduled-sync) and user JWT calls
    const authHeader = req.headers.get("Authorization") || "";
    const isServiceRole = authHeader.includes(serviceRoleKey);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const { userId, orders } = body;

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If orders are provided (from client-side), analyze them directly
    // Otherwise, fetch from Shopify API
    let sourceNameCounts: Record<string, { count: number; revenue: number }> = {};

    if (orders && Array.isArray(orders)) {
      for (const order of orders) {
        const src = (order.source_name || "").toLowerCase().trim();
        if (!src || IGNORED_SOURCES.has(src)) continue;
        if (!sourceNameCounts[src]) sourceNameCounts[src] = { count: 0, revenue: 0 };
        sourceNameCounts[src].count++;
        sourceNameCounts[src].revenue += parseFloat(order.total_price || "0") || 0;
      }
    } else {
      // Fetch orders from Shopify directly for scheduled scan
      const { data: tokenRow } = await adminClient
        .from("shopify_tokens")
        .select("access_token, shop_domain")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (!tokenRow) {
        return new Response(
          JSON.stringify({ success: true, new_channels: 0, message: "No Shopify token" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch recent orders (last 30 days) to scan source_names
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const params = new URLSearchParams({
        status: "any",
        created_at_min: thirtyDaysAgo,
        limit: "250",
        fields: "id,name,source_name,total_price",
      });

      let allOrders: any[] = [];
      let nextCursor: string | undefined;
      let page = 0;

      do {
        const url = nextCursor
          ? `https://${tokenRow.shop_domain}/admin/api/2026-01/orders.json?limit=250&fields=id,name,source_name,total_price&page_info=${nextCursor}`
          : `https://${tokenRow.shop_domain}/admin/api/2026-01/orders.json?${params.toString()}`;

        const res = await fetch(url, {
          headers: {
            "X-Shopify-Access-Token": tokenRow.access_token,
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) break;

        const data = await res.json();
        allOrders.push(...(data.orders || []));

        nextCursor = undefined;
        const linkHeader = res.headers.get("Link");
        if (linkHeader) {
          const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>;\s*rel="next"/);
          if (nextMatch) nextCursor = nextMatch[1];
        }
        page++;
      } while (nextCursor && page < 10);

      for (const order of allOrders) {
        const src = (order.source_name || "").toLowerCase().trim();
        if (!src || IGNORED_SOURCES.has(src)) continue;
        if (!sourceNameCounts[src]) sourceNameCounts[src] = { count: 0, revenue: 0 };
        sourceNameCounts[src].count++;
        sourceNameCounts[src].revenue += parseFloat(order.total_price || "0") || 0;
      }
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
