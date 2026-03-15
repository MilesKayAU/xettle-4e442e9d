

## Problem

Settlements that already exist as **PAID** invoices in Xero (detected via the `xero_accounting_matches` table) are still appearing in the "Send to Xero" to-do list. Currently the system only shows a "Duplicate Risk" warning badge but leaves them in `ready_to_push` status, creating noise and confusion.

This applies to both Amazon and Shopify settlements where external tools (e.g. Link My Books) have already posted and reconciled the invoices.

## Solution

Auto-resolve settlements that have a confirmed external match with PAID status, moving them out of the to-do list entirely.

### Changes

**1. ActionCentre.tsx — Filter out externally-matched PAID settlements from "Send to Xero" card**

After fetching `xero_accounting_matches` for ready settlements (lines 207-216), also fetch the `xero_status` field. Settlements where the match has `xero_status = 'PAID'` should be:
- Auto-updated in the database to `status = 'already_recorded'` with a note indicating they were externally reconciled
- Removed from the `readySettlements` state so they don't appear in the to-do card

Settlements with external matches that are NOT PAID (DRAFT/AUTHORISED) remain as "Duplicate Risk" warnings — the user should still decide on those.

**2. RecentSettlements.tsx — Same filtering logic**

The `fetchAll` function (around line 350) already queries `xero_accounting_matches`. Extend it to fetch `xero_status` alongside `settlement_id`. Settlements with PAID external matches should:
- Show as "Already in Xero ✓" (green) instead of "Duplicate Risk" (red)
- Be categorized as `completed` rather than `ready`

**3. sync-xero-status edge function — Auto-resolve during sync**

Add a step at the end of the sync cycle: query all `ready_to_push` settlements that have a matching `xero_accounting_matches` row with `xero_status = 'PAID'`, and batch-update them to `already_recorded`. This ensures cleanup happens even if the user doesn't visit the dashboard.

### Technical Detail

```text
Current flow:
  ready_to_push + external match → ⚠ "Duplicate Risk" badge (still in to-do)

New flow:
  ready_to_push + external match (PAID)   → auto-set already_recorded, remove from to-do
  ready_to_push + external match (DRAFT)  → ⚠ "Duplicate Risk" badge (keep in to-do)
  ready_to_push + no external match       → normal "Send to Xero" (keep in to-do)
```

### Files to Modify

| File | Change |
|------|--------|
| `src/components/dashboard/ActionCentre.tsx` | Fetch xero_status from matches; auto-resolve PAID ones; filter from readySettlements |
| `src/components/dashboard/RecentSettlements.tsx` | Same: fetch xero_status, show "Already in Xero ✓" for PAID matches, categorize as completed |
| `supabase/functions/sync-xero-status/index.ts` | Add batch auto-resolve step for ready_to_push settlements with PAID external matches |

