

## Add Inline Preview (Eye Icon) to Settlement Tables

### Problem
Settlement rows in ValidationSweep and SettlementsOverview tables have no way for bookkeepers to quickly inspect the data summary before pushing. They must either push blind or navigate away. The `SettlementDetailDrawer` component already exists and shows a full audit view — it just needs to be wired into these tables.

### Approach
Add an "eye" icon button on each row that has a `settlement_id`. Clicking it opens the existing `SettlementDetailDrawer` as a slide-over panel showing the line-item breakdown, account codes, GST treatment, and audit trail — without leaving the page.

### Changes

**1. `src/components/onboarding/ValidationSweep.tsx`**
- Import `SettlementDetailDrawer` and the `Eye` icon from lucide-react
- Add state: `drawerSettlementId` / `drawerOpen`
- Add an eye icon button in each table row (next to the Action column or as a new column) — only visible when `row.settlement_id` exists
- Clicking opens `SettlementDetailDrawer` with that settlement ID
- Render `<SettlementDetailDrawer>` once at the bottom of the component

**2. `src/components/admin/accounting/SettlementsOverview.tsx`**
- Same pattern: import `SettlementDetailDrawer`, add drawer state
- Add an eye icon on each marketplace card row that has settlements
- Wire it to open the drawer for the latest settlement of that marketplace

### What bookkeepers see
- A small 👁 (Eye) icon appears on every row with data
- Clicking it slides open a panel showing: line items with account codes, net amount, GST treatment, contact name, posting status, and full audit trail
- They can review and close without losing their place in the table
- The existing "Push →" button still routes through PushSafetyPreview for the confirm step

### No other files change
The `SettlementDetailDrawer` component is fully built and tested. This is purely wiring it into the two tables that lack it.

