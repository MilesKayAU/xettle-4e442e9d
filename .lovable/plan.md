

# Fix: Homepage Settlements Cards — Conflicting Counts and Redundant Navigation

## Problem

The homepage has two separate components both showing "ready for Xero" data with conflicting numbers:

1. **ActionCentre card** ("Ready for Xero" — badge 15): queries `marketplace_validation` filtering `overall_status === 'ready_to_push'` only
2. **RecentSettlements card** ("Ready to Push to Xero" — shows 19): queries `marketplace_validation` filtering `overall_status === 'ready_to_push' OR 'pushed_to_xero'` — incorrectly including already-pushed items in the "ready" count

Both cards navigate to the same Settlements Overview page. The labels sound identical yet show different numbers, which is confusing.

## Root Cause

In `RecentSettlements.tsx` line 457:
```typescript
if (r.overall_status === 'ready_to_push' || r.overall_status === 'pushed_to_xero') {
  ready++;  // BUG: pushed_to_xero items are NOT "ready to push"
```

This inflates the count by including settlements already sent to Xero.

## Fix (3 changes)

### 1. Fix the count in RecentSettlements (`src/components/dashboard/RecentSettlements.tsx`)

In `fetchValidationCounts`, change the ready count to only include `ready_to_push` — not `pushed_to_xero`:

```typescript
if (r.overall_status === 'ready_to_push') {
  ready++;
  readyTotal += r.settlement_net || 0;
}
```

This makes both cards show the same number (15).

### 2. Rename the bottom card to avoid confusion

Change the `summaryCards` label from "Ready to Push to Xero" to "Ready for Xero" to match the ActionCentre card exactly — reinforcing that they show the same data. Both cards already navigate to the same place, so consistent naming removes ambiguity.

### 3. Remove the redundant "Ready for Xero" card from ActionCentre OR the summary card from RecentSettlements

Since both cards show the same data and navigate to the same place, the bottom "Ready to Push to Xero" summary card in RecentSettlements is redundant when `actionableOnly` mode is active (homepage). Remove the "ready" summary card from RecentSettlements in `actionableOnly` mode, since ActionCentre already handles it with better detail (shows individual settlement rows, duplicate risk, manual vs auto-post breakdown).

The RecentSettlements table below should still show the actionable rows — just without the duplicate summary card above it.

## Files to modify

| File | Change |
|------|--------|
| `src/components/dashboard/RecentSettlements.tsx` | Fix `fetchValidationCounts` to exclude `pushed_to_xero` from ready count; hide the "Ready to Push" summary card when `actionableOnly` is true |

## Expected outcome

- Both components agree on the same "ready" count
- No duplicate "Ready for Xero" / "Ready to Push to Xero" cards on the homepage
- The RecentSettlements table still shows actionable rows with their actions
- Clicking "Review all ready items" in ActionCentre navigates to Settlements Overview with the correct filter

