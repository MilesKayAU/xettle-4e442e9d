/**
 * Shared Mirakl token helper.
 *
 * Mirakl has TWO auth modes:
 * 1. Connect APIs (OAuth2 client_credentials via https://auth.mirakl.net/oauth/token)
 * 2. Marketplace APIs (direct API key in Authorization header)
 *
 * The TL (transaction log) endpoints are Marketplace APIs and use the API key
 * directly. The Connect APIs use OAuth2 Bearer tokens.
 *
 * This helper returns the appropriate token/key based on the API being called.
 */

interface MiraklTokenRow {
  id: string;
  base_url: string;
  client_id: string;
  client_secret: string;
  seller_company_id: string;
  access_token: string | null;
  expires_at: string | null;
}

/**
 * Returns the API key for Marketplace APIs (TL endpoints).
 * Mirakl Marketplace APIs use direct API key auth, NOT OAuth Bearer tokens.
 * The API key is stored as `client_secret` in the mirakl_tokens table.
 */
export function getMiraklApiKey(row: MiraklTokenRow): string {
  return row.client_secret;
}

/**
 * Returns a valid OAuth2 Bearer token for Mirakl Connect APIs.
 * Uses the centralized auth endpoint: https://auth.mirakl.net/oauth/token
 * Refreshes if expired (with 5-minute buffer).
 */
export async function getValidMiraklConnectToken(
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

  try {
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
      console.warn(`[mirakl-token] OAuth failed (${res.status}) — Connect APIs may not be available`);
      throw new Error(`OAuth token request failed: ${res.status}`);
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
  } catch (err) {
    console.error(`[mirakl-token] Connect token refresh failed:`, err);
    // If we have a cached token, try it
    if (row.access_token) return row.access_token;
    throw err;
  }
}

/**
 * @deprecated Use getMiraklApiKey() for Marketplace APIs or getValidMiraklConnectToken() for Connect APIs.
 */
export async function getValidMiraklToken(
  adminClient: any,
  row: MiraklTokenRow,
): Promise<string> {
  // For backward compat, return the API key (most callers use Marketplace APIs)
  return getMiraklApiKey(row);
}
