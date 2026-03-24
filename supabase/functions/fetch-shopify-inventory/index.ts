import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";

const PAGE_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 500;

serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { userId } = await verifyRequest(req);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(body.limit || DEFAULT_LIMIT, 1000);
    const cursor = body.cursor || null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get Shopify token
    const { data: tokenRow } = await supabase
      .from("shopify_tokens")
      .select("access_token, shop_domain")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!tokenRow?.access_token || !tokenRow?.shop_domain) {
      return new Response(JSON.stringify({ items: [], hasMore: false, partial: false, error: "Shopify not connected" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { access_token, shop_domain } = tokenRow;
    const apiVersion = "2024-01";
    const items: any[] = [];
    let partial = false;
    let errorMsg: string | undefined;
    let hasMore = false;
    let nextCursor: string | undefined;

    // Build URL
    let url = cursor
      ? cursor
      : `https://${shop_domain}/admin/api/${apiVersion}/products.json?limit=250&fields=id,title,variants,images,status`;

    let fetched = 0;
    while (url && fetched < limit) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

      try {
        const resp = await fetch(url, {
          headers: { "X-Shopify-Access-Token": access_token, "Content-Type": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          errorMsg = `Shopify API error: ${resp.status} ${resp.statusText}`;
          partial = items.length > 0;
          break;
        }

        const data = await resp.json();
        const products = data.products || [];

        for (const product of products) {
          for (const variant of (product.variants || [])) {
            items.push({
              sku: variant.sku || `variant-${variant.id}`,
              title: variant.title || "Default Title",
              product_title: product.title,
              quantity: variant.inventory_quantity ?? 0,
              price: parseFloat(variant.price) || 0,
              status: product.status,
              updated_at: variant.updated_at,
              image_url: product.images?.[0]?.src || null,
            });
            fetched++;
            if (fetched >= limit) break;
          }
          if (fetched >= limit) break;
        }

        // Pagination via Link header
        const linkHeader = resp.headers.get("Link");
        const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch && fetched < limit) {
          url = nextMatch[1];
        } else {
          if (nextMatch) {
            hasMore = true;
            nextCursor = nextMatch[1];
          }
          url = "";
        }
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") {
          errorMsg = "Request timed out — partial results returned";
        } else {
          errorMsg = err.message;
        }
        partial = items.length > 0;
        break;
      }
    }

    return new Response(JSON.stringify({ items, hasMore, nextCursor, partial, error: errorMsg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ items: [], hasMore: false, partial: false, error: err.message }), {
      status: err.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
