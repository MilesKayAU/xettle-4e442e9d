

## Audit Correction + Enhancement Plan for GenericMarketplaceDashboard

### What Already Exists (contrary to the audit finding)

The component is NOT a placeholder. After full review of all 837 lines, here is what is already implemented:

- **Dedup**: `saveSettlement()` in settlement-engine.ts checks `settlement_id + marketplace + user_id` before insert. Push-time also warns if `xero_journal_id` exists.
- **Transaction detail**: Full drill-down table (lines 627-709) with color-coded rows, CSV export, totals row with $0.05 reconciliation check. Fallback (lines 710-731) shows settlement summary + "Re-upload file to see transaction detail" — never shows blank.
- **Reconciliation**: `runUniversalReconciliation()` runs before every Xero push (lines 219-226), blocks if `canSync === false`.
- **Bulk delete**: Select all / select one + bulk delete via `deleteSettlement()` (lines 180-192, 296-310, 406-428).
- **Gap detection**: Period gap detection with Shopify 4-day tolerance (lines 450-461).
- **Xero sync**: Uses `syncSettlementToXero()` with `buildSimpleInvoiceLines()` from settlement-engine.ts (lines 194-259).

### What Is Actually Missing (real gaps)

1. **Inline reconciliation display** — recon runs silently at push time; no visual checks shown per settlement card
2. **Xero-aware bulk delete** — no warning count of synced items in selection before bulk delete
3. **Rollback button** — no way to void/rollback a synced Xero invoice from this dashboard
4. **Refresh from Xero button** — `syncXeroStatus` is imported but never wired to a UI button
5. **Reconciliation inline per card** — no expandable recon checks visible before user clicks Push

### Implementation Plan

**A. Add inline reconciliation checks per settlement card**
- Below the financial summary row, show a collapsible reconciliation section
- Run `runUniversalReconciliation()` on-demand when user expands or when pushing
- Show pass/warn/fail icons for each check (Balance, GST, Refund Completeness, Sanity, Invoice Accuracy)
- Block push button if any critical fail

**B. Xero-aware bulk delete confirmation**
- Count how many selected settlements have `status === 'synced'` or `xero_journal_id` set
- Show confirmation dialog: "X of Y selected settlements are already in Xero. Deleting them here will NOT void them in Xero. Continue?"

**C. Add rollback button for synced settlements**
- For settlements with `status === 'synced'` and `xero_journal_id`, show "Rollback" button
- Call `rollbackSettlementFromXero()` from settlement-engine.ts
- Reset status to 'saved' on success

**D. Add "Refresh from Xero" button**
- Wire the already-imported `syncXeroStatus()` to a button in the header area
- Show loading state and toast result with count of updated records

**E. Import rollbackSettlementFromXero**
- Add to the existing imports from settlement-engine.ts

### Files Modified
- `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` — all changes in this single file

### Scope
~150 lines of additions/modifications to a well-structured 837-line component. No new files, no DB changes, no edge function changes.

