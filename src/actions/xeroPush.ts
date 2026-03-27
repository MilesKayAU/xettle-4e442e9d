/**
 * Canonical Xero Push Actions
 * 
 * ALL client-side calls to sync-settlement-to-xero MUST go through these functions.
 * This ensures consistent error handling, status updates, and audit logging.
 * 
 * The edge function remains the source of truth for validation and Xero API calls.
 * These wrappers provide uniform client-side handling.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Required COA Categories for Push Eligibility ────────────────────────────

/**
 * Categories that MUST be mapped before a push is allowed.
 * Missing any of these blocks the push with MAPPING_REQUIRED.
 */
const REQUIRED_PUSH_CATEGORIES = ['Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping'];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PushEligibility {
  eligible: boolean;
  missingCategories: string[];
  errorCode?: string;
}

export interface PushResult {
  success: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  error?: string;
  errorCode?: string;
}

export interface RollbackResult {
  success: boolean;
  error?: string;
}

// ─── Push Eligibility Check ──────────────────────────────────────────────────

/**
 * Check if a marketplace has sufficient COA coverage to allow a push.
 * This is the canonical pre-push gate — called before pushSettlementToXero.
 *
 * Invariant: if required categories are unmapped, push is blocked regardless
 * of what the UI shows. This prevents cloned-but-wrong accounts from being pushed.
 *
 * @param marketplace - The marketplace code (e.g. "Amazon AU", "BigW")
 * @param mappedCategories - Categories that have a valid Xero account code mapped
 */
export function checkPushCategoryCoverage(
  marketplace: string,
  mappedCategories: string[],
): PushEligibility {
  const mappedSet = new Set(mappedCategories.map(c => c.toLowerCase()));
  const missing = REQUIRED_PUSH_CATEGORIES.filter(
    cat => !mappedSet.has(cat.toLowerCase()),
  );

  if (missing.length > 0) {
    return {
      eligible: false,
      missingCategories: missing,
      errorCode: 'MAPPING_REQUIRED',
    };
  }

  return { eligible: true, missingCategories: [] };
}

// ─── Manual Push ─────────────────────────────────────────────────────────────

/**
 * Push a single settlement to Xero via the sync-settlement-to-xero edge function.
 * This is the canonical client-side push path (used by PushSafetyPreview).
 */
export async function pushSettlementToXero(opts: {
  settlementId: string;
  marketplace: string;
  invoiceStatus?: 'DRAFT' | 'AUTHORISED';
  settlementData?: Record<string, any>;
  lineItems?: any[];
}): Promise<PushResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated', errorCode: 'AUTH_REQUIRED' };

  // ─── Reconciliation gap gate (defense-in-depth) ───────────────────
  const { data: settlement } = await supabase
    .from('settlements')
    .select('bank_deposit, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, reimbursements, gst_on_expenses')
    .eq('settlement_id', opts.settlementId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (settlement) {
    const { computeReconciliation, RECONCILIATION_TOLERANCE } = await import('@/services/reconciliation');
    const recon = computeReconciliation({
      marketplace: opts.marketplace,
      sales_principal: settlement.sales_principal || 0,
      sales_shipping: settlement.sales_shipping || 0,
      seller_fees: settlement.seller_fees || 0,
      other_fees: settlement.other_fees || 0,
      refunds: settlement.refunds || 0,
      reimbursements: settlement.reimbursements || 0,
      fba_fees: settlement.fba_fees || 0,
      storage_fees: settlement.storage_fees || 0,
      advertising_costs: settlement.advertising_costs || 0,
      gst_on_income: 0, // Not in this query — reconciliation handles it
      gst_on_expenses: settlement.gst_on_expenses || 0,
      bank_deposit: settlement.bank_deposit || 0,
    });
    if (!recon.withinTolerance) {
      return {
        success: false,
        error: `Reconciliation gap of $${recon.absGap.toFixed(2)} exceeds $${RECONCILIATION_TOLERANCE.toFixed(2)} tolerance. Edit figures to resolve before pushing.`,
        errorCode: 'RECON_GAP',
      };
    }
  }

  const { data: result, error: fnErr } = await supabase.functions.invoke('sync-settlement-to-xero', {
    body: {
      userId: user.id,
      settlementId: opts.settlementId,
      marketplace: opts.marketplace,
      invoiceStatus: opts.invoiceStatus || 'DRAFT',
      settlementData: opts.settlementData,
      lineItems: opts.lineItems,
    },
  });

  if (fnErr) {
    return { success: false, error: fnErr.message, errorCode: 'EDGE_FUNCTION_ERROR' };
  }

  if (result?.error) {
    return { 
      success: false, 
      error: result.error, 
      errorCode: result.errorCode || 'PUSH_FAILED',
    };
  }

  return {
    success: true,
    invoiceId: result?.invoiceId,
    invoiceNumber: result?.invoiceNumber,
  };
}

// ─── Rollback (Void) ─────────────────────────────────────────────────────────

/**
 * Rollback (void) a settlement's Xero invoice(s).
 * Used by SafeRepostModal and use-xero-sync.
 */
export async function rollbackFromXero(opts: {
  settlementId: string;
  marketplace: string;
  invoiceIds: string[];
}): Promise<RollbackResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data, error } = await supabase.functions.invoke('sync-settlement-to-xero', {
    body: {
      action: 'rollback',
      userId: user.id,
      settlementId: opts.settlementId,
      marketplace: opts.marketplace,
      invoiceIds: opts.invoiceIds,
    },
  });

  if (error) return { success: false, error: error.message };
  if (data?.error) return { success: false, error: data.error };

  return { success: true };
}

// ─── Auto-post trigger (single settlement) ───────────────────────────────────

/**
 * Trigger auto-post for a single settlement (manual retry from UI).
 */
export async function triggerAutoPost(settlementId: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase.functions.invoke('auto-post-settlement', {
    body: { settlement_id: settlementId, user_id: user.id },
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}
