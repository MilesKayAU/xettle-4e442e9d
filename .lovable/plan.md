

## Fix: Shopify Missing from Data Integrity Scanner Label

### What's Actually Happening

Shopify **IS** included in all cron jobs. The `scheduled-sync` edge function runs:
- Step 5: `fetch-shopify-payouts` (per-user locks, auto-sync opt-out)
- Step 5.5: `scan-shopify-channels` (sub-channel detection)
- Step 5.6: `auto-generate-shopify-settlements` (order-to-settlement conversion)
- Step 6.5: `fetch-shopify-inventory` (inventory cache refresh)

All with proper lock acquisition, cooldown checks, and auto-sync toggles — identical to Amazon/eBay/Mirakl.

### The Only Bug

The **label text** in `src/actions/dataIntegrity.ts` line 59 says:

```text
'Fetches latest data from eBay, Amazon, Mirakl'
```

It should say:

```text
'Fetches latest data from eBay, Amazon, Shopify, Mirakl'
```

### Fix

**File: `src/actions/dataIntegrity.ts`** — Update line 59 description to include Shopify.

That's it. One line. All cron jobs and sync orchestration are correct.

### Cron Coverage Verification

| Rail | Cron Step | Lock | Cooldown | Auto-sync toggle |
|------|-----------|------|----------|-----------------|
| Amazon | Step 4 | `acquire_sync_lock` | `amazon_rate_limit_until` | `auto_sync_enabled:amazon` |
| eBay | Step 4.5 | `acquire_sync_lock` | `ebay_rate_limit_until` | `auto_sync_enabled:ebay` |
| Mirakl | Step 4.7 | — | — | `auto_sync_enabled:mirakl` |
| Shopify | Step 5 | `acquire_sync_lock` | — | `auto_sync_enabled:shopify` |
| Xero | Step 1 | — | — | `auto_sync_enabled:xero` |

All 5 API rails are covered with proper governance.

