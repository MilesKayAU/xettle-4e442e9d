

## Source Push Gate — Final Adjusted Plan

### Two Adjustments Accepted

**Adjustment A — Make Fix 9 (sync-xero-status promotion) optional → removed from scope.**

Copilot is right: the promotion query at line 1012-1028 is generic and promotes all recent `ingested` settlements. Excluding `shopify_orders_%` there could create "stuck" records with unclear semantics. The push gate already prevents these from ever being pushed (server hard block + UI + hook), so letting them promote to `ready_to_push` is harmless — they'll just show a "Reconciliation Only" badge instead of a push button. Simpler, fewer side effects.

**Adjustment B — use-xero-sync.ts guard must use DB row fields, not StandardSettlement.source.**

Line 39 hardcodes `source: 'csv_upload'` in `toStandardSettlement()`. The early-return guard in `handlePushToXero` must check `settlement.source` and `settlement.marketplace` (the raw DB row passed as parameter), not the normalized object.

---

### Updated Scope: 9 files, 2 edge function deploys, no migrations

| # | File | Change |
|---|------|--------|
| 1 | `supabase/functions/_shared/settlementPolicy.ts` | NEW — canonical `isReconciliationOnly()` |
| 2 | `src/utils/settlement-policy.ts` | NEW — client mirror |
| 3 | `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Hide push button, show "Reconciliation Only" badge |
| 4 | `src/hooks/use-xero-sync.ts` | Early return guard using `settlement.source` + `settlement.marketplace` (DB row fields) |
| 5 | `src/components/admin/accounting/PushSafetyPreview.tsx` | Red-tier block disabling confirm |
| 6 | `src/components/admin/accounting/ReconciliationHub.tsx` | Expand select to include `source, posting_state, xero_journal_id`. Show "Recon Only" badge. Show manual_hold warning with invoice ID and instructions. Block push when `posting_state = 'manual_hold'`. |
| 7 | `supabase/functions/sync-settlement-to-xero/index.ts` | Server-side 400 rejection (hard gate) |
| 8 | `supabase/functions/auto-post-settlement/index.ts` | Skip recon-only in batch eligibility + processSettlement |
| 9 | `src/actions/settlements.ts` | Expand overlap select to include `xero_journal_id`. Void-on-suppression via rollback. Always save CSV. Set `posting_state = 'manual_hold'` on void failure. Log system events. |

### Removed from scope
- ~~`supabase/functions/sync-xero-status/index.ts`~~ — promotion stays as-is; push gating handles it

### Edge function deployments
`sync-settlement-to-xero`, `auto-post-settlement` (2 deploys, not 3)

### Key implementation details

**Fix 4 (use-xero-sync.ts)**: The guard goes at line 53, before `toStandardSettlement()` is called:
```typescript
// Check DB row fields, NOT the normalized StandardSettlement
if (settlement.source === 'api_sync' && settlement.marketplace?.startsWith('shopify_orders_')) {
  toast.error('This is a Shopify-derived reconciliation record — push the marketplace CSV settlement instead.');
  return;
}
```

**Fix 6 (ReconciliationHub.tsx)**: Manual hold warning text:
*"A previous Shopify-derived invoice [xero_journal_id] could not be auto-voided in Xero. Please void it manually in Xero, then return here to push the CSV settlement."*
Push button blocked until `posting_state` is cleared.

**Fix 9 (settlements.ts)**: Overlap select expanded from `'id, settlement_id'` to `'id, settlement_id, xero_journal_id, xero_invoice_id, xero_status, posting_state'`. Rollback call uses `{ action: 'rollback', settlementId, invoiceIds: [xero_journal_id], rollbackScope: 'all' }`.

### No database migrations needed

