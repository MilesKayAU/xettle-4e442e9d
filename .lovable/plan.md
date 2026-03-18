

## Fix: Consolidate `ebay` → `ebay_au` across the system

### Root cause

Three code locations use the non-canonical code `ebay` instead of `ebay_au`:
- `src/utils/shopify-order-detector.ts` line 28: `'ebay': { code: 'ebay', name: 'eBay' }`
- `supabase/functions/auto-generate-shopify-settlements/index.ts` line 27: same
- `src/constants/settlement-rails.ts` line 15: `{ code: 'ebay', ... }`

Meanwhile the canonical system (marketplace-contacts, eBay API auth, MARKETPLACE_CONTACTS) uses `ebay_au`.

This created two `marketplace_connections` rows and two `fulfilment_method:*` settings for what is the same channel.

### Fix plan

#### 1. Update code references (3 files)

| File | Change |
|------|--------|
| `src/utils/shopify-order-detector.ts` | `'ebay': { code: 'ebay_au', name: 'eBay Australia' }` |
| `supabase/functions/auto-generate-shopify-settlements/index.ts` | `'ebay': { code: 'ebay_au', name: 'eBay Australia' }` |
| `src/constants/settlement-rails.ts` | `{ code: 'ebay_au', label: 'eBay AU Payouts', ... }` |

#### 2. Clean up existing data (one-time)

Delete the orphan `ebay` marketplace connection and its fulfilment setting so only `ebay_au` remains:

```sql
DELETE FROM marketplace_connections WHERE marketplace_code = 'ebay';
DELETE FROM app_settings WHERE key = 'fulfilment_method:ebay';
```

Also consolidate any settlements or validation rows that used `marketplace = 'ebay'`:

```sql
UPDATE settlements SET marketplace = 'ebay_au' WHERE marketplace = 'ebay';
UPDATE marketplace_validation SET marketplace_code = 'ebay_au' WHERE marketplace_code = 'ebay';
```

#### 3. Optional — add normalization guard

Add `'ebay'` → `'ebay_au'` to `normalizeMarketplaceCode()` in `src/utils/marketplace-codes.ts` so any future stray `ebay` code gets corrected at write time.

### Impact

- No new tables or migrations
- Prevents duplicate eBay entries in Settings, Insights, and Fulfilment Methods
- Existing eBay API connection (`ebay_au`) is unaffected

