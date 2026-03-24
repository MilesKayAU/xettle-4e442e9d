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

    const { data: tokenRow } = await supabase
      .from("ebay_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!tokenRow?.access_token) {
      return new Response(JSON.stringify({ items: [], hasMore: false, partial: false, error: "eBay not connected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh token if expired
    let accessToken = tokenRow.access_token;
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      const clientId = Deno.env.get("EBAY_CLIENT_ID");
      const certId = Deno.env.get("EBAY_CERT_ID");
      if (clientId && certId && tokenRow.refresh_token) {
        try {
          const refreshResp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${btoa(`${clientId}:${certId}`)}`,
            },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokenRow.refresh_token)}`,
          });
          if (refreshResp.ok) {
            const tokens = await refreshResp.json();
            accessToken = tokens.access_token;
            await supabase.from("ebay_tokens").update({
              access_token: accessToken,
              expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            }).eq("user_id", userId);
          }
        } catch { /* use existing token */ }
      }
    }

    const items: any[] = [];
    let partial = false;
    let errorMsg: string | undefined;
    let hasMore = false;
    let nextCursor: string | undefined;

    // Fetch inventory items
    let offset = cursor ? parseInt(cursor) : 0;
    const pageSize = 100;

    while (items.length < limit) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

      try {
        const url = `https://api.ebay.com/sell/inventory/v1/inventory_item?limit=${pageSize}&offset=${offset}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          errorMsg = `eBay API error: ${resp.status}`;
          partial = items.length > 0;
          break;
        }

        const data = await resp.json();
        const inventoryItems = data.inventoryItems || [];

        if (inventoryItems.length === 0) break;

        for (const item of inventoryItems) {
          items.push({
            sku: item.sku || "unknown",
            title: item.product?.title || item.sku || "Unknown",
            quantity: item.availability?.shipToLocationAvailability?.quantity ?? 0,
            price: item.product?.aspects?.Price?.[0] ? parseFloat(item.product.aspects.Price[0]) : null,
            listing_status: item.condition || "USED_EXCELLENT",
            updated_at: null,
          });
          if (items.length >= limit) break;
        }

        if (data.total > offset + pageSize && items.length < limit) {
          offset += pageSize;
        } else {
          if (data.total > offset + pageSize) {
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
