/**
 * Shared Mirakl OAuth token helper.
 *
 * Mirakl uses client_credentials grant. This helper checks expiry,
 * refreshes if needed, and updates the DB row.
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
 * Returns a valid Mirakl access token, refreshing if expired.
 * Some Mirakl instances use API-key auth instead of OAuth —
 * in that case, `client_secret` acts as the static API key
 * and we skip the token refresh.
 */
export async function getValidMiraklToken(
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

  // Attempt OAuth token refresh
  const tokenUrl = `${row.base_url.replace(/\/$/, '')}/oauth/token`;

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: row.client_id,
        client_secret: row.client_secret,
      }),
    });

    if (!res.ok) {
      // If OAuth endpoint doesn't exist, fall back to API-key mode
      // (client_secret IS the API key)
      console.warn(`[mirakl-token] OAuth failed (${res.status}) for ${row.base_url} — using client_secret as API key`);
      return row.client_secret;
    }

    const data = await res.json();
    const newToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Update DB
    await adminClient
      .from('mirakl_tokens')
      .update({
        access_token: newToken,
        expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    return newToken;
  } catch (err) {
    console.error(`[mirakl-token] Token refresh failed for ${row.base_url}:`, err);
    // Fall back to client_secret as API key
    if (row.access_token) return row.access_token;
    return row.client_secret;
  }
}
