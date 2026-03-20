

# Confirmation: Shipping Cost Estimator Already Matches Final Design

## Current State — Everything is Built

The edge function and settings UI already implement exactly what you described:

| Requirement | Status | Where |
|---|---|---|
| `shipping:enabled` toggle | Done | Settings UI + edge function guard |
| `shipping:from_postcode` | Done | Settings input + edge function uses it |
| `shipping:default_length/width/height` | Done | Settings inputs (cm) |
| `shipping:default_weight_grams` fallback | Done | Used only when Shopify variant grams = 0 |
| `shipping:default_service` (AUS_PARCEL_REGULAR) | Done | Dropdown in settings |
| Weight from Shopify `line_items[].grams` | Done | Edge function lines 372-385 |
| Destination postcode from fulfillment | Done | `fulfillment.destination.zip` (line 355-358) |
| Default box dimensions always used | Done | Lines 387-391 |
| PAC API two-step (service lookup + calculate) | Done | Lines 412-447 |
| 500ms rate limit delay | Done | Lines 422, 449 |
| Store estimate with `calculation_basis` JSONB | Done | Lines 457-493 |
| Auto-update `marketplace_shipping_stats` averages | Done | Lines 512-561 |
| Rolling 60-order and 14-order averages | Done | Lines 526-532 |
| Marketplace detection from Shopify tags/source_name | Done | Lines 365-369 |
| Batch size cap at 50 | Done | Line 166 |
| Non-dismissible analytics-only warning banner | Done | Settings UI lines 151-164 |
| Stats table with marketplace averages | Done | Settings UI lines 318-366 |

## No Changes Needed

The system works exactly as your "final design" specifies:

1. **Weight** comes from Shopify variant grams per fulfillment line item
2. **Dimensions** use default box settings (no per-product setup needed)
3. **From postcode** from settings, **to postcode** from Shopify order fulfillment
4. **Service** from settings with per-marketplace override support
5. **Averages** auto-recalculated per marketplace after each batch run

No code changes, no migrations, no new tables required. The implementation is complete and matches this design.

