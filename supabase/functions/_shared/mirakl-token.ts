/**
 * Shared Mirakl token helper.
 *
 * Mirakl has TWO auth modes:
 * 1. OAuth2 (client_credentials via https://auth.mirakl.net/oauth/token)
 *    → Returns Bearer token, valid ~1 hour
 *    → Used for Connect APIs AND some Marketplace APIs
 *
 * 2. API Key (direct key in Authorization header)
 *    → Static key from Mirakl portal
 *    → Some sellers/marketplaces only support this
 *
 * Each connection stores `auth_mode` = 'oauth' | 'api_key' | 'both'
 * and optional `auth_header_type` = 'bearer' | 'authorization' | 'x-api-key'
 * This helper returns the correct header name + value based on mode.
 *
 * Header variants (varies by marketplace):
 *   - bearer       → Authorization: Bearer <token>   (default for OAuth)
 *   - authorization → Authorization: <api_key>       (default for API key)
 *   - x-api-key    → X-API-KEY: <api_key>            (some legacy Mirakl instances)
 */

export interface MiraklAuthResult {
  headerName: string;
  headerValue: string;
}

interface MiraklTokenRow {
  id: string;
  base_url: string;
  client_id: string;
  client_secret: string;
  seller_company_id: string;
  access_token: string | null;
  expires_at: string | null;
  api_key: string | null;
  auth_mode: string; // 'oauth' | 'api_key' | 'both'
  auth_header_type: string | null; // 'bearer' | 'authorization' | 'x-api-key' | null
}

/**
 * Returns the correct header name + value for Marketplace API calls.
 *
 * - auth_mode='api_key' → returns api_key with appropriate header
 * - auth_mode='oauth' → returns 'Bearer <token>' (refreshing if needed)
 * - auth_mode='both' → prefers OAuth Bearer, falls back to api_key
 *
 * Header format is determined by auth_header_type (if set), otherwise:
 *   oauth → bearer (Authorization: Bearer <token>)
 *   api_key → authorization (Authorization: <key>)
 */
export async function getMiraklAuthHeader(
  adminClient: any,
  row: MiraklTokenRow,
): Promise<MiraklAuthResult> {
  const mode = row.auth_mode || "oauth";

  if (mode === "api_key") {
    if (!row.api_key) {
      throw new Error(`[mirakl-token] auth_mode=api_key but no api_key set for ${row.base_url}`);
    }
    return buildApiKeyResult(row.api_key, row.auth_header_type);
  }

  // OAuth or both — try OAuth first
  try {
    const bearerToken = await refreshOAuthToken(adminClient, row);
    return { headerName: "Authorization", headerValue: `Bearer ${bearerToken}` };
  } catch (err) {
    // If mode='both', fall back to API key
    if (mode === "both" && row.api_key) {
      console.warn(`[mirakl-token] OAuth failed for ${row.base_url}, falling back to API key`);
      return buildApiKeyResult(row.api_key, row.auth_header_type);
    }
    throw err;
  }
}

/**
 * Builds the header result for API key auth based on auth_header_type.
 *
 * - 'x-api-key' → X-API-KEY: <key>
 * - 'bearer' → Authorization: Bearer <key>  (unusual but some marketplaces)
 * - 'authorization' | null → Authorization: <key>  (default)
 */
function buildApiKeyResult(apiKey: string, headerType: string | null): MiraklAuthResult {
  switch (headerType) {
    case "x-api-key":
      return { headerName: "X-API-KEY", headerValue: apiKey };
    case "bearer":
      return { headerName: "Authorization", headerValue: `Bearer ${apiKey}` };
    case "authorization":
    default:
      return { headerName: "Authorization", headerValue: apiKey };
  }
}

/**
 * Refreshes the OAuth2 token via https://auth.mirakl.net/oauth/token
 * Returns the raw access_token string (without "Bearer" prefix).
 */
async function refreshOAuthToken(
  adminClient: any,
  row: MiraklTokenRow,
): Promise<string> {
  // Check if token is still valid (with 5-minute buffer)
  if (row.access_token && row.expires_at) {
    const expiresAt = new Date(row.expires_at);
    const bufferMs = 5 * 60 * 1000;
    if (expiresAt.getTime() - Date.now() > bufferMs) {
      return row.access_token;
    }
  }

  // OAuth2 client_credentials grant via centralized Mirakl auth endpoint
  const tokenUrl = "https://auth.mirakl.net/oauth/token";

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: row.client_id,
      client_secret: row.client_secret,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(
      `[mirakl-token] OAuth token request failed (${res.status}): ${errorText.slice(0, 200)}`
    );
  }

  const data = await res.json();
  const newToken = data.access_token;
  const expiresIn = data.expires_in || 3599;
  const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Update DB with fresh token
  await adminClient
    .from("mirakl_tokens")
    .update({
      access_token: newToken,
      expires_at: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return newToken;
}

// ── Legacy aliases (backward compat) ──

/** @deprecated Use getMiraklAuthHeader() instead */
export function getMiraklApiKey(row: MiraklTokenRow): string {
  if (row.api_key) return row.api_key;
  return row.client_secret; // legacy fallback
}

/** @deprecated Use getMiraklAuthHeader() instead */
export async function getValidMiraklToken(
  adminClient: any,
  row: MiraklTokenRow,
): Promise<MiraklAuthResult> {
  return getMiraklAuthHeader(adminClient, row);
}

/** @deprecated Use getMiraklAuthHeader() instead */
export async function getValidMiraklConnectToken(
  adminClient: any,
  row: MiraklTokenRow,
): Promise<string> {
  return refreshOAuthToken(adminClient, row);
}
