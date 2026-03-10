import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  processed_at: string;
  financial_status: string;
  gateway: string;
  note_attributes: unknown[];
  tags: string;
  subtotal_price: string;
  total_shipping_price_set: unknown;
  total_tax: string;
  total_price: string;
  total_discounts?: string;
  line_items: unknown[];
  payment_gateway_names: string[];
  source_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId, shopDomain, dateFrom, dateTo, limit } = await req.json();
    const resolvedUserId = userId || claimsData.claims.sub;
    const effectiveLimit = Math.min(limit || 250, 250);

    // ─── Enforce accounting boundary ────────────────────────────────
    let effectiveDateFrom = dateFrom;
    const { data: boundarySetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "accounting_boundary_date")
      .eq("user_id", resolvedUserId)
      .maybeSingle();

    if (boundarySetting?.value) {
      const boundaryDate = boundarySetting.value;
      if (!effectiveDateFrom || effectiveDateFrom < boundaryDate) {
        effectiveDateFrom = boundaryDate + "T00:00:00Z";
      }
    }

    // 1. Get access token from shopify_tokens
    const { data: tokenRow, error: tokenError } = await supabase
      .from("shopify_tokens")
      .select("access_token")
      .eq("user_id", resolvedUserId)
      .eq("shop_domain", shopDomain)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: "No Shopify token found for this store", detail: tokenError?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = tokenRow.access_token;

    // 2. Build Shopify API URL
    const buildUrl = (cursor?: string) => {
      const params = new URLSearchParams({
        status: "any",
        financial_status: "paid",
        limit: String(effectiveLimit),
        fields:
          "id,name,created_at,processed_at,financial_status,gateway,note_attributes,tags,subtotal_price,total_shipping_price_set,total_tax,total_price,total_discounts,line_items,payment_gateway_names,source_name",
      });
      if (effectiveDateFrom) params.set("created_at_min", effectiveDateFrom);
      if (dateTo) params.set("created_at_max", dateTo);
      if (cursor) params.set("page_info", cursor);
      return `https://${shopDomain}/admin/api/2026-01/orders.json?${params.toString()}`;
    };

    // 3. Fetch with pagination
    const allOrders: ShopifyOrder[] = [];
    let nextCursor: string | undefined;
    let page = 0;
    const MAX_PAGES = 20;

    do {
      const url = buildUrl(nextCursor);
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
      });

      if (res.status === 401) {
        return new Response(
          JSON.stringify({ error: "Shopify token invalid or expired" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: "Shopify rate limit exceeded. Try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!res.ok) {
        const body = await res.text();
        return new Response(
          JSON.stringify({ error: `Shopify API error ${res.status}`, detail: body }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await res.json();
      allOrders.push(...(data.orders || []));

      // Parse Link header for cursor-based pagination
      nextCursor = undefined;
      const linkHeader = res.headers.get("Link");
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]*)[^>]*>;\s*rel="next"/);
        if (nextMatch) nextCursor = nextMatch[1];
      }

      page++;
    } while (nextCursor && page < MAX_PAGES);

    // 4. Persist orders locally for channel scanning & analytics
    if (allOrders.length > 0) {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const rows = allOrders.map((o) => ({
        user_id: resolvedUserId,
        shopify_order_id: o.id,
        order_name: o.name,
        source_name: o.source_name || null,
        gateway: o.gateway || null,
        tags: o.tags || null,
        total_price: parseFloat(o.total_price || "0") || 0,
        financial_status: o.financial_status || null,
        created_at_shopify: o.created_at || null,
        synced_at: new Date().toISOString(),
      }));

      // Batch upsert in chunks of 500
      for (let i = 0; i < rows.length; i += 500) {
        await adminClient
          .from("shopify_orders")
          .upsert(rows.slice(i, i + 500), { onConflict: "user_id,shopify_order_id" });
      }
    }

    return new Response(
      JSON.stringify({ success: true, orders: allOrders, count: allOrders.length, shop: shopDomain }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
