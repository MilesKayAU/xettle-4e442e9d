/**
 * Centralised CORS helper for all Xettle edge functions.
 *
 * Every function imports:
 *   import { getCorsHeaders } from "../_shared/cors.ts"
 *
 * Usage:
 *   const origin = req.headers.get("Origin") ?? ""
 *   const headers = getCorsHeaders(origin)
 *
 *   if (req.method === "OPTIONS") {
 *     return new Response("ok", { headers })
 *   }
 *
 *   return new Response(body, {
 *     headers: { ...headers, "Content-Type": "application/json" },
 *   })
 */

const ALLOWED_ORIGINS = [
  "https://xettle.app",
  "https://www.xettle.app",
  "https://xettle.com.au",
  "https://www.xettle.com.au",
  "https://xettle.lovable.app",
  "https://id-preview--7fd99b7a-85b4-49c3-9197-4e0e88f0fa66.lovable.app",
  "https://7fd99b7a-85b4-49c3-9197-4e0e88f0fa66.lovableproject.com",
  "http://localhost:5173",
  "http://localhost:3000",
]

export function getCorsHeaders(origin?: string): Record<string, string> {
  if (!origin) return {}

  if (ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-action, x-redirect-uri",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Credentials": "true",
    }
  }

  return {}
}
