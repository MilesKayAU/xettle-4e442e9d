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
  console.log("[fetch-shopify-orders] Handler invoked", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      console.error("[fetch-shopify-orders] No auth header");
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

    // Use getClaims for JWT verification (signing-keys compatible)
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error("[fetch-shopify-orders] Auth failed:", claimsError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized", detail: claimsError?.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authenticatedUserId = claimsData.claims.sub as string;
    console.log("[fetch-shopify-orders] Auth OK, user:", authenticatedUserId);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      console.error("[fetch-shopify-orders] Failed to parse request body");
    }
    const { userId, shopDomain, dateFrom, dateTo, limit } = body;
    console.log("[fetch-shopify-orders] Body:", { shopDomain, dateFrom, dateTo, limit });

    const resolvedUserId = userId || authenticatedUserId;
    const effectiveLimit = Math.min(limit || 250, 250);

    // ─── Enforce accounting boundary ────────────────────────────────
    let effectiveDateFrom = dateFrom;
    console.log("[fetch-shopify-orders] Querying accounting boundary...");
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
    console.log("[fetch-shopify-orders] Boundary resolved, effectiveDateFrom:", effectiveDateFrom);

    // 1. Get access token from shopify_tokens
    console.log("[fetch-shopify-orders] Querying shopify_tokens for:", shopDomain);
    const { data: tokenRow, error: tokenError } = await supabase
      .from("shopify_tokens")
      .select("access_token")
      .eq("user_id", resolvedUserId)
      .eq("shop_domain", shopDomain)
      .single();

    console.log("[fetch-shopify-orders] Token query result:", { found: !!tokenRow, error: tokenError?.message });

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: "No Shopify token found for this store", detail: tokenError?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = tokenRow.access_token;
    console.log("[fetch-shopify-orders] Got access token, length:", accessToken?.length);

    // 2. Build Shopify API URL
    const buildUrl = (cursor?: string) => {
      // When using cursor pagination, Shopify only allows limit, fields, and page_info
      if (cursor) {
        const params = new URLSearchParams({
          limit: String(effectiveLimit),
          page_info: cursor,
          fields:
            "id,name,created_at,processed_at,financial_status,gateway,note_attributes,tags,subtotal_price,total_shipping_price_set,total_tax,total_price,total_discounts,line_items,payment_gateway_names,source_name",
        });
        return `https://${shopDomain}/admin/api/2026-01/orders.json?${params.toString()}`;
      }

      const params = new URLSearchParams({
        status: "any",
        financial_status: "paid",
        limit: String(effectiveLimit),
        fields:
          "id,name,created_at,processed_at,financial_status,gateway,note_attributes,tags,subtotal_price,total_shipping_price_set,total_tax,total_price,total_discounts,line_items,payment_gateway_names,source_name",
      });
      if (effectiveDateFrom) params.set("created_at_min", effectiveDateFrom);
      if (dateTo) params.set("created_at_max", dateTo);
      return `https://${shopDomain}/admin/api/2026-01/orders.json?${params.toString()}`;
    };

    // 3. Fetch with pagination
    const allOrders: ShopifyOrder[] = [];
    let nextCursor: string | undefined;
    let page = 0;
    const MAX_PAGES = 20;

    do {
      const url = buildUrl(nextCursor);
      console.log(`[fetch-shopify-orders] Fetching page ${page}:`, url.substring(0, 120));
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
      });

      console.log(`[fetch-shopify-orders] Shopify response: status=${res.status}`);

      if (res.status === 401) {
        console.error("[fetch-shopify-orders] Shopify 401 — token invalid");
        return new Response(
          JSON.stringify({ error: "Shopify token invalid or expired" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (res.status === 429) {
        console.error("[fetch-shopify-orders] Shopify 429 — rate limited");
        return new Response(
          JSON.stringify({ error: "Shopify rate limit exceeded. Try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!res.ok) {
        const body = await res.text();
        console.error("[fetch-shopify-orders] Shopify error:", res.status, body);
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
        const { error: upsertErr } = await adminClient
          .from("shopify_orders")
          .upsert(rows.slice(i, i + 500), { onConflict: "user_id,shopify_order_id" });
        if (upsertErr) {
          console.error("[fetch-shopify-orders] upsert error:", upsertErr.message);
        }
      }
      console.log(`[fetch-shopify-orders] Persisted ${rows.length} orders to shopify_orders`);
    }

    return new Response(
      JSON.stringify({ success: true, orders: allOrders, count: allOrders.length, shop: shopDomain }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[fetch-shopify-orders] FATAL:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
