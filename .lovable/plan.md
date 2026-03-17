

## Problem: Per-Row "Sync" Button Triggers Full Pipeline — Never Targets Specific Marketplace

The root cause is in how the sync architecture works:

1. **`runMarketplaceSync(code)` in `src/actions/sync.ts`** sends `{ marketplace: code }` to the `scheduled-sync` edge function
2. **`scheduled-sync` completely ignores the `marketplace` parameter** — it always runs the full 10-step pipeline (Xero audit → bank fetch → Amazon → eBay → Shopify → channel scan → validation sweep → auto-push → bank matching) for ALL users
3. **The full pipeline takes up to 5 minutes** and may timeout before reaching Step 7 (validation sweep), so the `marketplace_validation` table never gets updated
4. **After sync, `setTimeout(() => loadData(), 3000)` just re-reads the stale `marketplace_validation` table** — the validation sweep hasn't run yet

This means clicking "Sync" on an eBay row triggers the entire pipeline including Amazon, Shopify, Xero, bank matching, etc. — and the 3-second reload fires before any results are written.

## Solution: Direct Marketplace Fetch + Targeted Validation Refresh

### File: `src/actions/sync.ts`
Add a new `runDirectMarketplaceSync(code)` function that:
- Maps marketplace codes to their specific fetch edge function (`amazon_au` → `fetch-amazon-settlements`, `ebay_au`/`ebay` → `fetch-ebay-settlements`, `shopify_payments` → `fetch-shopify-payouts`)
- Calls that specific function directly (not through `scheduled-sync`)
- After the fetch completes, calls `run-validation-sweep` to update the `marketplace_validation` table
- Falls back to `scheduled-sync` for marketplaces without a dedicated API fetch function

### File: `src/components/onboarding/ValidationSweep.tsx`
Update the per-row `onSync` handler (line ~724-740):
- Replace `runMarketplaceSync(row.marketplace_code)` with `runDirectMarketplaceSync(row.marketplace_code)`
- Increase the reload delay from 3s to 5s to account for validation sweep
- Add a second delayed reload at 10s as a safety net

Update the "Sync All" button (line ~804-814):
- Keep using the full pipeline for batch sync
- But also trigger `run-validation-sweep` explicitly after
- Increase reload delay to 8s

### Marketplace → Edge Function Mapping
```
amazon_au     → fetch-amazon-settlements
ebay_au/ebay  → fetch-ebay-settlements  
shopify_payments → fetch-shopify-payouts
(others)      → scheduled-sync (fallback)
```

Each direct call will pass `sync_from` based on a 2-month lookback (matching the scheduled-sync default).

