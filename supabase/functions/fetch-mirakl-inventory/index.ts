import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklToken } from "../_shared/mirakl-token.ts";

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
    const cursor = body.cursor ? parseInt(body.cursor) : 0;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get all Mirakl tokens for this user
    const { data: miraklTokens } = await supabase
      .from("mirakl_tokens")
      .select("*")
      .eq("user_id", userId);

    if (!miraklTokens || miraklTokens.length === 0) {
      return new Response(JSON.stringify({ items: [], hasMore: false, partial: false, error: "Mirakl not connected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const items: any[] = [];
    let partial = false;
    let errorMsg: string | undefined;
    let hasMore = false;
    let nextCursor: string | undefined;

    for (const token of miraklTokens) {
      if (items.length >= limit) {
        hasMore = true;
        break;
      }

      const authHeaders: Record<string, string> = {};
      if (token.auth_mode === "api_key" && token.api_key) {
        authHeaders["Authorization"] = token.api_key;
      } else if (token.access_token) {
        authHeaders["Authorization"] = `Bearer ${token.access_token}`;
      }

      let offset = cursor;
      const pageSize = 100;

      while (items.length < limit) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

        try {
          const url = `${token.base_url}/api/offers?offset=${offset}&max=${pageSize}`;
          const resp = await fetch(url, {
            headers: { ...authHeaders, "Accept": "application/json" },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (!resp.ok) {
            errorMsg = `Mirakl API error (${token.marketplace_label}): ${resp.status}`;
            partial = items.length > 0;
            break;
          }

          const data = await resp.json();
          const offers = data.offers || [];

          if (offers.length === 0) break;

          for (const offer of offers) {
            items.push({
              sku: offer.shop_sku || offer.offer_id?.toString() || "unknown",
              title: offer.product_title || offer.description || "Unknown",
              quantity: offer.quantity ?? 0,
              price: parseFloat(offer.price) || 0,
              offer_status: offer.state_code || offer.active ? "active" : "inactive",
              marketplace_label: token.marketplace_label || "Mirakl",
              updated_at: offer.last_updated || offer.date_created || null,
            });
            if (items.length >= limit) break;
          }

          if (data.total_count > offset + pageSize && items.length < limit) {
            offset += pageSize;
          } else {
            if (data.total_count > offset + pageSize) {
              hasMore = true;
              nextCursor = String(offset + pageSize);
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
