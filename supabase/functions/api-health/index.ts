/**
 * API Health Endpoint
 * ═══════════════════
 * Returns real-time health status for all integrated APIs.
 * Used by admin dashboard and debugging tools.
 *
 * GET /api-health → { amazon, shopify, xero, warnings, safe_mode }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getCorsHeaders } from '../_shared/cors.ts';
import { getApiHealth, getAllDeprecationWarnings } from '../_shared/api-policy-registry.ts';
import { assertApiPolicy, type ApiName } from '../_shared/api-policy-guard.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth — require valid user
    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader || '' } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── Gather health data ─────────────────────────────────────
    const healthEntries = getApiHealth();
    const deprecationWarnings = getAllDeprecationWarnings();

    // Per-API status
    const apis: ApiName[] = ['amazon', 'shopify', 'xero'];
    const apiStatus: Record<string, { status: string; warnings: string[] }> = {};

    for (const api of apis) {
      try {
        const result = assertApiPolicy(api);
        apiStatus[api] = { status: 'ok', warnings: result.warnings };
      } catch (err: any) {
        apiStatus[api] = { status: 'critical', warnings: [err.message] };
      }
    }

    // Check safe mode for this user
    const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: safeModeFlag } = await serviceClient
      .from('app_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'api_safe_mode')
      .maybeSingle();

    const safeMode = safeModeFlag?.value === 'true';

    let safeModeReason: string | null = null;
    if (safeMode) {
      const { data: reason } = await serviceClient
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'api_safe_mode_reason')
        .maybeSingle();
      safeModeReason = reason?.value || null;
    }

    // ─── Recent audit warnings (last 7 days) ────────────────────
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentWarnings, count } = await serviceClient
      .from('system_events')
      .select('event_type, severity, marketplace_code, details, created_at', { count: 'exact' })
      .eq('event_type', 'api_policy_warning')
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(20);

    const response = {
      timestamp: new Date().toISOString(),
      amazon: apiStatus.amazon,
      shopify: apiStatus.shopify,
      xero: apiStatus.xero,
      safe_mode: {
        active: safeMode,
        reason: safeModeReason,
      },
      deprecations: deprecationWarnings,
      recent_warnings: {
        count: count || 0,
        items: recentWarnings || [],
      },
      health_summary: healthEntries,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[api-health] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
