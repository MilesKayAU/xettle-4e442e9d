

## Revised Plan: Read-Only Unified Inventory Dashboard (Phase 1)

All details from the previously approved plan remain intact. This revision adds three mandatory constraints and one clarification.

### Added Constraint 1 — Accounting Isolation

The inventory module must not import any settlement, validation, or Xero push logic. Specifically, no file in `src/components/inventory/` or `supabase/functions/fetch-*-inventory/` may import from:

- `src/utils/settlement-policy.ts`
- `src/utils/settlement-engine.ts`
- `src/utils/settlementSources.ts`
- `src/utils/reconciliation-engine.ts`
- `src/utils/marketplace-reconciliation-engine.ts`
- `src/hooks/use-xero-sync.ts`
- `src/hooks/use-reconciliation.ts`
- `src/actions/settlements.ts`
- `supabase/functions/_shared/settlementPolicy.ts`
- `supabase/functions/_shared/settlementSources.ts`

Shared dependencies that ARE allowed: `marketplace_connections` queries, token tables (`shopify_tokens`, `amazon_tokens`, `ebay_tokens`, `mirakl_tokens`), `marketplace-codes.ts`, `connection-status.ts`, UI components, auth helpers.

### Added Constraint 2 — Timeout Protection & Partial Results

Each inventory edge function must:

- Set a per-page fetch timeout (8 seconds per API page)
- If a page fails or times out, return whatever was successfully fetched so far plus a `partial: true` flag and `error` message
- The frontend renders partial data with a warning banner: "Some results could not be loaded. Tap Refresh to try again."
- The Universal tab must not block if one platform fails — it renders available data and shows a greyed-out column for the failed platform

### Added Constraint 3 — First Fetch Limit

- Each edge function returns a maximum of **500 items** on first call
- Response includes `hasMore: true` and `nextCursor` when truncated
- Each tab shows a "Load more" button when `hasMore` is true
- Universal tab merges only the first 500 per platform — the "Load more" action is per-tab only

### Kogan Credential Clarification

Searched the codebase: **no Kogan token table or credential storage exists**. Kogan is currently a Shopify sub-channel only (`shopify_sub_channel` connection type). The Kogan API integration requires new credential storage. Options:

1. Use `app_settings` table with keys like `kogan_api_seller_id` and `kogan_api_seller_token` — matches existing pattern for simple key-value secrets
2. Create a `kogan_tokens` table — matches the pattern of `shopify_tokens`, `amazon_tokens`, `ebay_tokens`

**Recommendation**: Use `app_settings` for Phase 1 since Kogan API uses a static seller ID + token (not OAuth), similar to how `auspost_pac_api_key` is stored. Add a Kogan API credential input in the API Connections panel. No new table needed.

### Updated Files List

Same as approved plan plus:
- `src/components/settings/ApiConnectionsPanel.tsx` — Add Kogan API credential input fields and "inventory visible" notes

### All Other Details

Navigation, tab structure, edge functions, UI components, Universal tab logic, filters, empty states — all unchanged from the approved plan.

