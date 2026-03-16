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
