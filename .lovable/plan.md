

## Problem

The `PayoutBankAccountMapper` is already accessible to all users via Dashboard → Settings (it lives in `AccountingDashboard.tsx`, which is rendered on the `/dashboard` route, NOT the admin-only `/admin` route). But it's buried as the 3rd item in a long settings list, making it hard to find.

## What needs to change

### 1. Move PayoutBankAccountMapper to top of Settings tab
**File:** `src/components/admin/accounting/AccountingDashboard.tsx` (line ~1264)

Move `<PayoutBankAccountMapper />` from its current position (after `XeroConnectionStatus`) to the **first item** in the Settings tab content (before `AmazonConnectionPanel`), with a clear section header. This ensures it's the first thing any user sees when they click Settings.

### 2. Add a "Map Bank Accounts" nudge banner on the Dashboard view
**File:** `src/pages/Dashboard.tsx`

When no `payout_account:_default` exists in `app_settings`, show a prominent banner on the main dashboard view saying "Map your Xero bank accounts to enable deposit matching" with a button that navigates directly to the Settings tab. This guides new users to set it up during their first session.

### 3. Add PayoutBankAccountMapper to the Setup flow
**File:** `src/pages/Setup.tsx`

Embed the `PayoutBankAccountMapper` component as a card in the Setup Hub page so new users encounter it during onboarding, right after connecting Xero.

### Summary

No backend changes needed. The mapper component already works for any authenticated user (it queries `app_settings` with RLS scoped to `auth.uid()`). This is purely a UI placement fix to make the feature discoverable outside the admin area.

