import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader } from "../_shared/mirakl-token.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { userId } = await verifyRequest(req);
    const action = req.headers.get("x-action") || "status";

    // ─── CONNECT ─────────────────────────────────────────────────
    if (action === "connect") {
      const body = await req.json();
      const {
        base_url, client_id, client_secret,
        api_key, auth_mode, auth_header_type,
        seller_company_id, marketplace_label,
      } = body;

      if (!base_url) {
        return new Response(
          JSON.stringify({ error: "Missing required field: base_url" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const effectiveSellerCompanyId = seller_company_id || "default";

      const mode = auth_mode || "oauth";

      // Validate required fields per auth mode
      if ((mode === "oauth" || mode === "both") && (!client_id || !client_secret)) {
        return new Response(
          JSON.stringify({ error: "OAuth mode requires client_id and client_secret" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if ((mode === "api_key" || mode === "both") && !api_key) {
        return new Response(
          JSON.stringify({ error: "API key mode requires api_key" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Upsert credentials
      const { error: upsertErr } = await adminClient
        .from("mirakl_tokens")
        .upsert(
          {
            user_id: userId,
            base_url: base_url.replace(/\/$/, ""),
            client_id: client_id || "",
            client_secret: client_secret || "",
            api_key: api_key || null,
            auth_mode: mode,
            auth_header_type: auth_header_type || null,
            seller_company_id: effectiveSellerCompanyId,
            marketplace_label: marketplace_label || "Bunnings",
            access_token: null,
            expires_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,base_url,seller_company_id" },
        );

      if (upsertErr) throw upsertErr;

      // Verify connection by testing auth
      const { data: row } = await adminClient
        .from("mirakl_tokens")
        .select("*")
        .eq("user_id", userId)
        .eq("base_url", base_url.replace(/\/$/, ""))
        .eq("seller_company_id", effectiveSellerCompanyId)

      if (row) {
        try {
          await getMiraklAuthHeader(adminClient, row);
        } catch (tokenErr: any) {
          // Credentials saved but auth verification failed — warn but don't block
          console.warn("[mirakl-auth] Auth verification failed:", tokenErr.message);
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: "Mirakl connection saved" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── STATUS ──────────────────────────────────────────────────
    if (action === "status") {
      const { data: rows } = await adminClient
        .from("mirakl_tokens")
        .select("id, marketplace_label, base_url, seller_company_id, auth_mode, auth_header_type, updated_at, expires_at")
        .eq("user_id", userId);

      const connections = (rows || []).map((r: any) => ({
        id: r.id,
        marketplace_label: r.marketplace_label,
        base_url: r.base_url,
        seller_company_id: r.seller_company_id,
        auth_mode: r.auth_mode || "oauth",
        auth_header_type: r.auth_header_type || null,
        updated_at: r.updated_at,
        has_token: !!r.expires_at,
      }));

      return new Response(
        JSON.stringify({
          connected: connections.length > 0,
          connections,
          // Legacy single-connection shape for simple UIs
          connection: connections[0] || null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── DISCONNECT ──────────────────────────────────────────────
    if (action === "disconnect") {
      const body = await req.json().catch(() => ({}));
      const { connection_id } = body as any;

      if (connection_id) {
        await adminClient.from("mirakl_tokens").delete().eq("id", connection_id).eq("user_id", userId);
      } else {
        // Delete all Mirakl connections for this user
        await adminClient.from("mirakl_tokens").delete().eq("user_id", userId);
      }

      return new Response(
        JSON.stringify({ success: true, message: "Mirakl connection removed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[mirakl-auth] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: err.message?.includes("Forbidden") ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
