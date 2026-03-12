

# Auto-Generate Settlements from Shopify Orders

## Problem
Shopify orders are fetched and cached in `shopify_orders` but never automatically converted to `settlements` records. All insight reports (Fee Intelligence, Channel Comparison, 12-Month Trend) only query `settlements`. Result: Shopify sub-channels (Kogan, eBay, MyDeal, etc.) are invisible in reports.

## Current Flow
```text
Shopify API → shopify_orders (cached) → DEAD END
```

## Target Flow
```text
Shopify API → shopify_orders (cached)
                    ↓
        auto-generate-shopify-settlements (new edge function)
                    ↓
        settlements table (per marketplace)
                    ↓
        Insights / Fee Intelligence / Profit Engine
```

## Changes

### 1. New Edge Function: `auto-generate-shopify-settlements`

Reads `shopify_orders` for a user (last 60 days by default), groups orders by detected marketplace, and upserts settlement records.

**Detection logic** (ported from `shopify-order-detector.ts` to server-side):
- Priority 1: **Tags** — split by comma, match against `marketplace_registry` table + hardcoded registry
- Priority 2: **Note Attributes** — match values against registry
- Priority 3: **Gateway** — e.g. `commercium by constacloud` → Kogan
- Priority 4: **Source Name** — `web` → Shopify Store, `pos` → POS (only if no aggregator tags)
- Uses `marketplace_registry` DB table for dynamic detection (not just hardcoded list)

**Settlement generation:**
- Groups orders by detected `marketplace_code` + month
- Generates deterministic `settlement_id`: `shopify_auto_{marketplace}_{YYYY_MM}_{user_id_prefix}`
- Calculates: `sales_principal` (subtotal), `gst_on_income` (total_tax), `bank_deposit` (total_price)
- Upserts to `settlements` with `source: 'api_sync'`, `status: 'parsed'`
- Also provisions `marketplace_connections` for newly detected channels

**Safety:**
- Uses `ON CONFLICT (settlement_id)` upsert — re-running is idempotent
- `source = 'api_sync'` distinguishes from manual CSV uploads
- Never overwrites settlements with `source = 'manual'`
- Never creates Xero entries — settlements start as `parsed`

### 2. Update `scheduled-sync` (Step 2.6)

After Step 2.5 (channel scan), add a new step that calls `auto-generate-shopify-settlements` for each Shopify user. Approximately 15 lines added.

### 3. Update Dashboard Sync Trigger

In `PostSetupBanner.tsx` and `Dashboard.tsx`, after `fetch-shopify-orders` completes, call `auto-generate-shopify-settlements` to make data immediately visible.

### 4. Config Registration

Add `[functions.auto-generate-shopify-settlements]` with `verify_jwt = false` to `supabase/config.toml`.

## Files Affected

| File | Change |
|------|--------|
| `supabase/functions/auto-generate-shopify-settlements/index.ts` | **New** — core logic |
| `supabase/functions/scheduled-sync/index.ts` | Add Step 2.6 call |
| `src/components/dashboard/PostSetupBanner.tsx` | Call after Shopify order fetch |
| `supabase/config.toml` | Register new function |

## Detection Strength

The edge function will query `marketplace_registry` from the database for dynamic keyword matching, combined with hardcoded fallbacks for common marketplaces. This ensures:
- `tags contains "Kogan"` → `kogan`
- `gateway = "commercium by constacloud"` → `kogan`  
- `tags contains "eBay"` → `ebay`
- `source_name = "web"` + no aggregator tags → `shopify_web` (website)
- Aggregator tags present but no marketplace match → skipped (not misattributed)

## Safety Rules
- Never creates Xero payments or invoices
- Never modifies existing manual settlements
- Idempotent via deterministic settlement IDs
- 60-day default window keeps data volume manageable

