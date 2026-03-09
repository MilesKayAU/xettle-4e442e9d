

## Shopify Settlements: Delete & Xero Sync Tagging

### Current State

The History tab already has:
- Select one / select all checkboxes
- Bulk delete button
- Individual delete button (but **hidden** for `synced` status settlements)

**Gaps found:**
1. **Review tab** — no way to remove individual parsed payouts before saving (e.g., deselect bad ones from a bulk upload)
2. **History bulk delete** — no guard for Xero-synced items. User can select-all and bulk delete synced settlements without warning
3. **No visual tag** on selected items showing which are already synced to Xero vs which are just saved
4. Individual delete hidden entirely for synced items — should be available with a confirmation warning instead

### Plan

**1. Review tab — individual payout removal**
- Add a dismiss/remove button (X icon) on each parsed payout card in the review tab
- Removes it from `parsedPayouts` array (doesn't touch DB since it's not saved yet)
- Updates persisted localStorage state

**2. History tab — Xero sync awareness on bulk actions**
- When items are selected, show a count breakdown: "3 selected (1 synced to Xero)"
- If any synced items are in the selection, the Delete button shows a confirmation dialog warning: "X of these settlements are already synced to Xero. Deleting will NOT remove the Xero invoice. Continue?"
- Allow delete of synced items (with warning) rather than blocking

**3. Individual delete for synced items**
- Show the delete button for synced items too, but with a confirmation toast/dialog
- "This settlement has been synced to Xero. Deleting it here won't remove the Xero invoice."

**4. Visual tagging in selection**
- In the history list, when items are selected, show a small "Xero ✓" tag next to synced items so user can see at a glance which ones have been pushed

### Files Modified

- `src/components/admin/accounting/ShopifyPaymentsDashboard.tsx` — all changes in this single file

### No database or schema changes needed.

