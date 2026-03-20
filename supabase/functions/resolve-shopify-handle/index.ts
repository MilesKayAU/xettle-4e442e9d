import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { SHOPIFY_API_VERSION, getShopifyHeaders } from '../_shared/shopify-api-policy.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
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

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { handle } = await req.json();
    if (!handle || typeof handle !== "string") {
      return new Response(JSON.stringify({ error: "handle is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to read token (RLS may block access_token from client)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow } = await adminClient
      .from("shopify_tokens")
      .select("shop_domain, access_token")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!tokenRow?.access_token || !tokenRow?.shop_domain) {
      return new Response(
        JSON.stringify({ error: "No active Shopify connection found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shopifyRes = await fetch(
      `https://${tokenRow.shop_domain}/admin/api/2026-01/products.json?handle=${encodeURIComponent(handle)}&fields=id,title,variants`,
      { headers: { "X-Shopify-Access-Token": tokenRow.access_token } }
    );

    if (!shopifyRes.ok) {
      const body = await shopifyRes.text();
      console.error("Shopify API error:", shopifyRes.status, body);
      return new Response(
        JSON.stringify({ error: `Shopify API returned ${shopifyRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const json = await shopifyRes.json();
    const products = json.products || [];

    if (products.length === 0 || !products[0].variants?.length) {
      return new Response(
        JSON.stringify({ error: "No product found for this handle", handle }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const product = products[0];
    const variant = product.variants[0];

    return new Response(
      JSON.stringify({
        title: product.title,
        variant_id: String(variant.id),
        sku: variant.sku || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("resolve-shopify-handle error:", err);
    const fallbackHeaders = getCorsHeaders(req.headers.get("Origin") ?? "");
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...fallbackHeaders, "Content-Type": "application/json" } }
    );
  }
});
