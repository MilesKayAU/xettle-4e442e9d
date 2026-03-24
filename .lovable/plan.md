

## Plan: Fix eBay Inventory to Use Trading API (GetMyeBaySelling)

### Problem
The current `fetch-ebay-inventory` edge function calls `GET /sell/inventory/v1/inventory_item` (REST Inventory API), which returns 400 for sellers whose listings were created via the traditional eBay listing flow. Most smaller sellers use the traditional model.

### Fix

**File: `supabase/functions/fetch-ebay-inventory/index.ts`** — Replace the REST Inventory API call with the Trading API `GetMyeBaySelling` XML call.

Changes:
- Replace lines 71-125 (the inventory fetch loop) with Trading API logic
- Use `POST https://api.ebay.com/ws/api.dll` with XML body requesting `ActiveList`
- Headers: `X-EBAY-API-SITEID: 15` (Australia), `X-EBAY-API-COMPATIBILITY-LEVEL: 1155`, `X-EBAY-API-CALL-NAME: GetMyeBaySelling`, `X-EBAY-API-IAF-TOKEN: {token}`
- Parse XML response to extract from `ActiveList.ItemArray.Item[]`: ItemID, SKU, Title, SellingStatus.CurrentPrice, QuantityAvailable, ListingDetails.ViewItemURL, PictureDetails.GalleryURL
- Handle pagination: check `TotalNumberOfPages`, increment `PageNumber` up to limit
- Use `EntriesPerPage: 200` per page
- Map to same output shape: `{ sku, title, quantity, price, listing_status, item_id, url, thumbnail }`
- If SKU is empty, use ItemID as identifier
- Keep existing timeout protection and partial result pattern

**File: `src/components/inventory/EbayInventoryTab.tsx`** — Update columns and interface:
- Add `item_id` field; display SKU with fallback to ItemID + "No SKU" badge
- Add `thumbnail` column (small image)
- Add `url` as clickable link on title
- Keep existing columns: Qty, Price, Status, Last Updated

### XML Parsing
Use Deno's built-in XML handling or simple regex extraction since the response structure is predictable and flat. A lightweight XML-to-object parser keeps the function dependency-free.

### No Other Changes
- No settlement, accounting, or other tab modifications
- Token refresh logic stays as-is (OAuth token works for Trading API via IAF-TOKEN header)
- Existing scope `sell.inventory.readonly` isn't needed for Trading API but doesn't hurt to keep

### Files Modified
1. `supabase/functions/fetch-ebay-inventory/index.ts` — Replace REST API with Trading API
2. `src/components/inventory/EbayInventoryTab.tsx` — Update columns for new fields

