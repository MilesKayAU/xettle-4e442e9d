import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyRequest } from "../_shared/auth-guard.ts";
import { getMiraklAuthHeader } from "../_shared/mirakl-token.ts";

// ═══════════════════════════════════════════════════════════════
// CREDENTIAL VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════

/** Known patterns that indicate a password was entered instead of an API key */
const PASSWORD_PATTERNS = [
  /[A-Z].*[a-z].*\d.*[!@#$%^&*]/, // Mixed case + digit + special char (typical password)
  /^.{6,20}$/, // Short strings that are password-length but not UUID
];

/** UUID v4 format — standard Mirakl API key format */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hex string (some Mirakl instances use plain hex keys) */
const HEX_KEY_REGEX = /^[0-9a-f]{32,64}$/i;

interface CredentialDiagnostic {
  valid: boolean;
  error?: string;
  warning?: string;
  suggestion?: string;
}

function validateApiKeyFormat(apiKey: string): CredentialDiagnostic {
  if (!apiKey || apiKey.trim().length === 0) {
    return { valid: false, error: "API key is empty" };
  }

  const trimmed = apiKey.trim();

  // Check if it looks like a UUID (standard Mirakl API key)
  if (UUID_REGEX.test(trimmed)) {
    return { valid: true };
  }

  // Check if it's a hex key (some Mirakl instances)
  if (HEX_KEY_REGEX.test(trimmed)) {
    return { valid: true, warning: "Key format is non-standard hex — will attempt to use it" };
  }

  // Check if it looks like a password (contains spaces, special chars typical of passwords)
  if (trimmed.includes(" ")) {
    return {
      valid: false,
      error: "This looks like a password, not an API key. Mirakl API keys are UUID format (e.g. bfb2d8a3-914b-4d8e-828b-3d75199754c5).",
      suggestion: "Go to your seller portal → My Settings → API Key tab → Generate a new API key",
    };
  }

  // Check common password patterns
  const hasUpper = /[A-Z]/.test(trimmed);
  const hasLower = /[a-z]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const hasSpecial = /[!@#$%^&*()_+=\[\]{};':"\\|,.<>?/~`]/.test(trimmed);
  const passwordLike = hasUpper && hasLower && hasDigit && hasSpecial && trimmed.length < 40;

  if (passwordLike) {
    return {
      valid: false,
      error: `This value looks like a password (starts with "${trimmed.slice(0, 4)}..."), not a Mirakl API key. API keys are UUID format like bfb2d8a3-914b-4d8e-828b-3d75199754c5.`,
      suggestion: "Go to your seller portal → My Settings → API Key tab → Generate a new API key",
    };
  }

  // If it doesn't match known formats but isn't obviously a password, warn but allow
  if (trimmed.length < 20) {
    return {
      valid: false,
      error: `Value is too short (${trimmed.length} chars) to be a valid API key. Mirakl API keys are typically UUID format (36 chars).`,
      suggestion: "Go to your seller portal → My Settings → API Key tab and copy the full key",
    };
  }

  // Unknown format but reasonable length — allow with warning
  return { valid: true, warning: "API key format is non-standard but will be tested against the API" };
}

/**
 * Live API test — actually call the Mirakl API with the credentials
 * to verify they work before saving.
 */
async function testMiraklCredentials(
  baseUrl: string,
  headerName: string,
  headerValue: string,
): Promise<{ ok: boolean; status?: number; error?: string; diagnostic?: string }> {
  const testUrl = `${baseUrl.replace(/\/$/, "")}/api/version`;

  try {
    const res = await fetch(testUrl, {
      headers: {
        [headerName]: headerValue,
        Accept: "application/json",
      },
    });

    if (res.ok) {
      return { ok: true, status: res.status };
    }

    const errorBody = await res.text().catch(() => "");

    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        error: "API key was rejected by the marketplace (401 Unauthorized)",
        diagnostic: `The marketplace at ${baseUrl} rejected these credentials. Please verify: 1) The API key is correct (not your login password), 2) The key hasn't been revoked or expired, 3) You copied the full key from your seller portal → My Settings → API Key tab.`,
      };
    }

    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        error: "API key has insufficient permissions (403 Forbidden)",
        diagnostic: "The key exists but doesn't have the required scopes. Generate a new key with full seller API access.",
      };
    }

    return {
      ok: false,
      status: res.status,
      error: `Marketplace returned HTTP ${res.status}: ${errorBody.slice(0, 200)}`,
    };
  } catch (err: any) {
    if (err.message?.includes("dns") || err.message?.includes("ENOTFOUND")) {
      return {
        ok: false,
        error: `Cannot reach ${baseUrl} — check the URL is correct`,
        diagnostic: "DNS lookup failed. The base URL may be wrong.",
      };
    }
    return {
      ok: false,
      error: `Connection failed: ${err.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════

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

      // ─── CREDENTIAL FORMAT VALIDATION ───
      if (api_key && (mode === "api_key" || mode === "both")) {
        const formatCheck = validateApiKeyFormat(api_key);
        if (!formatCheck.valid) {
          // Log the rejection
          await adminClient.from("system_events").insert({
            user_id: userId,
            event_type: "mirakl_credential_format_rejected",
            severity: "warning",
            marketplace_code: (marketplace_label || "bunnings").toLowerCase().replace(/\s+/g, "_"),
            details: {
              error: formatCheck.error,
              suggestion: formatCheck.suggestion,
              key_prefix: api_key.slice(0, 4) + "...",
              key_length: api_key.length,
            },
          });

          return new Response(
            JSON.stringify({
              error: formatCheck.error,
              suggestion: formatCheck.suggestion,
              validation: "format_check_failed",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // ─── LIVE API TEST before saving ───
      // Build the auth header we'd use, then test it
      let liveTestResult: Awaited<ReturnType<typeof testMiraklCredentials>> | null = null;

      if (mode === "api_key" || mode === "both") {
        const headerType = auth_header_type || null;
        let testHeaderName: string;
        let testHeaderValue: string;

        switch (headerType) {
          case "x-api-key":
            testHeaderName = "X-API-KEY";
            testHeaderValue = api_key;
            break;
          case "bearer":
            testHeaderName = "Authorization";
            testHeaderValue = `Bearer ${api_key}`;
            break;
          case "authorization":
          default:
            testHeaderName = "Authorization";
            testHeaderValue = api_key;
            break;
        }

        liveTestResult = await testMiraklCredentials(
          base_url.replace(/\/$/, ""),
          testHeaderName,
          testHeaderValue,
        );

        if (!liveTestResult.ok) {
          // Log the failure
          await adminClient.from("system_events").insert({
            user_id: userId,
            event_type: "mirakl_credential_live_test_failed",
            severity: "warning",
            marketplace_code: (marketplace_label || "bunnings").toLowerCase().replace(/\s+/g, "_"),
            details: {
              status: liveTestResult.status,
              error: liveTestResult.error,
              diagnostic: liveTestResult.diagnostic,
              base_url: base_url,
              auth_mode: mode,
            },
          });

          return new Response(
            JSON.stringify({
              error: liveTestResult.error,
              diagnostic: liveTestResult.diagnostic,
              validation: "live_test_failed",
              status_code: liveTestResult.status,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // ─── Credentials validated — save to DB ───
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

      // Create marketplace_connections row
      const effectiveMarketplaceCode = body.marketplace_code || (marketplace_label || "bunnings").toLowerCase().replace(/\s+/g, "_");
      await adminClient
        .from("marketplace_connections")
        .upsert(
          {
            user_id: userId,
            marketplace_code: effectiveMarketplaceCode,
            marketplace_name: marketplace_label || "Bunnings",
            connection_type: "mirakl_api",
            connection_status: "active",
            country_code: "AU",
          },
          { onConflict: "user_id,marketplace_code" },
        );

      // Log successful connection
      await adminClient.from("system_events").insert({
        user_id: userId,
        event_type: "mirakl_connection_verified",
        severity: "info",
        marketplace_code: effectiveMarketplaceCode,
        details: {
          base_url,
          auth_mode: mode,
          api_test_status: liveTestResult?.status || "skipped",
          marketplace_label: marketplace_label || "Bunnings",
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "Mirakl connection verified and saved",
          api_test: liveTestResult ? { status: liveTestResult.status, ok: true } : null,
        }),
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
          connection: connections[0] || null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── HEALTH CHECK ────────────────────────────────────────────
    // New action: test existing stored credentials without re-saving
    if (action === "health") {
      const { data: rows } = await adminClient
        .from("mirakl_tokens")
        .select("*")
        .eq("user_id", userId);

      if (!rows || rows.length === 0) {
        return new Response(
          JSON.stringify({ healthy: false, error: "No Mirakl connections found" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const results: any[] = [];
      for (const row of rows) {
        // Format check on stored key
        const formatDiag = row.api_key ? validateApiKeyFormat(row.api_key) : { valid: true };

        // Live API test
        try {
          const authResult = await getMiraklAuthHeader(adminClient, row);
          const liveTest = await testMiraklCredentials(
            row.base_url.replace(/\/$/, ""),
            authResult.headerName,
            authResult.headerValue,
          );

          results.push({
            marketplace_label: row.marketplace_label,
            base_url: row.base_url,
            format_valid: formatDiag.valid,
            format_error: formatDiag.error || null,
            api_reachable: liveTest.ok,
            api_status: liveTest.status,
            api_error: liveTest.error || null,
            api_diagnostic: liveTest.diagnostic || null,
            healthy: formatDiag.valid && liveTest.ok,
          });
        } catch (authErr: any) {
          results.push({
            marketplace_label: row.marketplace_label,
            base_url: row.base_url,
            format_valid: formatDiag.valid,
            format_error: formatDiag.error || null,
            api_reachable: false,
            api_error: authErr.message,
            healthy: false,
          });
        }
      }

      const allHealthy = results.every((r) => r.healthy);

      return new Response(
        JSON.stringify({ healthy: allHealthy, connections: results }),
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
