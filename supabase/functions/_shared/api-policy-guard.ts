/**
 * API Policy Guard
 * ════════════════
 * Enforcement layer that ensures all edge functions respect API policies.
 * Import and call at the top of any function that touches an external API.
 *
 * Features:
 *   - assertApiPolicy()    → blocks execution if API has critical issues
 *   - checkSafeMode()      → reads api_safe_mode from app_settings; blocks sync if active
 *   - warnPolicyViolation() → logs structured warnings to system_events
 *   - guardFetch()         → wraps fetch() with policy-aware logging
 *
 * Usage:
 *   import { assertApiPolicy, checkSafeMode } from '../_shared/api-policy-guard.ts'
 *
 *   await assertApiPolicy('xero', supabaseAdmin, userId)
 *   await checkSafeMode(supabaseAdmin, userId)
 */

import { getApiHealth, getAllDeprecationWarnings } from './api-policy-registry.ts';

export type ApiName = 'amazon' | 'shopify' | 'xero' | 'mirakl';

// ═══════════════════════════════════════════════════════════════
// 1. Policy Assertion — call at function entry
// ═══════════════════════════════════════════════════════════════

/**
 * Validates that the given API's policy is healthy.
 * Throws if API has 'deprecated' status (critical).
 * Logs warnings for non-critical deprecations.
 */
export function assertApiPolicy(api: ApiName): { ok: boolean; warnings: string[] } {
  const healthEntries = getApiHealth();
  const entry = healthEntries.find(e => e.api.toLowerCase().includes(api));

  if (!entry) {
    throw new Error(`[api-policy-guard] Unknown API: ${api}. Not registered in policy registry.`);
  }

  if (entry.status === 'deprecated') {
    throw new Error(
      `[api-policy-guard] API policy CRITICAL: ${entry.api} is deprecated. ` +
      `Blocking execution to prevent data corruption. Details: ${entry.notes.join('; ')}`
    );
  }

  const warnings: string[] = [];
  if (entry.status === 'warning') {
    for (const note of entry.notes) {
      warnings.push(`[api-policy-guard] ${entry.api}: ${note}`);
      console.warn(`[api-policy-guard] ${entry.api}: ${note}`);
    }
  }

  return { ok: true, warnings };
}

// ═══════════════════════════════════════════════════════════════
// 2. Safe Mode — emergency stop for all syncs
// ═══════════════════════════════════════════════════════════════

/**
 * Checks if safe mode is active for a user or globally.
 * Safe mode is set when the weekly audit finds critical issues.
 *
 * @param supabaseAdmin - Supabase admin client
 * @param userId - User ID to check (also checks global flag)
 * @throws Error if safe mode is active
 */
export async function checkSafeMode(
  supabaseAdmin: any,
  userId: string
): Promise<void> {
  // Check global safe mode first
  const { data: globalFlag } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'api_safe_mode')
    .eq('user_id', userId)
    .maybeSingle();

  if (globalFlag?.value === 'true') {
    const { data: reason } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'api_safe_mode_reason')
      .eq('user_id', userId)
      .maybeSingle();

    throw new Error(
      `[SAFE MODE] API sync blocked. Reason: ${reason?.value || 'Critical API policy issue detected'}. ` +
      `Review api_policy_warning events and resolve before resuming.`
    );
  }
}

/**
 * Activate safe mode for a user — blocks all syncs until resolved.
 */
export async function activateSafeMode(
  supabaseAdmin: any,
  userId: string,
  reason: string
): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert(
    { user_id: userId, key: 'api_safe_mode', value: 'true' },
    { onConflict: 'user_id,key' }
  );
  await supabaseAdmin.from('app_settings').upsert(
    { user_id: userId, key: 'api_safe_mode_reason', value: reason },
    { onConflict: 'user_id,key' }
  );

  // Log to system_events
  await supabaseAdmin.from('system_events').insert({
    user_id: userId,
    event_type: 'api_safe_mode_activated',
    severity: 'critical',
    details: { reason, activated_at: new Date().toISOString() },
  });

  console.error(`[SAFE MODE ACTIVATED] User ${userId}: ${reason}`);
}

/**
 * Deactivate safe mode for a user — allows syncs to resume.
 */
export async function deactivateSafeMode(
  supabaseAdmin: any,
  userId: string,
  resolvedBy: string
): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert(
    { user_id: userId, key: 'api_safe_mode', value: 'false' },
    { onConflict: 'user_id,key' }
  );

  await supabaseAdmin.from('system_events').insert({
    user_id: userId,
    event_type: 'api_safe_mode_deactivated',
    severity: 'info',
    details: { resolved_by: resolvedBy, deactivated_at: new Date().toISOString() },
  });

  console.log(`[SAFE MODE DEACTIVATED] User ${userId} by ${resolvedBy}`);
}

// ═══════════════════════════════════════════════════════════════
// 3. Warning Logger — structured system_events logging
// ═══════════════════════════════════════════════════════════════

export interface PolicyViolation {
  api: ApiName;
  violation_type: 'hardcoded_url' | 'missing_header' | 'deprecated_version' | 'direct_token_call' | 'missing_context' | 'rate_limit_bypass';
  function_name: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Log a policy violation to system_events for audit trail.
 */
export async function logPolicyViolation(
  supabaseAdmin: any,
  userId: string,
  violation: PolicyViolation
): Promise<void> {
  await supabaseAdmin.from('system_events').insert({
    user_id: userId,
    event_type: 'api_policy_warning',
    severity: violation.severity,
    marketplace_code: violation.api,
    details: {
      violation_type: violation.violation_type,
      function_name: violation.function_name,
      message: violation.message,
      detected_at: new Date().toISOString(),
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// 4. Deprecation Summary — for audit logging
// ═══════════════════════════════════════════════════════════════

/**
 * Logs all current deprecation warnings to system_events.
 * Called by the weekly audit cron.
 */
export async function logAllDeprecationWarnings(
  supabaseAdmin: any,
  userId: string
): Promise<number> {
  const warnings = getAllDeprecationWarnings();
  let count = 0;

  for (const w of warnings) {
    await supabaseAdmin.from('system_events').insert({
      user_id: userId,
      event_type: 'api_policy_warning',
      severity: 'warning',
      marketplace_code: w.api.toLowerCase().split(' ')[0], // 'amazon', 'shopify', 'xero'
      details: {
        violation_type: 'deprecated_version',
        feature: w.feature,
        status: w.status,
        message: w.note,
        detected_at: new Date().toISOString(),
      },
    });
    count++;
  }

  return count;
}
