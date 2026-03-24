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
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokenRow.refresh_token)}&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory.readonly')}`,
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

    // Use eBay Trading API GetMyeBaySelling (works for all listing types)
    const startPage = cursor ? parseInt(cursor) : 1;
    const entriesPerPage = 200;
    let currentPage = startPage;

    while (items.length < limit) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

      try {
        const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
      <PageNumber>${currentPage}</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

        const resp = await fetch("https://api.ebay.com/ws/api.dll", {
          method: "POST",
          headers: {
            "X-EBAY-API-SITEID": "15",
            "X-EBAY-API-COMPATIBILITY-LEVEL": "1155",
            "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
            "X-EBAY-API-IAF-TOKEN": accessToken,
            "Content-Type": "text/xml",
          },
          body: xmlBody,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
          errorMsg = `eBay Trading API error: ${resp.status}`;
          partial = items.length > 0;
          break;
        }

        const xml = await resp.text();

        // Check for API-level errors
        const ackMatch = xml.match(/<Ack>(.*?)<\/Ack>/);
        if (ackMatch && ackMatch[1] === "Failure") {
          const errMsg = xml.match(/<ShortMessage>(.*?)<\/ShortMessage>/);
          errorMsg = `eBay error: ${errMsg?.[1] || "Unknown error"}`;
          partial = items.length > 0;
          break;
        }

        // Parse pagination
        const totalPagesMatch = xml.match(/<ActiveList>[\s\S]*?<PaginationResult>[\s\S]*?<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/);
        const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1]) : 1;

        // Extract items using regex (predictable XML structure)
        const itemRegex = /<Item>([\s\S]*?)<\/Item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
          const itemXml = match[1];
          const extract = (tag: string) => {
            const m = itemXml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
            return m ? m[1].trim() : null;
          };

          const itemId = extract("ItemID") || "";
          const sku = extract("SKU") || "";
          const title = extract("Title") || "Unknown";
          const quantityAvailable = parseInt(extract("QuantityAvailable") || "0");
          const currentPrice = extract("CurrentPrice");
          const priceVal = currentPrice ? parseFloat(currentPrice.replace(/[^0-9.]/g, "")) : null;
          const viewItemURL = extract("ViewItemURL") || null;
          const galleryURL = extract("GalleryURL") || null;

          items.push({
            item_id: itemId,
            sku: sku || itemId,
            has_sku: sku !== "",
            title,
            quantity: quantityAvailable,
            price: priceVal,
            listing_status: "Active",
            url: viewItemURL,
            thumbnail: galleryURL,
            updated_at: null,
          });
        }

        if (currentPage < totalPages && items.length < limit) {
          currentPage++;
        } else {
          if (currentPage < totalPages) {
            hasMore = true;
            nextCursor = String(currentPage + 1);
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
