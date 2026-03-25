/**
 * Returns the canonical gap amount for display purposes.
 * Always prefer marketplace_validation.reconciliation_difference when available.
 * Falls back to settlement field computation only for display — never use fallback as a push gate.
 */
export function getDisplayGap(
  validationRow?: { reconciliation_difference?: number | null } | null,
  settlementRow?: { net_amount?: number | null; bank_deposit?: number | null } | null
): number | null {
  if (validationRow?.reconciliation_difference !== undefined && validationRow.reconciliation_difference !== null) {
    return validationRow.reconciliation_difference;
  }
  if (
    settlementRow?.net_amount !== undefined && settlementRow.net_amount !== null &&
    settlementRow?.bank_deposit !== undefined && settlementRow.bank_deposit !== null
  ) {
    return settlementRow.net_amount - settlementRow.bank_deposit;
  }
  return null;
}
