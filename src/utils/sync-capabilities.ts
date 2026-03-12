/**
 * sync-capabilities.ts — Universal capability detection for adaptive sync.
 * Checks which APIs/data sources exist before running any scan functions.
 */

import { supabase } from '@/integrations/supabase/client';

export interface SyncCapabilities {
  hasXero: boolean;
  hasAmazon: boolean;
  hasShopify: boolean;
  hasSettlements: boolean;
  hasShopifyOrders: boolean;
  shopDomain: string | null;
  userId: string | null;
  accessToken: string | null;
}

export async function detectCapabilities(): Promise<SyncCapabilities> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { hasXero: false, hasAmazon: false, hasShopify: false, hasSettlements: false, hasShopifyOrders: false, shopDomain: null, userId: null, accessToken: null };
  }

  const [xeroRes, amazonRes, shopifyRes, settRes, ordersRes] = await Promise.all([
    supabase.from('xero_tokens').select('id').limit(1),
    supabase.from('amazon_tokens').select('id').limit(1),
    supabase.from('shopify_tokens').select('shop_domain').limit(1),
    supabase.from('settlements').select('id').limit(1),
    supabase.from('shopify_orders').select('id').limit(1),
  ]);

  return {
    hasXero: !!(xeroRes.data && xeroRes.data.length > 0),
    hasAmazon: !!(amazonRes.data && amazonRes.data.length > 0),
    hasShopify: !!(shopifyRes.data && shopifyRes.data.length > 0),
    hasSettlements: !!(settRes.data && settRes.data.length > 0),
    hasShopifyOrders: !!(ordersRes.data && ordersRes.data.length > 0),
    shopDomain: shopifyRes.data?.[0]?.shop_domain ?? null,
    userId: session.user.id,
    accessToken: session.access_token,
  };
}

export interface ScanStepResult {
  step: string;
  status: 'success' | 'skipped' | 'error';
  message: string;
  detail?: string;
}

export interface EdgeCallResult {
  ok: boolean;
  data?: any;
  error?: string;
  aborted?: boolean;
  statusCode?: number;
  rateLimited?: boolean;
}

/**
 * Calls an edge function with proper error handling.
 * Returns a structured result instead of silently swallowing errors.
 */
export async function callEdgeFunctionSafe(
  name: string,
  accessToken: string,
  body: Record<string, unknown> = {},
  options?: { signal?: AbortSignal; headers?: Record<string, string> },
): Promise<EdgeCallResult> {
  try {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const controller = new AbortController();
    const timeoutMs = name === 'scan-xero-history' ? 180000 : name === 'fetch-shopify-orders' ? 60000 : name === 'fetch-amazon-settlements' ? 120000 : 45000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // If an external signal is provided, listen for it to abort early
    const externalSignal = options?.signal;
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeout);
        return { ok: false, error: 'Stopped by user', aborted: true };
      }
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/${name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          ...(options?.headers || {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      const isRateLimited = res.status === 429 || res.status === 503;
      console.warn(`[sync] ${name} returned ${res.status}:`, text);
      return {
        ok: false,
        error: isRateLimited ? 'Temporarily unavailable — will retry automatically' : 'Temporarily unavailable',
        statusCode: res.status,
        rateLimited: isRateLimited,
      };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // Check if it was user-initiated vs timeout
      if (options?.signal?.aborted) {
        console.warn(`[sync] ${name} stopped by user`);
        return { ok: false, error: 'Stopped by user', aborted: true };
      }
      console.warn(`[sync] ${name} timed out`);
      return { ok: false, error: 'Taking longer than expected — will retry automatically' };
    }
    console.error(`[sync] ${name} error:`, err);
    return { ok: false, error: err.message || `${name} failed` };
  }
}

/**
 * Generates a human-readable summary of sync results.
 */
export function buildSyncSummary(
  caps: SyncCapabilities,
  results: ScanStepResult[],
): string {
  const successful = results.filter(r => r.status === 'success');
  const skipped = results.filter(r => r.status === 'skipped');
  const failed = results.filter(r => r.status === 'error');

  const parts: string[] = [];

  for (const r of successful) {
    parts.push(r.message);
  }

  if (failed.length > 0) {
    parts.push(`⚠️ ${failed.length} step${failed.length > 1 ? 's' : ''} had issues`);
  }

  // Suggestions for missing connections
  const suggestions: string[] = [];
  if (!caps.hasAmazon) suggestions.push('Connect Amazon to auto-fetch settlements');
  if (!caps.hasShopify) suggestions.push('Connect Shopify for order and payout sync');
  if (!caps.hasXero) suggestions.push('Connect Xero to push settlements to your accounts');

  if (suggestions.length > 0 && parts.length > 0) {
    parts.push(suggestions.join('. ') + '.');
  }

  if (parts.length === 0) {
    if (!caps.hasAmazon && !caps.hasShopify && !caps.hasXero && !caps.hasSettlements) {
      return 'No data yet. Connect your accounts or upload a settlement file to get started.';
    }
    return 'Scan complete.';
  }

  return parts.join(' · ');
}
