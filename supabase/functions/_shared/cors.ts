/**
 * Centralised CORS helper for all Xettle edge functions.
 *
 * Configuration (env vars):
 *   CORS_ALLOWED_ORIGINS  — comma-separated list of exact origins (no trailing slash).
 *                           Defaults to the production allow-list below.
 *   CORS_ALLOW_LOCALHOST  — set to "true" to also accept http://localhost:* and
 *                           http://127.0.0.1:* (dev only).
 *
 * Adding a new production domain (e.g. https://xettle.com) only requires
 * updating CORS_ALLOWED_ORIGINS — no code change needed.
 */

const DEFAULT_ORIGINS = [
  'https://xettle.app',
  'https://www.xettle.app',
  'https://xettle.com.au',
  'https://www.xettle.com.au',
  'https://xettle.lovable.app',
  'https://id-preview--7fd99b7a-85b4-49c3-9197-4e0e88f0fa66.lovable.app',
];

const ALLOWED_HEADERS = [
  'authorization',
  'x-client-info',
  'apikey',
  'content-type',
  'x-action',
  'x-redirect-uri',
  'x-supabase-client-platform',
  'x-supabase-client-platform-version',
  'x-supabase-client-runtime',
  'x-supabase-client-runtime-version',
].join(', ');

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get('CORS_ALLOWED_ORIGINS');
  const origins = envOrigins
    ? envOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [...DEFAULT_ORIGINS];

  return origins;
}

function isLocalhostAllowed(): boolean {
  return Deno.env.get('CORS_ALLOW_LOCALHOST') === 'true';
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string): boolean {
  if (getAllowedOrigins().includes(origin)) return true;
  if (isLocalhostAllowed() && isLocalhostOrigin(origin)) return true;
  return false;
}

/**
 * Returns CORS headers for the given request.
 *
 * - If no Origin header is present (server-to-server), returns minimal headers
 *   without Access-Control-Allow-Origin so the response is not blocked.
 * - If Origin is allowed, echoes it back.
 * - If Origin is not allowed, does NOT set Access-Control-Allow-Origin.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');

  // No Origin header → server-to-server; return minimal headers
  if (!origin) {
    return {
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
    };
  }

  if (isOriginAllowed(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
    };
  }

  // Origin not allowed — omit ACAO
  return {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
  };
}

/**
 * Handles OPTIONS preflight requests.
 *
 * Returns a Response for OPTIONS requests:
 *   - 204 with CORS headers if origin is allowed (or absent)
 *   - 403 JSON error if origin is not allowed
 *
 * Returns null for non-OPTIONS requests (caller should proceed normally).
 */
export function handleCorsPreflightResponse(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;

  const origin = req.headers.get('Origin');

  if (!origin || isOriginAllowed(origin)) {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(req),
    });
  }

  // Disallowed origin
  return new Response(
    JSON.stringify({ error: 'Origin not allowed', origin }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
