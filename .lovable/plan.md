

## Plan: Split RDT Fetches, Add PII Diagnostics, Block Unsafe Live Syncs

### What and Why

The current RDT request asks Amazon for both `buyerInfo` and `shippingAddress` in a single call. If Amazon denies access to either, the entire request fails and no PII is returned. ChatGPT's suggestion to split these into independent requests is correct and matches Amazon's authorization model. This plan implements that plus clear admin diagnostics and a safety gate.

### Steps

1. **Split RDT into two independent fetches** (edge function)
   - Replace single `getRestrictedDataToken` call with two separate attempts: one for `buyerInfo`, one for `shippingAddress`
   - Each attempt returns its own RDT; use each RDT to fetch the order independently
   - Merge results: start with base order, overlay buyer fields from buyerInfo RDT fetch, overlay shipping fields from shippingAddress RDT fetch
   - Build a structured `pii_access` object tracking what was attempted/granted/denied per element
   - Build a `missing_required_fields` array for fulfillment-critical fields

2. **Store structured PII results in the order record** (edge function)
   - Save `pii_access` status and `missing_required_fields` into `raw_amazon_payload` alongside the order data
   - Replace generic `error_detail: 'dry_run'` with a human-readable summary of what was recovered and what is missing

3. **Add fulfillment readiness gate for live syncs** (edge function)
   - Before Shopify order creation, check for hard-block fields: `recipient_name`, `address_line_1`, `city`, `postal_code`, `country`
   - If any hard-block field is missing, set status to `blocked_missing_pii` with a clear `error_detail` and skip Shopify creation
   - Allow sync to proceed with warnings for soft-missing fields: `buyer_email`, `buyer_name`, `phone`

4. **Add PII warning card in expanded order row** (FulfillmentBridge.tsx)
   - When `raw_amazon_payload.pii_access` exists, show a diagnostic card with:
     - Buyer info access: granted/denied
     - Shipping address access: granted/denied
     - Recovered fields checklist (city, state, postcode, country)
     - Missing fields blocking sync (recipient name, address line 1)
   - Plain-English note explaining the Amazon permission requirement
   - Add `blocked_missing_pii` status color to STATUS_COLORS map

5. **Delete existing dry_run row** for order `250-3366733-4698245` so next dry run uses new logic

### Technical Detail

**Edge function changes** (`supabase/functions/sync-amazon-fbm-orders/index.ts`):

- New function `getRestrictedDataTokenForElement(baseUrl, accessToken, orderId, dataElement)` — requests RDT for a single element
- New function `fetchOrderPiiSplit(baseUrl, accessToken, orderId)` — calls the above twice, fetches order with each successful RDT, merges results, returns `{ mergedOrder, piiAccess, missingRequiredFields }`
- Replace `fetchOrderWithPii` call at line ~561 with `fetchOrderPiiSplit`
- At dry-run save (line ~588), write structured `error_detail` with missing fields summary
- Before Shopify creation (line ~620), add gate checking `missingRequiredFields` for hard-block items

**UI changes** (`src/components/admin/FulfillmentBridge.tsx`):

- New `PiiAccessCard` component rendering the diagnostic checklist
- Render it in the collapsible row when `pii_access` key exists in payload
- Add `blocked_missing_pii: 'bg-red-100 text-red-700 border-red-300'` to STATUS_COLORS

**Hard-block fields**: `recipient_name`, `address_line_1`, `city`, `postal_code`, `country_code`
**Soft-warn fields**: `buyer_name`, `buyer_email`, `phone`

