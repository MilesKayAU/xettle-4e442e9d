

# Revised Plan: Shipping Cost Estimate (Insights Only, PAC API) — Production Grade

## Overview
Estimate shipping cost per fulfilled Shopify order using Australia Post PAC API (two-step: service lookup then calculate). **Analytics only** — no accounting, Xero, settlement, or reconciliation impact.

## Prerequisites
- `AUSPOST_PAC_API_KEY` secret (requested via `add_secret`)
- Shopify connected with product weights at variant level
- Default dimensions represent carton/packaging, not product dimensions

## Database — 2 New Tables (Migration)

### `order_shipping_estimates`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | RLS filter |
| shopify_order_id | bigint | |
| shopify_fulfillment_id | text | **Keyed off fulfillment** |
| marketplace_code | text | Via server-side `marketplace_registry` |
| tracking_number | text | nullable, optional |
| estimated_cost | numeric | PAC result |
| estimate_quality | text | 'high' / 'medium' / 'low' |
| weight_grams | numeric | |
| from_postcode | text | |
| to_postcode | text | |
| service_code | text | Actual service used |
| source | text | 'pac_estimate' / 'manual_override' / 'carrier_import' / 'carrier_api' |
| carrier | text | 'auspost' / 'starshipit' / 'manual' — future-proof |
| fulfilled_at | timestamptz | From Shopify fulfillment |
| calculation_basis | jsonb | Full audit of inputs, defaults used, chosen service |
| created_at | timestamptz | |

**Constraints:**
- `UNIQUE(user_id, shopify_fulfillment_id)` — prevents duplicate estimates

**Indexes:**
- `(user_id, fulfilled_at DESC)`
- `(user_id, marketplace_code)`

**estimate_quality logic:**
- `high` = real product weight + real package dimensions
- `medium` = real product weight + default box dimensions
- `low` = default weight + default dimensions

RLS: authenticated users manage own rows.

### `marketplace_shipping_stats`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | RLS filter |
| marketplace_code | text | |
| avg_shipping_cost_60 | numeric | Rolling avg, last 60 fulfilled orders |
| avg_shipping_cost_14 | numeric | nullable, last 14 fulfilled orders |
| sample_size | integer | |
| last_updated | timestamptz | |

RLS: authenticated users manage own rows.

## Edge Function: `estimate-shipping-cost`

Accepts `{ batch_size?: number }` (default 20, max 50).

**Guard:** If `shipping:enabled` != `'true'` in `app_settings` → return immediately.

**Must NOT read or write:** settlements, journals, reconciliation, xero_invoices, or any accounting tables.

Steps:
1. Read user's shipping settings from `app_settings`
2. Query `shopify_orders` for orders meeting ALL criteria:
   - Has fulfillment data (`fulfilled_at IS NOT NULL`)
   - `cancelled_at IS NULL`
   - `financial_status != 'voided'`
   - `test = false` (if field exists)
   - Not already in `order_shipping_estimates` (LEFT JOIN on `shopify_fulfillment_id`)
   - **ORDER BY `fulfilled_at ASC`** (deterministic batching)
   - LIMIT `batch_size`
3. For each order:
   - **Detect `marketplace_code`** using `marketplace_registry` table server-side (query `detection_keywords`, `shopify_source_names` — replicate tag/source_name matching logic, do NOT import from `src/`)
   - Extract shipping postcode from order data, weight from line items
   - Determine `estimate_quality` based on real vs defaulted data
   - **Convert `weight_grams` to kg** before PAC call (`weight_grams / 1000`)
   - **Step 1:** Call PAC service lookup: `GET .../postage/parcel/domestic/service.json` to get available services
   - **Step 2:** If default service available for this route, call `GET .../postage/parcel/domestic/calculate.json`. If default not available, fall back to first available service. **If NO service returned → skip estimate**, log `calculation_basis.reason = "no_service_available"`, do NOT store a $0 estimate
   - Build `calculation_basis` JSON: `{ from_postcode, to_postcode, weight_grams, weight_kg, length, width, height, chosen_service_code, defaults_used: { weight, dimensions }, available_services, reason? }`
   - Store `fulfilled_at`, `shopify_fulfillment_id`, `carrier: 'auspost'`
   - Optionally store `tracking_number` if present
   - **If `shopify_fulfillment_id` already exists → skip** (unique constraint also enforces)
   - **500ms delay between PAC API calls**
4. Upsert into `order_shipping_estimates`
5. Recalculate `marketplace_shipping_stats` — **from `order_shipping_estimates` table only** (not from `shopify_orders`), rolling avg of last 60 and last 14 fulfilled orders per marketplace, excluding cancelled/voided orders
6. Return `{ estimated, skipped, errors, skipped_no_service }`

## Settings (in `app_settings`)

| Key | Notes |
|---|---|
| `shipping:enabled` | boolean toggle |
| `shipping:from_postcode` | sender postcode |
| `shipping:default_weight_grams` | fallback when Shopify missing |
| `shipping:default_length` | cm |
| `shipping:default_width` | cm |
| `shipping:default_height` | cm |
| `shipping:default_service` | 'AUS_PARCEL_REGULAR' or 'AUS_PARCEL_EXPRESS' |
| `shipping:service_override:{marketplace_code}` | optional per-marketplace override |

## UI Changes

### New: `src/components/settings/ShippingEstimateSettings.tsx`
- Enable/disable toggle
- **Non-dismissible warning banner:** "Estimated shipping cost is calculated using Australia Post PAC API. Accuracy depends on correct weight and dimensions in Shopify. Shopify product weights must be maintained at the variant level. Package dimensions use your default carton settings, not product dimensions. This data is used only for Insights and profitability analysis. It is not used for accounting or Xero exports."
- From postcode, default weight/dimensions inputs
- Default service selector (Regular / Express)
- Per-marketplace service override (optional)
- Per-marketplace average table showing both 60-order and 14-order averages
- "Estimate Now" button with batch_size selector

### Modified: `src/components/admin/accounting/InsightsDashboard.tsx`
- Read `marketplace_shipping_stats` and show per marketplace:
  - **"Avg Shipping (est.)"** with value
  - **Amber badge:** "PAC estimate"
  - **Quality indicator:** e.g. "Quality: medium · Sample: 48"
  - **Tooltip:** "Estimate based on Shopify weights/dimensions and Australia Post PAC API. Not used in Xero or settlement calculations."
- Use `avg_shipping_cost_60` in Insights profit calculation only

### Modified: Settings/Admin area
- Add "Shipping Estimate" section linking to new component

## Files

### New
- `supabase/functions/estimate-shipping-cost/index.ts`
- `src/components/settings/ShippingEstimateSettings.tsx`

### Modified
- `src/components/admin/accounting/InsightsDashboard.tsx`
- `src/pages/Admin.tsx` (or settings area — add tab/section)

## Sequence
1. Request `AUSPOST_PAC_API_KEY` secret
2. Create 2 tables + constraints + indexes via migration
3. Build settings UI + warning banner
4. Build edge function (fulfilled orders only, two-step PAC, full `calculation_basis`, server-side marketplace detection)
5. Compute marketplace averages from `order_shipping_estimates` only (60 + 14 window)
6. Surface in Insights cards with quality + sample size

## What is NOT changed
- Settlements, Xero, journals, reconciliation, period locks, accounting exports
- Existing `marketplace_shipping_costs` table (manual per-order — kept separate)
- Profit engine (accounting-grade)

