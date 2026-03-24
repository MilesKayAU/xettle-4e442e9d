

## Plan: Inventory Rules Panel with Smart SKU Matching (Phase 1.1)

### What We're Building

1. **`src/hooks/useInventoryRules.ts`** — Hook to load/save inventory rules from `app_settings` (key: `inventory_rules`). Returns current rules and a setter. Default rules: `{ physical_sources: ['shopify', 'amazon_fba'], fbm_from_shopify: true, mirror_platforms: { kogan: 'shopify', ebay: 'shopify', mirakl: 'shopify' } }`.

2. **`src/components/inventory/InventoryRulesPanel.tsx`** — Collapsible settings panel with:
   - **Physical Stock Sources**: checkboxes for Shopify, Amazon FBA, Amazon FBM, Kogan, eBay, Mirakl
   - **FBM Toggle**: "Amazon FBM stock comes from Shopify warehouse" (default checked)
   - **Mirror Platforms**: read-only static text (Kogan → Shopify, eBay → Shopify, Mirakl → Shopify) with "Customizable in a future update" note
   - **Live preview**: checkbox changes update a local state immediately; the Universal tab recalculates in real-time without requiring save. Save button persists to `app_settings`.

3. **`src/components/inventory/UniversalInventoryTab.tsx`** — Updated to:
   - Accept `inventoryRules` as a prop
   - Use rules to calculate `total_real_stock` from only `physical_sources`
   - Respect `fbm_from_shopify` toggle
   - **Smart SKU matching** with normalisation on BOTH sides:
     ```typescript
     const normalise = (sku: string) => sku.toLowerCase().replace(/[-\s_]/g, '');
     ```
     Match priority: (1) exact SKU, (2) normalised SKU match, (3) exact title match **only if title.length > 20**, (4) treat as separate row
   - Mirror platforms shown greyed out in table when excluded from totals

4. **`src/components/inventory/InventoryDashboard.tsx`** — Load rules via `useInventoryRules`, pass to `UniversalInventoryTab`, render gear button to toggle `InventoryRulesPanel`. Panel state changes flow to Universal tab immediately.

### SKU Matching Detail

The `getOrCreate` function will be refactored to a two-pass approach:
- First pass: build a lookup by normalised SKU and by title (only titles > 20 chars)
- When inserting a new platform's item: check normalised SKU first, then title fallback, then create new entry
- Both sides normalised — Shopify `COF-60` matches Amazon `cof60`

### Files

| File | Action |
|------|--------|
| `src/hooks/useInventoryRules.ts` | **New** |
| `src/components/inventory/InventoryRulesPanel.tsx` | **New** |
| `src/components/inventory/UniversalInventoryTab.tsx` | Modified — rules-aware calculation + smart SKU matching |
| `src/components/inventory/InventoryDashboard.tsx` | Modified — wire up rules hook + panel |

### No database changes needed
Uses existing `app_settings` table with key `inventory_rules`.

### Constraints
- No settlement/validation/Xero imports
- Mirror platforms read-only in Phase 1
- No manual SKU mapping UI (Phase 2)

