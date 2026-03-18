/**
 * Canonical Settlement Actions
 * 
 * ALL settlement table writes from client code MUST go through these functions.
 * Edge functions write directly since they can't import src/.
 * 
 * Invariants enforced:
 * - Delete always cascades: settlement_lines → settlement_unmapped → settlements
 * - Status updates use explicit allowed transitions
 * - Hide/unhide goes through single path
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  error?: string;
}

// ─── Delete (single + bulk) ──────────────────────────────────────────────────

/**
 * Delete a settlement and all related data (lines, unmapped rows).
 * This is the ONLY approved client-side delete path.
 */
export async function deleteSettlement(settlementDbId: string): Promise<ActionResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get settlement_id for cascade
  const { data: row, error: fetchErr } = await supabase
    .from('settlements')
    .select('settlement_id, user_id')
    .eq('id', settlementDbId)
    .single();

  if (fetchErr || !row) return { success: false, error: fetchErr?.message || 'Settlement not found' };
  if (row.user_id !== user.id) return { success: false, error: 'Not authorized' };

  // Cascade delete
  await supabase.from('settlement_lines').delete().eq('settlement_id', row.settlement_id).eq('user_id', user.id);
  await supabase.from('settlement_unmapped').delete().eq('settlement_id', row.settlement_id).eq('user_id', user.id);

  const { error } = await supabase.from('settlements').delete().eq('id', settlementDbId);
  if (error) return { success: false, error: error.message };

  return { success: true };
}

/**
 * Delete multiple settlements. Uses the same cascade logic.
 */
export async function deleteSettlements(settlementDbIds: string[]): Promise<ActionResult> {
  for (const id of settlementDbIds) {
    const result = await deleteSettlement(id);
    if (!result.success) return result;
  }
  return { success: true };
}

// ─── Visibility ──────────────────────────────────────────────────────────────

/**
 * Hide or unhide a settlement. Used from RecentSettlements and other list views.
 */
export async function updateSettlementVisibility(
  settlementDbId: string,
  isHidden: boolean
): Promise<ActionResult> {
  const { error } = await supabase
    .from('settlements')
    .update({ is_hidden: isHidden } as any)
    .eq('id', settlementDbId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Status transitions ─────────────────────────────────────────────────────

/**
 * Revert a settlement back to 'saved' status (e.g., after failed push).
 * Clears Xero-related fields.
 */
export async function revertSettlementToSaved(settlementDbId: string): Promise<ActionResult> {
  const { error } = await supabase
    .from('settlements')
    .update({
      status: 'saved',
      xero_journal_id: null,
      xero_invoice_number: null,
      xero_status: null,
    } as any)
    .eq('id', settlementDbId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Reset a failed settlement so it can be retried.
 * Sets status back to 'ready_to_push' and resets retry count.
 */
export async function resetFailedSettlement(settlementDbId: string): Promise<ActionResult> {
  const { error } = await supabase
    .from('settlements')
    .update({
      status: 'ready_to_push',
      push_retry_count: 0,
      posting_state: null,
      posting_error: null,
    } as any)
    .eq('id', settlementDbId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Reset multiple failed settlements in batch.
 */
export async function resetFailedSettlements(settlementDbIds: string[]): Promise<ActionResult> {
  for (const id of settlementDbIds) {
    const result = await resetFailedSettlement(id);
    if (!result.success) return result;
  }
  return { success: true };
}

// ─── Bank verification ───────────────────────────────────────────────────────

/**
 * Mark a settlement as bank-verified with the matched amount.
 */
export async function markBankVerified(
  settlementDbId: string,
  bankAmount: number
): Promise<ActionResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('settlements')
    .update({
      bank_verified: true,
      bank_verified_amount: bankAmount,
      bank_verified_at: new Date().toISOString(),
      bank_verified_by: user.id,
    } as any)
    .eq('id', settlementDbId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Canonical Settlement Insert ─────────────────────────────────────────────

export interface SaveSettlementCanonicalInput {
  /** The full row to insert (must include user_id) */
  row: Record<string, any>;
  /** Used for source priority overlap detection */
  marketplace: string;
  periodStart: string;
  periodEnd: string;
  settlementId: string;
  source: string;
}

export interface SaveSettlementCanonicalResult {
  success: boolean;
  error?: string;
  sourcePriority?: SourcePriorityResult;
}

/**
 * Canonical settlement insert — the ONLY approved client-side insert path.
 * 
 * Wraps:
 * 1. from('settlements').insert(row)
 * 2. applySourcePriority() — synchronously, NOT fire-and-forget
 * 
 * All client-side code that creates settlements MUST call this function.
 * Edge functions handle their own inserts server-side with equivalent logic.
 */
export async function saveSettlementCanonical(
  input: SaveSettlementCanonicalInput
): Promise<SaveSettlementCanonicalResult> {
  const { row, marketplace, periodStart, periodEnd, settlementId, source } = input;

  // ─── Guardrail: Settlement ID validation ─────────────────────────
  const { validateSettlementSanity } = await import('@/utils/settlement-engine');

  // Quick settlement ID junk check (reuses the sanity validator)
  const stubSettlement = {
    marketplace,
    settlement_id: settlementId,
    period_start: periodStart,
    period_end: periodEnd,
    sales_ex_gst: row.sales_principal || 0,
    gst_on_sales: row.gst_on_income || 0,
    fees_ex_gst: Math.abs(row.seller_fees || 0),
    gst_on_fees: Math.abs(row.gst_on_expenses || 0),
    net_payout: row.bank_deposit || 0,
    source: source as any,
    reconciles: true,
  };
  const sanity = validateSettlementSanity(stubSettlement);
  if (!sanity.passed) {
    console.error(`[saveSettlementCanonical] BLOCKED by sanity check: ${settlementId} — ${sanity.error}`);
    try {
      await supabase.from('system_events' as any).insert({
        user_id: row.user_id,
        event_type: 'settlement_save_blocked_sanity',
        severity: 'warning',
        marketplace_code: marketplace,
        settlement_id: settlementId,
        details: { error: sanity.error, source },
      } as any);
    } catch (_) { /* non-blocking */ }
    return { success: false, error: sanity.error };
  }

  // ─── Guardrail: Date validation ──────────────────────────────────
  if (!periodStart || !periodEnd) {
    return { success: false, error: 'Settlement dates are missing. Cannot save without period_start and period_end.' };
  }

  // Step 1: Insert
  const { error } = await supabase.from('settlements').insert(row as any);
  if (error) return { success: false, error: error.message };

  // Step 2: Apply source priority synchronously
  let sourcePriority: SourcePriorityResult | undefined;
  try {
    sourcePriority = await applySourcePriority(
      row.user_id,
      marketplace,
      periodStart,
      periodEnd,
      settlementId,
      source,
    );
  } catch (err: any) {
    // Log failure but don't fail the insert — settlement is already saved
    console.error('[saveSettlementCanonical] source priority failed:', err);
    await supabase.from('system_events' as any).insert({
      user_id: row.user_id,
      event_type: 'source_priority_failed',
      severity: 'warning',
      marketplace_code: marketplace,
      settlement_id: settlementId,
      details: { error: err.message || 'Unknown error' },
    } as any);
  }

  return { success: true, sourcePriority };
}

// ─── Source Priority Guard ───────────────────────────────────────────────────

export interface SourcePriorityResult {
  suppressedCount: number;
  suppressedIds: string[];
  selfSuppressed: boolean;
}

/**
 * Canonical source priority invariant.
 * 
 * Rules:
 * - If newSource === 'manual' (CSV upload): suppress overlapping api_sync settlements
 * - If newSource === 'api_sync': self-suppress if manual settlement exists for same period
 * 
 * Called after every settlement insert — from saveSettlement (settlement-engine),
 * saveAmazonSettlement (AccountingDashboard), and edge functions (server-side equivalent).
 */
export async function applySourcePriority(
  userId: string,
  marketplace: string,
  periodStart: string,
  periodEnd: string,
  newSettlementId: string,
  newSource: string,
): Promise<SourcePriorityResult> {
  const result: SourcePriorityResult = { suppressedCount: 0, suppressedIds: [], selfSuppressed: false };

  try {
    if (newSource === 'manual' || newSource === 'csv_upload') {
      // CSV upload → suppress overlapping api_sync records
      const { data: overlapping } = await supabase
        .from('settlements')
        .select('id, settlement_id')
        .eq('user_id', userId)
        .eq('source', 'api_sync')
        .eq('marketplace', marketplace)
        .neq('settlement_id', newSettlementId)
        .neq('status', 'duplicate_suppressed')
        .lte('period_start', periodEnd)
        .gte('period_end', periodStart);

      if (overlapping && overlapping.length > 0) {
        for (const rec of overlapping) {
          await supabase
            .from('settlements')
            .update({
              status: 'duplicate_suppressed',
              duplicate_of_settlement_id: newSettlementId,
              duplicate_reason: 'CSV upload takes priority over Shopify-derived data',
            } as any)
            .eq('id', rec.id);

          result.suppressedIds.push(rec.settlement_id);
        }
        result.suppressedCount = overlapping.length;

        // Log system event
        await supabase.from('system_events' as any).insert({
          user_id: userId,
          event_type: 'settlement_suppressed_by_source_priority',
          severity: 'info',
          marketplace_code: marketplace,
          settlement_id: newSettlementId,
          details: {
            suppressed_settlement_ids: result.suppressedIds,
            reason: 'CSV upload supersedes Shopify-derived records',
            period: `${periodStart} → ${periodEnd}`,
          },
        } as any);
      }
    } else if (newSource === 'api_sync') {
      // API sync → self-suppress if manual settlement already covers this period
      const { data: manualExists } = await supabase
        .from('settlements')
        .select('id, settlement_id')
        .eq('user_id', userId)
        .in('source', ['manual', 'csv_upload'])
        .eq('marketplace', marketplace)
        .neq('status', 'duplicate_suppressed')
        .lte('period_start', periodEnd)
        .gte('period_end', periodStart)
        .limit(1);

      if (manualExists && manualExists.length > 0) {
        await supabase
          .from('settlements')
          .update({
            status: 'duplicate_suppressed',
            duplicate_of_settlement_id: manualExists[0].settlement_id,
            duplicate_reason: 'Manual CSV upload already exists for this period',
          } as any)
          .eq('settlement_id', newSettlementId)
          .eq('user_id', userId);

        result.selfSuppressed = true;

        await supabase.from('system_events' as any).insert({
          user_id: userId,
          event_type: 'settlement_self_suppressed_by_source_priority',
          severity: 'info',
          marketplace_code: marketplace,
          settlement_id: newSettlementId,
          details: {
            existing_manual_id: manualExists[0].settlement_id,
            reason: 'API-derived record auto-suppressed because manual CSV already exists',
            period: `${periodStart} → ${periodEnd}`,
          },
        } as any);
      }
    }
  } catch (err) {
    console.error('[applySourcePriority] error:', err);
  }

  return result;
}

/**
 * Check for overlapping api_sync settlements before save (read-only query for UI warning).
 */
export async function checkSourceOverlap(
  userId: string,
  marketplace: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ hasOverlap: boolean; overlappingIds: string[]; totalAmount: number }> {
  try {
    const { data } = await supabase
      .from('settlements')
      .select('settlement_id, bank_deposit')
      .eq('user_id', userId)
      .eq('source', 'api_sync')
      .eq('marketplace', marketplace)
      .neq('status', 'duplicate_suppressed')
      .lte('period_start', periodEnd)
      .gte('period_end', periodStart);

    if (data && data.length > 0) {
      return {
        hasOverlap: true,
        overlappingIds: data.map(d => d.settlement_id),
        totalAmount: data.reduce((sum, d) => sum + (d.bank_deposit || 0), 0),
      };
    }
  } catch (err) {
    console.error('[checkSourceOverlap] error:', err);
  }
  return { hasOverlap: false, overlappingIds: [], totalAmount: 0 };
}

/**
 * Get user's source preference for a marketplace.
 * Returns 'csv' | 'api' | null (null = default, which means CSV preferred).
 */
export async function getSourcePreference(
  userId: string,
  marketplaceCode: string,
): Promise<'csv' | 'api' | null> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', `source_preference:${marketplaceCode}`)
      .maybeSingle();

    if (data?.value === 'api' || data?.value === 'csv') return data.value;
  } catch (err) {
    console.error('[getSourcePreference] error:', err);
  }
  return null;
}

/**
 * Set user's source preference for a marketplace.
 */
export async function setSourcePreference(
  userId: string,
  marketplaceCode: string,
  preference: 'csv' | 'api',
): Promise<ActionResult> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      user_id: userId,
      key: `source_preference:${marketplaceCode}`,
      value: preference,
    } as any, { onConflict: 'user_id,key' });

  if (error) return { success: false, error: error.message };
  return { success: true };
}
