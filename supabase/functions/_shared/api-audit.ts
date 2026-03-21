import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Lightweight API call audit logger for SP-API approval compliance.
 * Fire-and-forget: logs every external API call with timing, status, and rate limit info.
 * No PII is stored — only endpoint paths, order IDs, and status codes.
 */

interface ApiCallLogEntry {
  user_id: string
  integration: string       // 'amazon_sp_api' | 'shopify' | 'amazon_lwa'
  endpoint: string          // e.g. '/orders/v2026-01-01/orders'
  method: string            // 'GET' | 'POST'
  status_code: number
  latency_ms: number
  request_context?: Record<string, any>  // marketplace_id, order_id, page (NO PII)
  error_summary?: string | null
  rate_limit_remaining?: number | null
}

/**
 * Log an API call to the api_call_log table (fire-and-forget).
 * Uses service role client — do not await in hot path if latency matters.
 */
export async function logApiCall(entry: ApiCallLogEntry): Promise<void> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    await supabase.from('api_call_log').insert({
      user_id: entry.user_id,
      integration: entry.integration,
      endpoint: entry.endpoint,
      method: entry.method,
      status_code: entry.status_code,
      latency_ms: entry.latency_ms,
      request_context: entry.request_context || {},
      error_summary: entry.error_summary || null,
      rate_limit_remaining: entry.rate_limit_remaining ?? null,
    } as any)
  } catch (err) {
    // Non-fatal — never let audit logging break the main flow
    console.warn('api_audit_log_failed', (err as Error).message)
  }
}

/**
 * Helper: wrap a fetch call with audit logging.
 * Returns the Response and logs timing + status automatically.
 */
export async function auditedFetch(
  url: string,
  init: RequestInit,
  meta: {
    user_id: string
    integration: string
    context?: Record<string, any>
  },
): Promise<Response> {
  const startMs = Date.now()
  let response: Response

  try {
    response = await fetch(url, init)
  } catch (err) {
    const latency = Date.now() - startMs
    // Extract endpoint path from URL
    const endpoint = extractEndpoint(url)
    logApiCall({
      user_id: meta.user_id,
      integration: meta.integration,
      endpoint,
      method: init.method || 'GET',
      status_code: 0,
      latency_ms: latency,
      request_context: meta.context,
      error_summary: (err as Error).message?.substring(0, 200),
    }).catch(() => {}) // fire-and-forget
    throw err
  }

  const latency = Date.now() - startMs
  const endpoint = extractEndpoint(url)

  // Extract rate limit header (Amazon SP-API specific)
  const rateLimitRemaining = parseRateLimitHeader(response)

  // Capture error summary for non-2xx responses
  let errorSummary: string | null = null
  if (!response.ok) {
    // Clone so the caller can still read the body
    const cloned = response.clone()
    try {
      const text = await cloned.text()
      errorSummary = text.substring(0, 200)
    } catch {
      errorSummary = `HTTP ${response.status}`
    }
  }

  logApiCall({
    user_id: meta.user_id,
    integration: meta.integration,
    endpoint,
    method: init.method || 'GET',
    status_code: response.status,
    latency_ms: latency,
    request_context: meta.context,
    error_summary: errorSummary,
    rate_limit_remaining: rateLimitRemaining,
  }).catch(() => {}) // fire-and-forget

  return response
}

/**
 * Extract a clean endpoint path from a full URL.
 * Strips the domain, keeps the path.
 */
function extractEndpoint(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname + (parsed.search ? '?' + summarizeParams(parsed.searchParams) : '')
  } catch {
    return url.substring(0, 200)
  }
}

/**
 * Summarize query params without exposing tokens.
 * Keeps param keys but truncates long values.
 */
function summarizeParams(params: URLSearchParams): string {
  const parts: string[] = []
  for (const [key, value] of params) {
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
      parts.push(`${key}=***`)
    } else {
      parts.push(`${key}=${value.substring(0, 50)}`)
    }
  }
  return parts.join('&')
}

/**
 * Parse rate limit remaining from response headers.
 * Supports Amazon SP-API (x-amzn-RateLimit-Remaining) and Shopify (X-Shopify-Shop-Api-Call-Limit).
 */
function parseRateLimitHeader(response: Response): number | null {
  // Amazon SP-API
  const amazonLimit = response.headers.get('x-amzn-RateLimit-Remaining')
  if (amazonLimit) {
    const parsed = parseFloat(amazonLimit)
    if (!isNaN(parsed)) return Math.round(parsed * 100) / 100
  }

  // Shopify: "32/40" format → remaining = 40 - 32 = 8
  const shopifyLimit = response.headers.get('X-Shopify-Shop-Api-Call-Limit')
  if (shopifyLimit) {
    const [used, max] = shopifyLimit.split('/').map(Number)
    if (!isNaN(used) && !isNaN(max)) return max - used
  }

  return null
}
