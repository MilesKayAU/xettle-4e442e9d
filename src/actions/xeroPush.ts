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

// ─── Types ───────────────────────────────────────────────────────────────────

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
