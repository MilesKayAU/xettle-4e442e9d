

# Build Fix 72 — Payment Verification Layer (with confirmed additions)

## Confirmed Additions

### Addition 1: Accounting Rules Constant File
Create `src/constants/accounting-rules.ts` with the exact constant block specified. Import and reference at the entry point of:
- `supabase/functions/verify-payment-matches/index.ts` (new)
- `supabase/functions/sync-settlement-to-xero/index.ts` (line ~1, add import comment + constant reference)
- `supabase/functions/match-bank-deposits/index.ts` (line ~1)
- `supabase/functions/auto-push-xero/index.ts` (line ~1)
- `src/components/admin/accounting/PushSafetyPreview.tsx` (line ~13, after existing imports)

Note: Edge functions cannot import from `src/` — each edge function will embed the constants inline with a comment referencing the canonical file. Frontend components will use the actual import.

### Addition 2: Migration Files
Two migration files in `supabase/migrations/` with `20260312` date prefix:
1. `20260312_payment_verifications.sql` — Creates `payment_verifications` table with RLS
2. Both will be created via the migration tool (which generates UUID-suffixed filenames automatically)

### Addition 3: ARCHITECTURE.md — Rule #11
Append to `ARCHITECTURE.md` after line 96:

```text
## Rule 11: Three-Layer Accounting Source Model (Hardcoded, Never Configurable)

Orders     → NEVER create accounting entries
Payments   → NEVER create accounting entries
Settlements → ONLY source of accounting entries

Payment matching is VERIFICATION ONLY — no invoice, no journal, no Xero push.
This rule is enforced by `src/constants/accounting-rules.ts` and referenced
at the entry point of every payment and sync function.

Canonical constant file: `src/constants/accounting-rules.ts`
```

---

## Full Build Scope

### Files to Create
| File | Purpose |
|------|---------|
| `src/constants/accounting-rules.ts` | Canonical accounting rules constant |
| `supabase/functions/verify-payment-matches/index.ts` | Payment verification logic (suggestion-only) |
| `src/components/settings/PaymentVerificationSettings.tsx` | Settings UI for gateway toggles |

### Files to Modify
| File | Change |
|------|--------|
| `ARCHITECTURE.md` | Add Rule #11 |
| `supabase/functions/match-bank-deposits/index.ts` | Add Rule #11 comment + constant reference |
| `supabase/functions/auto-push-xero/index.ts` | Add Rule #11 comment + constant reference |
| `supabase/functions/sync-settlement-to-xero/index.ts` | Add Rule #11 comment + constant reference |
| `supabase/functions/scan-xero-history/index.ts` | Add PayPal/Shopify bank account detection |
| `src/components/admin/accounting/PushSafetyPreview.tsx` | Import accounting rules constant |
| `src/components/dashboard/OutstandingTab.tsx` | Add payment verification states (5-state UI) |
| `supabase/config.toml` | Add `verify-payment-matches` function entry |

### Database Migration
`payment_verifications` table:
- `id`, `user_id`, `settlement_id`, `gateway_code`, `xero_tx_id`, `match_amount`, `match_method`, `match_confidence`, `match_confirmed_at`, `match_confirmed_by`, `order_count`, `created_at`, `updated_at`
- Unique constraint on `(settlement_id, gateway_code, user_id)`
- RLS: users manage own rows only

### Edge Function: `verify-payment-matches`
- Entry point: Rule #11 comment block + Golden Rule comment
- Reads `app_settings` for enabled gateways and detected Xero account IDs
- Fetches Xero BankTransactions for each enabled gateway account (last 30 days)
- Groups orders by gateway within ±5 day window, applies ±3% fee tolerance
- Scores candidates (amount > narration > date proximity)
- Returns suggestions only — never writes to DB

### `scan-xero-history` Addition
- After existing bank scan, query Xero Chart of Accounts for Type=BANK
- Detect PayPal (`paypal`, `pypl`) and Shopify Payments (`shopify`, `stripe`) accounts
- Store detected account IDs in `app_settings`
- Auto-enable verification for detected accounts

### UI: Payment Verification Settings
- Settings page toggle per gateway channel
- Amber warning if no Xero bank account detected for that gateway
- Reads/writes `app_settings`

### UI: OutstandingTab Payment States
5 states per gateway (same pattern as Amazon bank matching):
- Green: "Payment confirmed"
- Amber: "Confirm payment match" + candidate details
- Grey: "Find in Xero →"
- Blue: "Manually confirmed"
- Yellow: "No feed detected" → links to settings

