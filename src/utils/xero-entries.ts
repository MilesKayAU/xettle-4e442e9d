/**
 * Xero Entries — unified reader/writer for the xero_entries JSONB column
 *
 * During the transition period, legacy columns (xero_journal_id, xero_journal_id_1,
 * xero_journal_id_2, xero_invoice_id) are still written for backward compat.
 * Readers should use these helpers to get a normalised view.
 *
 * Schema: Array<{ type: string; id: string; month?: number }>
 */

export interface XeroEntry {
  type: string;   // 'ACCREC' | 'ACCPAY' | 'journal' | etc.
  id: string;     // Xero resource ID
  month?: number; // 1 or 2 for split-month journals
}

/**
 * Read xero entries from a settlement row, with fallback to legacy columns.
 */
export function readXeroEntries(settlement: {
  xero_entries?: unknown;
  xero_journal_id?: string | null;
  xero_journal_id_1?: string | null;
  xero_journal_id_2?: string | null;
  xero_invoice_id?: string | null;
  xero_type?: string | null;
}): XeroEntry[] {
  // Prefer new column if populated
  if (settlement.xero_entries && Array.isArray(settlement.xero_entries) && settlement.xero_entries.length > 0) {
    return settlement.xero_entries as XeroEntry[];
  }

  // Fallback: reconstruct from legacy columns
  const entries: XeroEntry[] = [];
  const type = settlement.xero_type || 'journal';

  if (settlement.xero_journal_id_1) {
    entries.push({ type, id: settlement.xero_journal_id_1, month: 1 });
  }
  if (settlement.xero_journal_id_2) {
    entries.push({ type, id: settlement.xero_journal_id_2, month: 2 });
  }
  if (entries.length === 0 && (settlement.xero_invoice_id || settlement.xero_journal_id)) {
    entries.push({ type, id: (settlement.xero_invoice_id || settlement.xero_journal_id)! });
  }

  return entries;
}

/**
 * Check if a settlement has any Xero entries (new or legacy).
 */
export function hasXeroEntries(settlement: Parameters<typeof readXeroEntries>[0]): boolean {
  return readXeroEntries(settlement).length > 0;
}

/**
 * Build the xero_entries array for a single (non-split) push.
 * Also returns legacy column values for backward compat.
 */
export function buildSingleEntry(xeroId: string, xeroType: string) {
  const entries: XeroEntry[] = [{ type: xeroType, id: xeroId }];
  return {
    xero_entries: entries,
    // Legacy compat
    xero_journal_id: xeroId,
    xero_invoice_id: xeroId,
    xero_type: xeroType,
  };
}

/**
 * Build the xero_entries array for a split-month push.
 * Also returns legacy column values for backward compat.
 */
export function buildSplitEntries(
  xeroId1: string,
  xeroId2: string | null,
  xeroType: string,
) {
  const entries: XeroEntry[] = [{ type: xeroType, id: xeroId1, month: 1 }];
  if (xeroId2) {
    entries.push({ type: xeroType, id: xeroId2, month: 2 });
  }
  return {
    xero_entries: entries,
    // Legacy compat
    xero_journal_id: xeroId1,
    xero_invoice_id: xeroId1,
    xero_journal_id_1: xeroId1,
    xero_journal_id_2: xeroId2,
    xero_type: xeroType,
  };
}

/**
 * Build a cleared/rollback payload — resets all Xero fields.
 */
export function buildClearedEntries() {
  return {
    xero_entries: [] as XeroEntry[],
    xero_journal_id: null,
    xero_invoice_id: null,
    xero_journal_id_1: null,
    xero_journal_id_2: null,
    xero_type: null,
    xero_status: null,
    xero_invoice_number: null,
  };
}
