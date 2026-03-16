/**
 * Safe upsert helper for xero_accounting_matches.
 * 
 * Handles the partial unique index on (user_id, xero_invoice_id)
 * which prevents linking one Xero invoice to multiple settlements.
 * 
 * If a unique violation occurs, returns a structured error instead of crashing.
 * Also logs the conflict to system_events for audit.
 */

interface XamUpsertRow {
  user_id: string;
  settlement_id: string;
  marketplace_code: string;
  xero_invoice_id?: string | null;
  xero_invoice_number?: string | null;
  xero_status?: string | null;
  xero_type?: string | null;
  match_method?: string;
  confidence?: number;
  matched_amount?: number | null;
  matched_date?: string | null;
  matched_contact?: string | null;
  matched_reference?: string | null;
  reference_hash?: string | null;
  notes?: string | null;
  updated_at?: string;
}

interface XamUpsertResult {
  success: boolean;
  errorCode?: 'INVOICE_ALREADY_LINKED' | 'DB_ERROR';
  xeroInvoiceId?: string;
  existingSettlementId?: string;
  message?: string;
}

/**
 * Safely upsert a row into xero_accounting_matches.
 * 
 * @param supabase - Supabase client (service role or user-scoped)
 * @param row - The row to upsert
 * @param onConflictColumns - The conflict target (default: 'user_id,settlement_id')
 * @returns Structured result with success/error info
 */
export async function safeUpsertXam(
  supabase: any,
  row: XamUpsertRow,
  onConflictColumns: string = 'user_id,settlement_id'
): Promise<XamUpsertResult> {
  // Pre-check: if we're setting a xero_invoice_id, verify it's not already linked to another settlement
  if (row.xero_invoice_id) {
    const { data: existing } = await supabase
      .from('xero_accounting_matches')
      .select('settlement_id, id')
      .eq('user_id', row.user_id)
      .eq('xero_invoice_id', row.xero_invoice_id)
      .neq('settlement_id', row.settlement_id)
      .maybeSingle();

    if (existing) {
      // Log the conflict
      await supabase.from('system_events').insert({
        user_id: row.user_id,
        event_type: 'invoice_link_conflict',
        severity: 'warning',
        settlement_id: row.settlement_id,
        marketplace_code: row.marketplace_code,
        details: {
          xero_invoice_id: row.xero_invoice_id,
          attempted_settlement_id: row.settlement_id,
          existing_settlement_id: existing.settlement_id,
          match_method: row.match_method || 'unknown',
        },
      });

      return {
        success: false,
        errorCode: 'INVOICE_ALREADY_LINKED',
        xeroInvoiceId: row.xero_invoice_id,
        existingSettlementId: existing.settlement_id,
        message: `Xero invoice ${row.xero_invoice_id} is already linked to settlement ${existing.settlement_id}`,
      };
    }
  }

  // Perform the upsert
  const { error } = await supabase
    .from('xero_accounting_matches')
    .upsert(row, { onConflict: onConflictColumns });

  if (error) {
    // Catch race condition: unique violation may still occur between check and insert
    if (error.code === '23505' && error.message?.includes('ux_xam_user_invoice')) {
      await supabase.from('system_events').insert({
        user_id: row.user_id,
        event_type: 'invoice_link_conflict',
        severity: 'warning',
        settlement_id: row.settlement_id,
        marketplace_code: row.marketplace_code,
        details: {
          xero_invoice_id: row.xero_invoice_id,
          attempted_settlement_id: row.settlement_id,
          error: error.message,
          race_condition: true,
        },
      });

      return {
        success: false,
        errorCode: 'INVOICE_ALREADY_LINKED',
        xeroInvoiceId: row.xero_invoice_id || undefined,
        message: `Unique violation: ${error.message}`,
      };
    }

    console.error('[xam-safe-upsert] DB error:', error);
    return {
      success: false,
      errorCode: 'DB_ERROR',
      message: error.message,
    };
  }

  return { success: true };
}
