/**
 * Canonical Repost / Rollback Action
 * 
 * Ensures consistent handling of the void-and-reissue flow:
 * - Voids existing Xero invoice(s)
 * - Respects auto_repost_after_rollback setting
 * - Sets manual_hold when appropriate
 * - Clears Xero fields on the settlement
 */

import { supabase } from '@/integrations/supabase/client';
import { rollbackFromXero } from './xeroPush';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepostResult {
  success: boolean;
  state: 'voided' | 'manual_hold' | 'ready_to_repost' | 'error';
  error?: string;
}

// ─── Rollback with proper state handling ─────────────────────────────────────

/**
 * Void a settlement's Xero invoice(s) and set the correct post-rollback state
 * based on the marketplace's rail_posting_settings.
 * 
 * If autopost is ON but auto_repost_after_rollback is OFF → manual_hold
 * If autopost is OFF → just void, settlement goes back to 'saved'
 * If autopost is ON and auto_repost_after_rollback is ON → ready for auto-repost
 */
export async function rollbackSettlement(opts: {
  settlementDbId: string;
  settlementId: string;
  marketplace: string;
  invoiceIds: string[];
}): Promise<RepostResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, state: 'error', error: 'Not authenticated' };

  // Step 1: Void in Xero
  const rollbackResult = await rollbackFromXero({
    settlementId: opts.settlementId,
    marketplace: opts.marketplace,
    invoiceIds: opts.invoiceIds,
  });

  if (!rollbackResult.success) {
    return { success: false, state: 'error', error: rollbackResult.error };
  }

  // Step 2: Check rail settings to determine post-rollback state
  const { data: railSetting } = await supabase
    .from('rail_posting_settings')
    .select('posting_mode, auto_repost_after_rollback')
    .eq('user_id', user.id)
    .eq('rail', opts.marketplace)
    .maybeSingle();

  const isAutoPost = railSetting?.posting_mode === 'auto';
  const autoRepost = (railSetting as any)?.auto_repost_after_rollback ?? false;

  // Determine posting_state
  let postingState: string | null = null;
  let resultState: RepostResult['state'] = 'voided';

  if (isAutoPost && !autoRepost) {
    postingState = 'manual_hold';
    resultState = 'manual_hold';
  } else if (isAutoPost && autoRepost) {
    resultState = 'ready_to_repost';
  }

  // Step 3: Update settlement
  const { error } = await supabase
    .from('settlements')
    .update({
      status: 'saved',
      xero_journal_id: null,
      xero_invoice_number: null,
      xero_invoice_id: null,
      xero_status: null,
      xero_type: null,
      posting_state: postingState,
      posting_error: null,
      posted_at: null,
    } as any)
    .eq('id', opts.settlementDbId);

  if (error) return { success: false, state: 'error', error: error.message };

  return { success: true, state: resultState };
}
