

## Plan: Clickable Summary Filters + Linked Product Detection with Similarity Guard

### Feature 1 — Clickable Summary Card Filters

**File: `src/components/inventory/UniversalInventoryTab.tsx`**

- Add `activeFilter` state: `null | 'out_of_stock' | 'variance'`
- Make "Out of Stock" and "Price Variance Alerts" cards clickable — pass `onClick` and `active` props to `SummaryCard`
- Active card gets `ring-2 ring-primary cursor-pointer` styling
- Filter `unified` array before passing to `InventoryTable`:
  - `out_of_stock` → `total_real_stock === 0`
  - `variance` → `has_variance === true`
- Clicking active card clears filter
- "Total Real Stock" and "Total SKUs" cards remain non-clickable (informational only)

### Feature 2 — Linked Product Detection + Combine Prompt

**Extend `UnifiedSku` interface** with:
- `match_sources: string[]` — platforms that contributed (e.g. `['shopify', 'amazon_fba']`)
- `match_method: 'exact' | 'normalised' | 'title' | 'manual' | null`

**Track match metadata in `resolve()`**: When a match is found via normalised SKU or title fallback, record the method and append the platform source.

**Manual confirmed links**: Read `sku_links` from `inventoryRules` (stored in `app_settings`). Pre-seed the `normSkuIndex` with confirmed links before processing platform data. Use upsert logic when saving (deduplicate by canonical SKU).

**"Possible link?" prompt with similarity guard**:
- Simple Levenshtein-based similarity check between normalised SKUs
- Only surface prompt when similarity >= 70%
- Cap at 3-5 visible suggestions at a time (first 5 highest-similarity candidates)
- Short SKUs (< 3 chars normalised) never trigger suggestions
- False negatives preferred over false positives

**Similarity function** (inline, no dependency):
```typescript
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  // Simple character overlap ratio
  let matches = 0;
  const used = new Set<number>();
  for (const c of shorter) {
    const idx = [...longer].findIndex((ch, i) => ch === c && !used.has(i));
    if (idx >= 0) { matches++; used.add(idx); }
  }
  return matches / longer.length;
}
```

**New column in table**: After SKU column, a narrow "Link" column showing:
- Multi-source rows: colored `Badge` chips (e.g. "S + A" for Shopify + Amazon) with tooltip showing match method
- Possible link candidates: muted "Link?" button that opens a small confirm dialog
- Confirmed manual links: solid badge with "Manual" indicator

**Confirm action**: When user clicks "Link?" and confirms, add the link to `rules.sku_links` and call `saveRules` with upsert — if the canonical SKU already has a links entry, merge the new SKU into it rather than creating a duplicate.

### File: `src/hooks/useInventoryRules.ts`

- Add `sku_links: Array<{ canonical: string; linked: string[] }>` to `InventoryRules` interface, defaulting to `[]`
- Ensure `saveRules` uses upsert (`onConflict: 'user_id,key'`) — already does

### Files Modified

| File | Changes |
|------|---------|
| `src/components/inventory/UniversalInventoryTab.tsx` | Clickable filters, match tracking, link badges, similarity guard, possible-link prompts (max 5), confirm-link handler |
| `src/hooks/useInventoryRules.ts` | Add `sku_links` to interface + default |

### No database changes needed

