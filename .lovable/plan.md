

## Problem

After connecting Shopify via OAuth and completing the setup wizard, the scanning step **does not fetch Shopify orders**. It only runs:
1. `fetch-shopify-payouts` (settlements)
2. `scan-shopify-channels` (sub-channel detection)

But `scan-shopify-channels` reads from the `shopify_orders` table, which is only populated by `fetch-shopify-orders`. Since that function is never called during onboarding, the channel scanner finds zero orders and detects zero sub-channels. BigW, MyDeal, Everyday Market, Kogan, etc. are never discovered automatically.

The user also raises a valid point: why should they need to press a button to scan after connecting? The system should auto-fetch orders + payouts + scan channels as part of the onboarding flow, with no manual intervention.

## Plan

### 1. Add `fetch-shopify-orders` to the onboarding scanning step

**File: `src/components/onboarding/SetupStepScanning.tsx`**

Insert a `fetch-shopify-orders` step before `scan-shopify-channels` in the `steps` array:

```text
Current Shopify steps:
  - Fetching Shopify payouts...       → fetch-shopify-payouts
  - Scanning sub-channels...          → scan-shopify-channels

Fixed Shopify steps:
  - Fetching Shopify payouts...       → fetch-shopify-payouts
  - Fetching Shopify orders...        → fetch-shopify-orders
  - Scanning sub-channels...          → scan-shopify-channels
```

This ensures the `shopify_orders` table is populated before the channel scanner runs.

### 2. Pass `shopDomain` to `fetch-shopify-orders` during scanning

The `fetch-shopify-orders` edge function requires `shopDomain` in the body. The scanning step currently sends `{}` to every function. We need to:

- Before starting the scan loop, query `shopify_tokens` for the user's `shop_domain`
- Pass `{ shopDomain }` in the body when calling `fetch-shopify-orders`

### 3. Auto-provision marketplace connections from scan results

After `scan-shopify-channels` runs and inserts rows into `shopify_sub_channels` (with known marketplace codes like `bigw`, `mydeal`, `everyday_market`), we should auto-create `marketplace_connections` for any channel that has a known `marketplace_code` and isn't ignored. This way, detected sub-channels with high confidence automatically appear as tabs — no manual "Set up tracking" step needed for well-known marketplaces.

Add a new scan step after channel scanning:
- Query `shopify_sub_channels` for newly created entries with a non-null `marketplace_code` and `ignored = false`
- For each, upsert into `marketplace_connections` with `connection_type: 'shopify_sub_channel'`
- This makes tabs like BigW, MyDeal, Everyday Market appear immediately

### 4. Update `PostSetupBanner` auto-sync to also include `fetch-shopify-orders`

**File: `src/components/dashboard/PostSetupBanner.tsx`**

The existing auto-sync sequence already calls orders — confirmed it does: payouts → orders → channel scan. No change needed here.

### Summary of file changes

| File | Change |
|------|--------|
| `src/components/onboarding/SetupStepScanning.tsx` | Add `fetch-shopify-orders` step; query `shopify_tokens` for domain; pass domain to orders call; auto-provision marketplace connections after scan |

