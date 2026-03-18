

# Reconciliation Health Panel + Rail Label Clarity + Production Additions

## Summary

Add user guidance to prevent "why won't my settlements reconcile?" — health panel on dashboard, clearer rail labels, and rail-to-destination type validation. No API complexity, no gateway splitting.

## Changes

### 1. `src/constants/settlement-rails.ts` — Add descriptions to rails

Add `description` field to `PHASE_1_RAILS`:

| Rail | Label (updated) | Description |
|---|---|---|
| `amazon_au` | Amazon AU Payouts | Settlement payouts from Amazon Australia |
| `shopify_payments` | Shopify Payments | Bank payouts from Shopify Payments gateway only |
| `paypal` | PayPal Payouts | PayPal deposits (Shopify, eBay, or direct sales) |
| `ebay` | eBay Payouts | Settlement payouts from eBay |
| `bunnings` | Bunnings Payouts | Settlement payouts from Bunnings MarketLink |
| Others | {Name} Payouts | Settlement payouts from {Name} |

Add a `valid_destination_types` array per rail for type validation:
- PayPal rail: `['paypal', 'bank']`
- All others: `['bank', 'clearing']`

### 2. `src/components/dashboard/ReconciliationHealthPanel.tsx` — New component

A card showing setup readiness checks using only cached/local data (no API calls):

| Check | Source | Warning text |
|---|---|---|
| Xero connected | `xero_tokens` table | "Connect Xero to enable journal posting" |
| Destination accounts mapped | `app_settings` `payout_destination:*` | "Map destination accounts for all active rails" |
| Destination account type valid | Cross-check mapped account name vs rail type (PayPal rail should map to PayPal-named account) | "PayPal rail mapped to non-PayPal account" |
| Clearing accounts exist | Xero bank accounts cache — look for clearing/suspense named accounts | "No clearing accounts found — settlements may not reconcile cleanly" |
| PayPal account detected (if PayPal rail active) | Xero bank accounts cache — look for PayPal-named account | "PayPal rail active but no PayPal account in Xero" |
| Bank feed likely missing | If bank accounts exist but none have recent transactions in `bank_transactions` | "Bank feed not detected — settlements may not auto-match" |
| Fee/Sales mappings exist | `marketplace_account_mapping` for active marketplaces | "Account mappings incomplete for {marketplace}" |

Shows a summary badge: **Ready** (all green), **Incomplete** (amber warnings), **Missing Accounts** (red blockers).

### 3. `src/components/settings/RailPostingSettings.tsx` — Add explainer + descriptions

- Add top-of-card explainer text: *"Xettle generates journals per payout source. Xero bank and PayPal feeds should be connected to allow automatic reconciliation. Rails represent payout sources, not order platforms — Shopify orders paid via PayPal use the PayPal rail."*
- Show rail description as muted subtitle under each rail label

### 4. `src/components/settings/DestinationAccountMapper.tsx` — Add descriptions + type warning

- Show rail descriptions from constants as subtitles
- Add inline warning if destination account type doesn't match rail expectations (e.g. PayPal rail mapped to a non-PayPal account)

### 5. `src/pages/Dashboard.tsx` — Mount health panel + status badge

- Import and render `ReconciliationHealthPanel` on the home view, after `PostSetupBanner` / `WelcomeGuide`
- Show a small "Setup: Ready / Incomplete" badge in the dashboard header area

## Files

| File | Action |
|---|---|
| `src/constants/settlement-rails.ts` | Add `description` + `valid_destination_types` to rails |
| `src/components/dashboard/ReconciliationHealthPanel.tsx` | New — 7-check health panel with summary badge |
| `src/components/settings/RailPostingSettings.tsx` | Add explainer text + rail descriptions |
| `src/components/settings/DestinationAccountMapper.tsx` | Add descriptions + destination type mismatch warning |
| `src/pages/Dashboard.tsx` | Mount health panel + status badge |

## What this does NOT do

- No gateway auto-splitting for Shopify
- No PayPal API connection
- No bank API connection
- No multi-rail API checks

Xettle generates correct journals. Xero feeds handle matching. This is correct accounting for v1.

