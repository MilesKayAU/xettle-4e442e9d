

## Problem

The "Verify via API" and "Re-fetch from API" buttons are buried deep inside the Settlement Detail Drawer — you have to: click the tiny eye icon on a marketplace row → scroll down past financial fields, GST section, etc. → find the buttons near the bottom. There's no obvious path from the dashboard to these actions.

## Solution: Surface verification actions directly on the dashboard

### Change 1 — Add "Verify" button to SettlementsOverview rows

In `src/components/admin/accounting/SettlementsOverview.tsx`, add a **"Verify"** action button next to the existing "Upload" and "Push to Xero" buttons for each marketplace row. This button will:
- Only show for marketplaces that have unsent or stale settlements
- Open the Settlement Detail Drawer for the latest settlement AND auto-trigger verification
- Use a lightning bolt icon (⚡) to stand out

### Change 2 — Add auto-verify prop to SettlementDetailDrawer

In `src/components/shared/SettlementDetailDrawer.tsx`:
- Add an `autoVerify?: boolean` prop
- When `true`, automatically call `handleVerifyApi()` on mount (when the drawer opens)
- This means clicking "Verify" from the overview immediately shows results without extra clicks

### Change 3 — Move verify buttons higher in the drawer

Currently the API verification section is buried after the GST breakdown (~line 827). Move it up to appear right after the core financial summary, before the GST section. This puts it in a more prominent position when users open the drawer manually.

### Change 4 — Add a dashboard-level "Re-fetch All" quick action

Add a small "Re-fetch from API" link/button in the SettlementsOverview card header (next to the title). This batch-fetches fresh API data for all marketplaces with unsent/discrepant settlements in one click.

### Files to modify
- `src/components/admin/accounting/SettlementsOverview.tsx` — add Verify button per row, add batch re-fetch
- `src/components/shared/SettlementDetailDrawer.tsx` — add `autoVerify` prop, move verify section higher

