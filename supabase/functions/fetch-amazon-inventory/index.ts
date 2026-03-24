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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tokenRow } = await supabase
      .from("amazon_tokens")
      .select("access_token, refresh_token, expires_at, region, selling_partner_id, marketplace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!tokenRow) {
      return new Response(JSON.stringify({ items: [], hasMore: false, partial: false, error: "Amazon SP-API not connected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For Phase 1, return placeholder since SP-API inventory requires approved roles
    // The actual SP-API calls (GET /fba/inventory/v1/summaries) need 'FBA Inventory' role
    const items: any[] = [];
    const partial = false;
    const errorMsg = undefined;

    return new Response(JSON.stringify({
      items,
      hasMore: false,
      partial,
      error: errorMsg || "Amazon inventory API integration pending SP-API role approval. Settlement reconciliation works independently.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ items: [], hasMore: false, partial: false, error: err.message }), {
      status: err.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
