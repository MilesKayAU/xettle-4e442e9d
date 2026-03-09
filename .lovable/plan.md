

# Plan: Multi-Marketplace Deduplication & Schema Hardening

## Current State

The `settlements` table has:
- `marketplace` column (text, defaults to `'AU'`) — currently stores country code, not marketplace code
- `settlement_id` column (text) — Amazon's settlement ID
- `source` column (text, defaults to `'manual'`) — tracks origin

**Problem:** No unique constraint prevents the same settlement from being imported twice for different marketplaces, and `marketplace` stores country codes (`'AU'`) instead of marketplace codes (`'amazon_au'`).

## Changes Required

### 1. Database Migration

```sql
-- Update existing records from country code to marketplace code
UPDATE settlements SET marketplace = 'amazon_au' WHERE marketplace = 'AU' OR marketplace IS NULL;

-- Add unique constraint to prevent duplicates
ALTER TABLE settlements ADD CONSTRAINT settlements_marketplace_settlement_unique 
  UNIQUE (marketplace, settlement_id, user_id);

-- Update source values for consistency
UPDATE settlements SET source = 'csv_upload' WHERE source = 'manual';
```

### 2. Update Edge Function: fetch-amazon-settlements

**Line ~458:** Change `marketplace: 'AU'` → `marketplace: 'amazon_au'`

**Line ~406-449:** Update dedup query to include marketplace:
```typescript
const { data: existingData } = await supabaseAdmin
  .from('settlements')
  .select('settlement_id, period_start, period_end, bank_deposit')
  .eq('user_id', userId)
  .eq('marketplace', 'amazon_au');  // Add marketplace filter
```

### 3. Update AccountingDashboard.tsx

**Line ~477:** Change `marketplace: selectedCountry` → `marketplace: 'amazon_au'` (or derive from marketplace context)

**Line ~449:** Update `removeExistingSettlementForUser` to pass marketplace code

### 4. Update fee-observation-engine.ts

**Line ~76:** Already converts `'AU'` → `'amazon_au'` — this pattern is correct, no change needed

### 5. Add Shopify Payments to Marketplace Catalog

Add to `MARKETPLACE_CATALOG` in `MarketplaceSwitcher.tsx`:
```typescript
{
  code: 'shopify_payments',
  name: 'Shopify Payments',
  icon: '💳',
  country: 'AU',
  countryFlag: '🇦🇺',
  connectionMethods: ['manual_csv'],
  phase: 'coming_soon',
  description: 'Shopify Payments payouts — your direct store sales.',
}
```

## Source Field Standardization

| Value | Meaning |
|-------|---------|
| `api` | Fetched via SP-API or other marketplace API |
| `csv_upload` | Manual file upload |
| `manual` | Hand-entered (future) |

## Technical Details

The unique constraint `(marketplace, settlement_id, user_id)` ensures:
- Same settlement can exist for different users ✓
- Same settlement ID from different marketplaces won't collide ✓
- No duplicate imports within the same marketplace ✓

The Xero sync already checks `xero_journal_id IS NULL` before pushing — no changes needed there.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/` | New migration: update marketplace values + add unique constraint |
| `supabase/functions/fetch-amazon-settlements/index.ts` | Line 458: use `'amazon_au'`; add marketplace to dedup query |
| `src/components/admin/accounting/AccountingDashboard.tsx` | Lines 477, 507: use marketplace code instead of country |
| `src/components/admin/accounting/MarketplaceSwitcher.tsx` | Add `shopify_payments` to catalog |

