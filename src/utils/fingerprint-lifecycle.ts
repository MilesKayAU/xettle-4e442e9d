/**
 * Fingerprint Lifecycle — Trusted Format validation and auto-promotion logic.
 *
 * DO NOT insert directly into marketplace_file_fingerprints.
 * Always use createDraftFingerprint() to enforce lifecycle rules.
 *
 * Fingerprints go through: draft → active (or rejected).
 * Draft fingerprints must pass validation gates before settlements can be saved.
 * Auto-promotion to active happens for low-risk CSV/TSV/XLSX formats.
 */

import { supabase } from '@/integrations/supabase/client';
import type { StandardSettlement } from './settlement-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FingerprintStatus = 'draft' | 'active' | 'rejected';
export type FingerprintParserType = 'generic' | 'custom' | 'pdf' | 'ai' | 'unknown';

export interface FingerprintRecord {
  id: string;
  status: FingerprintStatus;
  parser_type: FingerprintParserType;
  confidence: number | null;
  marketplace_code: string;
  column_mapping: Record<string, string>;
  column_signature: string[];
}

export interface DraftValidationResult {
  canSave: boolean;
  canAutoPromote: boolean;
  missingGates: string[];
  warnings: string[];
}

// ─── Shared Format Gate Validation ──────────────────────────────────────────

export interface FormatGateResult {
  passed: boolean;
  failedGates: string[];
  hardFailure: boolean; // true = missing dates, sanity_failed, payout mismatch
}

/**
 * Run the core validation gates against a settlement + fingerprint.
 * Used by both draft promotion and active-fingerprint drift detection.
 */
export function validateFormatGates(
  settlement: StandardSettlement,
  fingerprint: FingerprintRecord,
): FormatGateResult {
  const failedGates: string[] = [];
  let hardFailure = false;

  // Gate 1: Dates must be present (NO fallback to today)
  if (!settlement.period_start || !settlement.period_end) {
    failedGates.push('missing_dates');
    hardFailure = true;
  }

  // Gate 2: Net payout exists and is non-zero (or computable)
  if (settlement.net_payout === 0 && Math.abs(settlement.sales_ex_gst) > 100) {
    failedGates.push('payout_mismatch');
    hardFailure = true;
  }

  // Gate 3: Not all-zero
  if (settlement.sales_ex_gst === 0 && settlement.fees_ex_gst === 0 && settlement.net_payout === 0) {
    failedGates.push('all_zero_values');
  }

  // Gate 4: Mapping completeness (sales + fees + net OR equivalent)
  const mapping = fingerprint.column_mapping || {};
  const hasSales = !!mapping.gross_sales;
  const hasFees = !!mapping.fees;
  const hasNet = !!mapping.net_payout;
  if (!((hasSales && hasFees) || (hasSales && hasNet) || (hasNet && hasFees))) {
    failedGates.push('incomplete_mapping');
  }

  // Gate 5: Sanity check
  if (settlement.metadata?.sanity_failed) {
    failedGates.push('sanity_failed');
    hardFailure = true;
  }

  // Gate 6: Reconciliation must pass
  if (!settlement.reconciles) {
    failedGates.push('reconciliation_failed');
  }

  return {
    passed: failedGates.length === 0,
    failedGates,
    hardFailure,
  };
}

// ─── Draft Validation Gates ─────────────────────────────────────────────────

/**
 * Validate whether a draft fingerprint's settlement can be saved.
 * Returns detailed gate results for UI display.
 */
export function validateDraftGates(
  settlement: StandardSettlement,
  fingerprint: FingerprintRecord | null,
  fileFormat: string | undefined,
): DraftValidationResult {
  const missingGates: string[] = [];
  const warnings: string[] = [];

  // If no fingerprint or active fingerprint, skip draft gates
  if (!fingerprint || fingerprint.status === 'active') {
    return { canSave: true, canAutoPromote: false, missingGates: [], warnings: [] };
  }

  if (fingerprint.status === 'rejected') {
    return {
      canSave: false,
      canAutoPromote: false,
      missingGates: ['This format has been rejected. Please re-map the columns or contact support.'],
      warnings: [],
    };
  }

  // Run shared gates
  const gateResult = validateFormatGates(settlement, fingerprint);

  // Convert gate codes to human-readable messages
  const gateMessages: Record<string, string> = {
    missing_dates: 'Settlement dates (period_start/period_end) are missing. Map a date column or enter dates manually.',
    payout_mismatch: 'Net payout is $0 despite having sales — likely incorrect column mapping.',
    all_zero_values: 'All financial values are $0 — likely incorrect column mapping.',
    incomplete_mapping: 'Column mapping is incomplete. Need at least two of: sales, fees, net payout.',
    sanity_failed: 'Data sanity check failed — values appear implausible for the mapped columns.',
    reconciliation_failed: 'Reconciliation failed — calculated net differs from reported net beyond tolerance.',
  };

  for (const gate of gateResult.failedGates) {
    missingGates.push(gateMessages[gate] || gate);
  }

  // Auto-promote constraints
  let canAutoPromote = missingGates.length === 0;

  if (canAutoPromote) {
    const fmt = (fileFormat || '').toLowerCase();
    const isGenericFormat = ['csv', 'tsv', 'xlsx', 'xls'].some(f => fmt.includes(f));
    if (!isGenericFormat) {
      canAutoPromote = false;
      warnings.push('PDF formats require manual promotion.');
    }

    if (fingerprint.parser_type !== 'generic' && fingerprint.parser_type !== 'ai') {
      canAutoPromote = false;
      warnings.push(`Parser type "${fingerprint.parser_type}" requires manual promotion.`);
    }

    if (fingerprint.parser_type === 'ai' || fingerprint.confidence !== null) {
      if ((fingerprint.confidence || 0) < 80) {
        canAutoPromote = false;
        warnings.push('AI-detected format with confidence < 80% requires manual verification before promotion.');
      }
    }
  }

  return {
    canSave: missingGates.length === 0,
    canAutoPromote,
    missingGates,
    warnings,
  };
}

// ─── Drift Detection Helpers ────────────────────────────────────────────────

/**
 * Log a format_drift_detected system event.
 */
export async function logDriftDetected(params: {
  userId: string;
  fingerprintId: string;
  marketplaceCode: string;
  failedGates: string[];
  settlementId: string;
}): Promise<void> {
  try {
    await supabase.from('system_events').insert({
      user_id: params.userId,
      event_type: 'format_drift_detected',
      severity: 'warning',
      marketplace_code: params.marketplaceCode,
      settlement_id: params.settlementId,
      details: {
        fingerprint_id: params.fingerprintId,
        marketplace_code: params.marketplaceCode,
        failed_gates: params.failedGates,
        settlement_id: params.settlementId,
        actor_user_id: params.userId,
      },
    } as any);
  } catch { /* non-blocking */ }
}

/**
 * Auto-demote an active fingerprint to draft on hard failure.
 * Logs format_auto_demoted_to_draft event for FormatInspector visibility.
 */
export async function autoDemoteFingerprint(params: {
  fingerprintId: string;
  marketplaceCode: string;
  userId: string;
  failedGates: string[];
}): Promise<void> {
  try {
    await supabase
      .from('marketplace_file_fingerprints')
      .update({ status: 'draft' } as any)
      .eq('id', params.fingerprintId);

    await supabase.from('system_events').insert({
      user_id: params.userId,
      event_type: 'format_auto_demoted_to_draft',
      severity: 'warning',
      marketplace_code: params.marketplaceCode,
      details: {
        fingerprint_id: params.fingerprintId,
        marketplace_code: params.marketplaceCode,
        failed_gates: params.failedGates,
        actor_user_id: params.userId,
        reason: 'drift_hard_failure',
      },
    } as any);
  } catch { /* non-blocking */ }
}

// ─── Fingerprint Lookup ─────────────────────────────────────────────────────

/**
 * Look up a fingerprint record by ID.
 */
export async function getFingerprintById(id: string): Promise<FingerprintRecord | null> {
  try {
    const { data } = await supabase
      .from('marketplace_file_fingerprints')
      .select('id, status, parser_type, confidence, marketplace_code, column_mapping, column_signature')
      .eq('id', id)
      .maybeSingle();

    if (!data) return null;
    return data as any as FingerprintRecord;
  } catch {
    return null;
  }
}

/**
 * Look up a fingerprint by matching column signature for a user.
 */
export async function findFingerprintBySignature(
  userId: string,
  headers: string[],
): Promise<FingerprintRecord | null> {
  try {
    const { data: fingerprints } = await supabase
      .from('marketplace_file_fingerprints')
      .select('id, status, parser_type, confidence, marketplace_code, column_mapping, column_signature')
      .eq('user_id', userId) as any;

    if (!fingerprints || fingerprints.length === 0) return null;

    const normHeaders = new Set(headers.map(h => h.toLowerCase().trim()));

    for (const fp of fingerprints) {
      const sig: string[] = Array.isArray(fp.column_signature) ? fp.column_signature : [];
      if (sig.length < 3) continue;
      const normSig = sig.map((s: string) => s.toLowerCase().trim());
      if (normSig.every((col: string) => normHeaders.has(col))) {
        return fp as FingerprintRecord;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Update last_seen_at ────────────────────────────────────────────────────

export async function touchFingerprintLastSeen(id: string): Promise<void> {
  try {
    await supabase
      .from('marketplace_file_fingerprints')
      .update({ last_seen_at: new Date().toISOString() } as any)
      .eq('id', id);
  } catch { /* non-blocking */ }
}

// ─── Create Draft Fingerprint ───────────────────────────────────────────────

export async function createDraftFingerprint(params: {
  userId: string;
  marketplaceCode: string;
  columnSignature: string[];
  columnMapping: Record<string, string>;
  parserType: FingerprintParserType;
  confidence?: number;
  filePattern?: string;
  notes?: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('marketplace_file_fingerprints')
      .insert({
        user_id: params.userId,
        marketplace_code: params.marketplaceCode,
        column_signature: params.columnSignature as any,
        column_mapping: params.columnMapping as any,
        status: 'draft',
        parser_type: params.parserType,
        created_by: params.userId,
        confidence: params.confidence ?? null,
        file_pattern: params.filePattern || null,
        notes: params.notes || null,
        is_multi_marketplace: false,
        reconciliation_type: 'csv_only',
      } as any)
      .select('id')
      .single();

    if (error) {
      console.error('[createDraftFingerprint] error:', error);
      return null;
    }

    // Log system event
    await supabase.from('system_events').insert({
      user_id: params.userId,
      event_type: 'format_draft_created',
      severity: 'info',
      marketplace_code: params.marketplaceCode,
      details: {
        fingerprint_id: data.id,
        marketplace: params.marketplaceCode,
        parser_type: params.parserType,
        confidence: params.confidence ?? null,
        actor_user_id: params.userId,
      },
    } as any);

    return data.id;
  } catch (err) {
    console.error('[createDraftFingerprint] exception:', err);
    return null;
  }
}

// ─── Centralized Logging Helpers ────────────────────────────────────────────

/**
 * Log when a draft fingerprint is promoted to active.
 */
export async function logPromotionEvent(params: {
  userId: string;
  fingerprintId: string;
  marketplace: string;
  parserType: string;
  confidence: number | null;
}): Promise<void> {
  try {
    await supabase.from('system_events').insert({
      user_id: params.userId,
      event_type: 'format_promoted_to_active',
      severity: 'info',
      marketplace_code: params.marketplace,
      details: {
        fingerprint_id: params.fingerprintId,
        parser_type: params.parserType,
        confidence: params.confidence,
      },
    } as any);
  } catch { /* non-blocking */ }
}

/**
 * Log when a settlement save is blocked by lifecycle gates.
 */
export async function logSaveBlocked(params: {
  userId: string;
  fingerprintId: string;
  marketplace: string;
  missingGates: string[];
}): Promise<void> {
  try {
    await supabase.from('system_events').insert({
      user_id: params.userId,
      event_type: 'format_save_blocked',
      severity: 'warning',
      marketplace_code: params.marketplace,
      details: {
        fingerprint_id: params.fingerprintId,
        missing_gates: params.missingGates,
        actor_user_id: params.userId,
      },
    } as any);
  } catch { /* non-blocking */ }
}

// ─── Admin Helpers: Status + Notes Updates ──────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['active', 'rejected'],
  active: ['rejected', 'draft'],
  rejected: ['draft'],
};

export interface StatusUpdateResult {
  success: boolean;
  error?: string;
  oldStatus?: string;
  newStatus?: string;
}

/**
 * Update fingerprint status with transition validation and system_events logging.
 * UI must call this helper instead of writing directly.
 */
export async function updateFingerprintStatus({
  fingerprintId,
  newStatus,
}: {
  fingerprintId: string;
  newStatus: FingerprintStatus;
}): Promise<StatusUpdateResult> {
  try {
    const fp = await getFingerprintById(fingerprintId);
    if (!fp) return { success: false, error: 'Fingerprint not found' };

    const allowed = ALLOWED_TRANSITIONS[fp.status] || [];
    if (!allowed.includes(newStatus)) {
      return { success: false, error: `Transition from ${fp.status} to ${newStatus} is not allowed` };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await supabase
      .from('marketplace_file_fingerprints')
      .update({ status: newStatus } as any)
      .eq('id', fingerprintId);

    if (error) return { success: false, error: error.message };

    // Log system event
    await supabase.from('system_events').insert({
      user_id: user.id,
      event_type: 'format_status_changed',
      severity: 'info',
      marketplace_code: fp.marketplace_code,
      details: {
        fingerprint_id: fingerprintId,
        old_status: fp.status,
        new_status: newStatus,
        actor_user_id: user.id,
      },
    } as any);

    return { success: true, oldStatus: fp.status, newStatus };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

/**
 * Update fingerprint notes with system_events logging.
 * UI must call this helper instead of writing directly.
 */
export async function updateFingerprintNotes({
  fingerprintId,
  notes,
}: {
  fingerprintId: string;
  notes: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await supabase
      .from('marketplace_file_fingerprints')
      .update({ notes } as any)
      .eq('id', fingerprintId);

    if (error) return { success: false, error: error.message };

    await supabase.from('system_events').insert({
      user_id: user.id,
      event_type: 'format_notes_updated',
      severity: 'info',
      details: {
        fingerprint_id: fingerprintId,
        actor_user_id: user.id,
      },
    } as any);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}
