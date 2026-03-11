

# Marketplace Discovery & Empty State Upgrade

## Overview
Three interconnected fixes: (1) smart empty state for channel-detected marketplaces, (2) unmatched bank deposit detection in validation sweep, (3) dashboard alerts for unmatched deposits. All built universally, not hardcoded.

---

## Fix 1 — Smart Empty State

**New file:** `src/components/admin/accounting/shared/ChannelDetectedEmptyState.tsx`

- Props: `marketplaceCode`, `marketplaceName`, `onUpload`
- On mount, queries `shopify_sub_channels` for this user where `marketplace_code` matches and `settlement_type = 'separate_file'`
- If found, queries `channel_alerts` for order count + revenue matching this `source_name`
- Shows rich empty state:
  - "📦 {Name} orders found in Shopify — settlements needed"
  - "We found {N} orders totalling {$X}. To complete your accounting, upload your {Name} settlement files."
  - **Generic instructions** (not marketplace-specific): "Log in to your {Name} seller portal and look for Payments, Settlements, or Remittance reports. Download the CSV or Excel file and upload it here."
  - Two CTAs: `[Upload {Name} settlements →]` and expandable `[How to find settlements ℹ]`
- Falls back to existing empty state if no sub-channel record found

**Edit:** `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` (lines 271-281)

Replace the `settlements.length === 0` block with `<ChannelDetectedEmptyState>`, passing `onSwitchToUpload` as fallback.

---

## Fix 2 — Unmatched Bank Deposit Detection

**Edit:** `supabase/functions/run-validation-sweep/index.ts`

Add new function `unmatchedDepositPass()` called after `dedupPass()` in `sweepUser()`:

1. Uses the already-fetched `xeroBankTxns` array (RECEIVE transactions)
2. Loads user's `marketplace_connections` codes, `shopify_sub_channels` labels, and `marketplace_file_fingerprints` codes into a dynamic dictionary
3. Also loads `marketplaces` table entries for additional patterns
4. For each bank transaction, checks if it matches any known settlement (by amount ±$0.05 and date ±14 days) — skip if matched
5. Reads user's `unmatched_deposit_threshold` from `app_settings` (default $50)
6. For unmatched transactions above threshold:
   - Runs `scoreNarrationMatch()` — a scoring function that:
     - Checks narration against all marketplace names in the dynamic dictionary
     - Scores by word overlap, position, and keyword signals ("MARKETPLACE", "PTY LTD", "SELLER")
     - Returns `{ marketplace_code: string | null, confidence: number }` (0-100)
   - If confidence > 60 and user doesn't have that marketplace → upsert `channel_alerts` with `alert_type: 'unmatched_deposit'`
   - If no match or confidence ≤ 60 and amount > threshold → upsert with `alert_type: 'unknown_deposit'`
   - Stores confidence score in alert for admin visibility

**Database migration:** Add columns to `channel_alerts`:
```sql
ALTER TABLE public.channel_alerts 
  ADD COLUMN IF NOT EXISTS deposit_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_date date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS match_confidence integer DEFAULT NULL;
```

---

## Fix 3 — Dashboard Alerts for Unmatched Deposits

**Edit:** `src/components/dashboard/ChannelAlertsBanner.tsx`

Extend the `ChannelAlert` interface and `loadAlerts()` query to include the new alert types. Add two new card renderers:

- `unmatched_deposit`: "💰 We spotted a possible {marketplace} deposit — ${amount} on {date}. Upload {marketplace} settlements to reconcile it." → CTA: "Set up {marketplace} →" opens channel setup
- `unknown_deposit`: "💰 We found a deposit we couldn't match — ${amount} on {date}. Is this a marketplace payment?" → CTA: "Identify this deposit →" opens channel setup

Tone is curious and helpful, not alarming.

**Edit:** `src/components/dashboard/ActionCentre.tsx`

Add an "Unmatched Deposits" summary card in the status strip when `channel_alerts` with these types exist. Shows count and total amount.

---

## Summary of Changes

| File | Change |
|---|---|
| `src/components/admin/accounting/shared/ChannelDetectedEmptyState.tsx` | New — universal empty state component |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Replace empty state block |
| `supabase/functions/run-validation-sweep/index.ts` | Add `unmatchedDepositPass()` with scoring-based detection |
| `src/components/dashboard/ChannelAlertsBanner.tsx` | Handle `unmatched_deposit` + `unknown_deposit` alerts |
| `src/components/dashboard/ActionCentre.tsx` | Add unmatched deposits card |
| Migration | Add 4 columns to `channel_alerts` |

