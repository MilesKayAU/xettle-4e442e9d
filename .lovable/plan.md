

## Root Cause: `partially_refunded` Orders Excluded

### Discovery

Scanning the raw CSV reveals the bug. The parser at line 334 filters `financialStatus !== 'paid'`, which excludes:

- **`partially_refunded`** orders (e.g., Bunnings order #8684 = $22.85)
- **`refunded`** orders (e.g., Kogan order #8862 = $24.85)

LinkMyBooks includes these at their **original amount** and handles refunds as separate accounting entries. Xettle is silently dropping them — this accounts for the Bunnings gap and the Kogan variance.

Additionally, the Kogan registry pattern `'Channel_id:'` (bare prefix) is overly broad — it matches ANY order with `Channel_id:` in Note Attributes, including Bunnings orders. It doesn't cause issues currently because bunnings is checked first in iteration order, but it's a latent bug if registry order ever changes.

### Changes

**1. Include `partially_refunded` orders (`shopify-orders-parser.ts`)**

Change the financial status filter from `!== 'paid'` to accept both `paid` and `partially_refunded`. These orders should be included at their **original Total** (the partial refund is handled as a separate accounting entry).

Keep excluding `refunded` orders — those are fully cancelled and LMB also excludes them (the refund reversal is a separate entry).

**2. Add Financial Status diagnostics (`shopify-orders-parser.ts` + `ShopifyOrdersDashboard.tsx`)**

Track how many orders per Financial Status were found per marketplace group. Display in the UI so the user can see exactly how many `partially_refunded` orders were included and their total value. Format: `"63 paid + 2 partially refunded = 65 orders"`.

**3. Remove overly broad Kogan pattern (`marketplace-registry.ts`)**

Remove `'Channel_id:'` from Kogan's `note_attributes_patterns` — it's too greedy and could match Bunnings/BigW/any Mirakl marketplace. The remaining Kogan patterns (`'Order placed from: Kogan'`, `'KoganOrderID'`, `'Tenant_id: Kogan'`, `'kogan'`) plus tags (`'Kogan'`, `'cedcommerce'`) are sufficient.

**4. Financial Status summary on results page (`ShopifyOrdersDashboard.tsx`)**

Add a small breakdown above the marketplace cards showing: `"256 paid, 3 partially refunded (included), 2 refunded (excluded), 15 unpaid (excluded)"` — full transparency on what was processed.

### Files Changed

1. `src/utils/shopify-orders-parser.ts` — Accept `partially_refunded`, track status breakdown
2. `src/utils/marketplace-registry.ts` — Remove `'Channel_id:'` from Kogan
3. `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` — Show status diagnostics

### Expected Impact

After these changes, re-uploading the same Feb CSV should:
- Include ~6-8 additional Bunnings orders (the `partially_refunded` ones) closing the $198 gap
- Slightly reduce the Kogan total (removing any false positives from the broad `Channel_id:` pattern)
- Show full Financial Status transparency in the UI

