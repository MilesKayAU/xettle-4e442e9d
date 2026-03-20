/**
 * Centralised CORS helper for all Xettle edge functions.
 *
 * Production domains are always allowed.
 * Additional origins can be added via CORS_ALLOWED_ORIGINS env var (comma-separated).
 * Localhost origins are only allowed when CORS_ALLOW_LOCALHOST env var is "true".
 */

const PRODUCTION_ORIGINS = [
  "https://xettle.app",
  "https://www.xettle.app",
  "https://xettle.com.au",
  "https://www.xettle.com.au",
  "https://xettle.lovable.app",
  "https://id-preview--7fd99b7a-85b4-49c3-9197-4e0e88f0fa66.lovable.app",
  "https://7fd99b7a-85b4-49c3-9197-4e0e88f0fa66.lovableproject.com",
]

const LOCALHOST_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
]

function buildAllowedOrigins(): string[] {
  const origins = [...PRODUCTION_ORIGINS]

  // Include localhost only when explicitly opted in
  const allowLocalhost = Deno.env.get("CORS_ALLOW_LOCALHOST")
  if (allowLocalhost === "true") {
    origins.push(...LOCALHOST_ORIGINS)
  }

  // Append any extra origins from env (comma-separated)
  const extra = Deno.env.get("CORS_ALLOWED_ORIGINS")
  if (extra) {
    for (const o of extra.split(",")) {
      const trimmed = o.trim()
      if (trimmed && !origins.includes(trimmed)) {
        origins.push(trimmed)
      }
    }
  }

  return origins
}

export function getCorsHeaders(origin?: string): Record<string, string> {
  if (!origin) return {}

  const allowed = buildAllowedOrigins()

  if (allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-action, x-redirect-uri, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Credentials": "true",
    }
  }

  return {}
}
