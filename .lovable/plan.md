

# Enhance Order Monitor with Product Info, Amazon Deep Links, and Customer Context

## Problem
The Order Monitor table shows "Placeholder" for customer and no product details. Admins can't tell which product an order is for or quickly navigate to the Amazon order page to get customer/shipping info for the screenshot workflow.

## What Gets Built

### 1. Product Column
Extract product info from `raw_amazon_payload.orderItems` (already stored — contains SKU, ASIN, quantity, title). Display the first item's title/SKU in a new "Product" column. If multiple items, show count badge ("+ 2 more").

### 2. Amazon Order Link Column
Build a deep link to Seller Central's order detail page. The URL format is:
```
https://sellercentral.amazon.com.au/orders-v3/order/{amazonOrderId}
```
The domain varies by region (AU = `.com.au`, US = `.com`, UK = `.co.uk`, etc.). Since we store the region in `amazon_tokens`, we can derive the correct Seller Central domain. Add an "Amazon" button with an external link icon that opens this in a new tab.

### 3. Improved Customer Display
When customer is "Placeholder", show a subtle prompt: "Screenshot needed" next to the Camera button, making the workflow obvious.

### 4. Regarding Automated Scraping
You're right that Amazon would penalise scraping Seller Central — it violates their ToS and could jeopardise your SP-API approval. The correct automated path is requesting the **Restricted Data Token (RDT)** role which gives PII (name, address) via API. Until then, the screenshot + AI extraction workflow is the safest manual approach. I'll add a note in the UI about this.

## Technical Details

**Seller Central domain map** (added to `amazon-regions.ts`):
| Region | Domain |
|--------|--------|
| AU | sellercentral.amazon.com.au |
| US | sellercentral.amazon.com |
| UK | sellercentral.amazon.co.uk |
| DE | sellercentral.amazon.de |
| JP | sellercentral.amazon.co.jp |
| SG | sellercentral.amazon.sg |
| etc. | ... |

**Data source**: All product data already exists in `raw_amazon_payload.orderItems` and `raw_amazon_payload.matched_skus`. No new API calls or DB changes needed.

**Region resolution**: Query the user's `amazon_tokens` row to get the marketplace ID, then map to Seller Central domain. Falls back to `.com.au` for the current single-merchant setup.

## Files Changed

| File | What |
|------|------|
| `src/constants/amazon-regions.ts` | Add `sellerCentralDomain` field to each region |
| `src/components/admin/FulfillmentBridge.tsx` | Add Product column, Amazon link button, improve Placeholder display |

