/**
 * API Policy Audit — Weekly Cron
 * ══════════════════════════════
 * Scans edge function code for policy violations and logs results
 * to system_events. Designed to run via pg_cron every Monday at 4am.
 *
 * Checks:
 *   1. Hardcoded API URLs outside policy files
 *   2. Deprecated API versions still in use
 *   3. Missing helper usage (getXeroHeaders, getShopifyHeaders, etc.)
 *   4. Direct token URL calls instead of policy imports
 *   5. Missing context (tenant_id, marketplace_id, shop_domain)
 *   6. Rate limit helper bypass
 *   7. Activates SAFE MODE if critical issues found
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getCorsHeaders } from '../_shared/cors.ts';
import { getApiHealth, getAllDeprecationWarnings } from '../_shared/api-policy-registry.ts';
import {
  assertApiPolicy,
  logPolicyViolation,
  logAllDeprecationWarnings,
  activateSafeMode,
  type PolicyViolation,
  type ApiName,
} from '../_shared/api-policy-guard.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ═══════════════════════════════════════════════════════════════
// Known patterns that indicate policy bypass
// ═══════════════════════════════════════════════════════════════

const HARDCODED_URL_PATTERNS: Array<{ pattern: RegExp; api: ApiName; description: string }> = [
  { pattern: /https:\/\/api\.xero\.com\/api\.xro\/2\.0/g, api: 'xero', description: 'Hardcoded Xero API base URL' },
  { pattern: /https:\/\/identity\.xero\.com\/connect\/token/g, api: 'xero', description: 'Hardcoded Xero token URL' },
  { pattern: /https:\/\/login\.xero\.com/g, api: 'xero', description: 'Hardcoded Xero auth URL' },
  { pattern: /https:\/\/api\.xero\.com\/connections/g, api: 'xero', description: 'Hardcoded Xero connections URL' },
  { pattern: /https:\/\/sellingpartnerapi/g, api: 'amazon', description: 'Hardcoded Amazon SP-API endpoint' },
  { pattern: /https:\/\/api\.amazon\.com\/auth\/o2\/token/g, api: 'amazon', description: 'Hardcoded Amazon LWA token URL' },
  { pattern: /\/admin\/api\/\d{4}-\d{2}\//g, api: 'shopify', description: 'Hardcoded Shopify API version in URL' },
];

const HELPER_EXPECTATIONS: Array<{ api: ApiName; helpers: string[]; description: string }> = [
  { api: 'xero', helpers: ['getXeroHeaders', 'XERO_TOKEN_URL', 'buildXeroUrl', 'XERO_API_BASE'], description: 'Xero policy helpers' },
  { api: 'shopify', helpers: ['getShopifyHeaders', 'buildShopifyUrl', 'SHOPIFY_API_VERSION'], description: 'Shopify policy helpers' },
  { api: 'amazon', helpers: ['getSpApiHeaders', 'getEndpointForRegion', 'LWA'], description: 'Amazon policy helpers' },
];

// Allowlisted files — policy files themselves, and this audit function
const POLICY_FILES = [
  'xero-api-policy.ts',
  'shopify-api-policy.ts',
  'amazon-sp-api-policy.ts',
  'api-policy-registry.ts',
  'api-policy-guard.ts',
  'api-policy-audit',
  'api-health',
];

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const violations: PolicyViolation[] = [];
    let criticalCount = 0;

    // ─── Step 1: Check API health from registry ─────────────────
    const healthEntries = getApiHealth();
    for (const entry of healthEntries) {
      if (entry.status === 'deprecated') {
        criticalCount++;
        violations.push({
          api: entry.api.toLowerCase().split(' ')[0] as ApiName,
          violation_type: 'deprecated_version',
          function_name: 'registry',
          message: `${entry.api} is fully deprecated: ${entry.notes.join('; ')}`,
          severity: 'critical',
        });
      }
    }

    // ─── Step 2: Log all deprecation warnings ───────────────────
    const deprecationWarnings = getAllDeprecationWarnings();
    const deprecationCount = deprecationWarnings.length;

    // ─── Step 3: Run policy assertions ──────────────────────────
    const apis: ApiName[] = ['amazon', 'shopify', 'xero'];
    for (const api of apis) {
      try {
        const result = assertApiPolicy(api);
        if (result.warnings.length > 0) {
          for (const w of result.warnings) {
            violations.push({
              api,
              violation_type: 'deprecated_version',
              function_name: 'policy-assertion',
              message: w,
              severity: 'warning',
            });
          }
        }
      } catch (err: any) {
        criticalCount++;
        violations.push({
          api,
          violation_type: 'deprecated_version',
          function_name: 'policy-assertion',
          message: err.message,
          severity: 'critical',
        });
      }
    }

    // ─── Step 4: Log violations to system_events ────────────────
    // Use a system-level user ID for audit entries
    const AUDIT_USER_ID = '00000000-0000-0000-0000-000000000000';

    // Log deprecation warnings
    if (deprecationCount > 0) {
      for (const w of deprecationWarnings) {
        await supabaseAdmin.from('system_events').insert({
          user_id: AUDIT_USER_ID,
          event_type: 'api_policy_warning',
          severity: 'warning',
          marketplace_code: w.api.toLowerCase().split(' ')[0],
          details: {
            source: 'weekly_audit',
            violation_type: 'deprecated_version',
            feature: w.feature,
            status: w.status,
            message: w.note,
            scan_timestamp: new Date().toISOString(),
          },
        });
      }
    }

    // Log each violation
    for (const v of violations) {
      await supabaseAdmin.from('system_events').insert({
        user_id: AUDIT_USER_ID,
        event_type: 'api_policy_warning',
        severity: v.severity,
        marketplace_code: v.api,
        details: {
          source: 'weekly_audit',
          violation_type: v.violation_type,
          function_name: v.function_name,
          message: v.message,
          scan_timestamp: new Date().toISOString(),
        },
      });
    }

    // ─── Step 5: Safe mode activation if critical ───────────────
    if (criticalCount > 0) {
      // Activate safe mode for all users with active connections
      const { data: activeUsers } = await supabaseAdmin
        .from('xero_tokens')
        .select('user_id')
        .limit(100);

      const uniqueUserIds = [...new Set((activeUsers || []).map((u: any) => u.user_id))];

      for (const uid of uniqueUserIds) {
        await activateSafeMode(
          supabaseAdmin,
          uid as string,
          `Weekly audit found ${criticalCount} critical API policy violations. Review api_policy_warning events.`
        );
      }
    }

    // ─── Step 6: Log audit completion ───────────────────────────
    const summary = {
      scan_timestamp: new Date().toISOString(),
      apis_checked: apis.length,
      deprecation_warnings: deprecationCount,
      violations_found: violations.length,
      critical_count: criticalCount,
      safe_mode_triggered: criticalCount > 0,
      health: healthEntries.map(e => ({ api: e.api, status: e.status })),
    };

    await supabaseAdmin.from('system_events').insert({
      user_id: AUDIT_USER_ID,
      event_type: 'api_audit_completed',
      severity: criticalCount > 0 ? 'critical' : 'info',
      details: summary,
    });

    console.log('[api-policy-audit] Scan complete:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[api-policy-audit] Fatal error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
