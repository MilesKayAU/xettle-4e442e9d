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

// ─── Validation Gates ───────────────────────────────────────────────────────

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

  // Gate 1: Dates must be present (NO fallback to today)
  if (!settlement.period_start || !settlement.period_end) {
    missingGates.push('Settlement dates (period_start/period_end) are missing. Map a date column or enter dates manually.');
  }

  // Gate 2: Net payout exists and is non-zero (or computable)
  if (settlement.net_payout === 0 && Math.abs(settlement.sales_ex_gst) > 100) {
    missingGates.push('Net payout is $0 despite having sales — likely incorrect column mapping.');
  }

  // Gate 3: Not all-zero
  if (settlement.sales_ex_gst === 0 && settlement.fees_ex_gst === 0 && settlement.net_payout === 0) {
    missingGates.push('All financial values are $0 — likely incorrect column mapping.');
  }

  // Gate 4: Mapping completeness (sales + fees + net OR equivalent)
  const mapping = fingerprint.column_mapping || {};
  const hasSales = !!mapping.gross_sales;
  const hasFees = !!mapping.fees;
  const hasNet = !!mapping.net_payout;
  if (!((hasSales && hasFees) || (hasSales && hasNet) || (hasNet && hasFees))) {
    missingGates.push('Column mapping is incomplete. Need at least two of: sales, fees, net payout.');
  }

  // Gate 5: Sanity check
  if (settlement.metadata?.sanity_failed) {
    missingGates.push('Data sanity check failed — values appear implausible for the mapped columns.');
  }

  // Gate 6: Reconciliation must pass (no warning state for auto-trust)
  if (!settlement.reconciles) {
    missingGates.push('Reconciliation failed — calculated net differs from reported net beyond tolerance.');
  }

  // Auto-promote constraints
  let canAutoPromote = missingGates.length === 0;

  if (canAutoPromote) {
    // Only auto-promote CSV/TSV/XLSX with generic parser
    const fmt = (fileFormat || '').toLowerCase();
    const isGenericFormat = ['csv', 'tsv', 'xlsx', 'xls'].some(f => fmt.includes(f));
    if (!isGenericFormat) {
      canAutoPromote = false;
      warnings.push('PDF formats require manual promotion.');
    }

    if (fingerprint.parser_type !== 'generic') {
      canAutoPromote = false;
      warnings.push(`Parser type "${fingerprint.parser_type}" requires manual promotion.`);
    }

    // AI-created with low confidence cannot auto-promote
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
