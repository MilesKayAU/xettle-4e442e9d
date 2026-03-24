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
    const cursor = body.cursor ? parseInt(body.cursor) : 1;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get Kogan API credentials from app_settings
    const [sellerIdRes, tokenRes] = await Promise.all([
      supabase.from("app_settings").select("value").eq("user_id", userId).eq("key", "kogan_api_seller_id").maybeSingle(),
      supabase.from("app_settings").select("value").eq("user_id", userId).eq("key", "kogan_api_seller_token").maybeSingle(),
    ]);

    const sellerId = sellerIdRes.data?.value;
    const sellerToken = tokenRes.data?.value;

    if (!sellerId || !sellerToken) {
      return new Response(JSON.stringify({ items: [], hasMore: false, partial: false, error: "Kogan API credentials not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const items: any[] = [];
    let partial = false;
    let errorMsg: string | undefined;
    let hasMore = false;
    let nextCursor: string | undefined;
    let page = cursor;

    while (items.length < limit) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

      try {
        const url = `https://api.kogan.com/api/marketplace/v2/products/?page=${page}&page_size=100`;
        const resp = await fetch(url, {
          headers: {
            "SellerID": sellerId,
            "SellerToken": sellerToken,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          errorMsg = `Kogan API error: ${resp.status}`;
          partial = items.length > 0;
          break;
        }

        const data = await resp.json();
        const products = data.results || data.data || [];

        if (products.length === 0) break;

        for (const p of products) {
          items.push({
            sku: p.sku || p.offer_id || `kogan-${p.id}`,
            title: p.title || p.product_title || "Unknown",
            quantity: p.stock_qty ?? p.quantity ?? 0,
            price: parseFloat(p.price) || 0,
            status: p.is_active ? "active" : "inactive",
            updated_at: p.updated_at || p.modified_at || null,
          });
          if (items.length >= limit) break;
        }

        const nextUrl = data.next;
        if (nextUrl && items.length < limit) {
          page++;
        } else {
          if (nextUrl) {
            hasMore = true;
            nextCursor = String(page + 1);
          }
          break;
        }
      } catch (err: any) {
        clearTimeout(timeout);
        errorMsg = err.name === "AbortError" ? "Request timed out — partial results returned" : err.message;
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
