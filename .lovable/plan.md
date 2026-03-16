

# Plan: "Create Missing Accounts in Xero" — Option B (Admin-gated, behind toggle)

## What the screenshot shows
Your mapper has marketplace-specific rows (bigw Sales, everyday_market Sales) falling back to the generic `211` account because no dedicated Xero accounts exist for them yet. You need a way to create those accounts **from within Xettle** instead of switching to Xero manually.

## Approach: Default manual + optional "Create in Xero" toggle

### 1. New Edge Function: `create-xero-accounts`
- JWT-verified, admin-role gated (checked server-side via `has_role('admin')`)
- Accepts an array of proposed accounts: `{ code: string, name: string, type: string, tax_type?: string }[]`
- Validates: no duplicate codes (against cached COA), allowed types only (REVENUE/EXPENSE/DIRECTCOSTS), max 10 per batch
- Calls Xero PUT `/api.xro/2.0/Accounts` for each account
- After creation, triggers a COA cache refresh (reuses existing refresh logic inline)
- Logs `system_events`: `xero_account_created` with created account IDs
- Returns created accounts with their new `xero_account_id`

### 2. New Canonical Action: `createXeroAccounts()` in `src/actions/xeroAccounts.ts`
- Wraps the edge function invoke
- Re-exported via `src/actions/index.ts`
- Returns `{ success, created: { code, name, xero_account_id }[], error? }`

### 3. UI Changes in `AccountMapperCard.tsx`

**When `CommandEmpty` fires (no matching account found):**
- Show: "No matching account found in Xero"
- If admin: show a "Create in Xero..." button below the empty state
- Clicking opens a confirmation dialog pre-filled with a suggested code + name based on the category/marketplace context (e.g., code: `214`, name: `BigW Sales AU`, type: `REVENUE`)

**New `CreateAccountDialog` component (inline in AccountMapperCard):**
- Fields: Account Code (editable), Account Name (editable), Account Type (auto-set based on category, selectable)
- Warning banner: "This will create a new account in your Xero Chart of Accounts. This cannot be undone from Xettle."
- "Create & Map" button → calls `createXeroAccounts()` → on success, refreshes COA cache → auto-selects the new account in the dropdown

**Feature gating:**
- Check admin role via existing `has_role` pattern (query `user_roles` table client-side or use existing admin auth hook)
- Non-admins see only "No matching account — create this account in Xero manually, then Refresh"

### 4. Smart Code Suggestion Logic
When proposing a new account, auto-suggest the next available code:
- Look at existing codes in the same type range (e.g., if Sales accounts are 200-213, suggest 214)
- Name pattern: `{Marketplace} {Category} AU` (e.g., "BigW Sales AU", "Everyday Market Sales AU")

### 5. Guardrails & Audit Matrix
- Add `create-xero-accounts` to `docs/action-audit-matrix.md` Section J
- Add guardrail test: block direct invoke of `create-xero-accounts` outside canonical actions
- Block direct writes — creation only goes through edge function, which refreshes cache atomically

### 6. No Database Migration Needed
The existing `xero_chart_of_accounts` table already supports storing the newly created accounts after the post-creation COA refresh.

## Technical Details

```text
User clicks "Create in Xero..."
  → CreateAccountDialog opens (code, name, type pre-filled)
  → User confirms
  → createXeroAccounts([{ code: "214", name: "BigW Sales AU", type: "REVENUE" }])
  → Edge function: validate → Xero API PUT → refresh COA cache → log event
  → UI: COA state refreshed → auto-select new account in combobox
```

## Files to create/modify
- **Create:** `supabase/functions/create-xero-accounts/index.ts`
- **Edit:** `src/actions/xeroAccounts.ts` — add `createXeroAccounts()`
- **Edit:** `src/actions/index.ts` — re-export
- **Edit:** `src/components/settings/AccountMapperCard.tsx` — add CreateAccountDialog, update CommandEmpty, add admin gate
- **Edit:** `docs/action-audit-matrix.md` — Section J update
- **Edit:** `src/actions/__tests__/canonical-actions.test.ts` — add guardrail
- **Edit:** `supabase/config.toml` — add function config

