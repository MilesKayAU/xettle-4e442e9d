

## Source Priority Guard — Canonical Architecture

### Current State

The audit matrix (Section B) explicitly marks settlement ingestion as **not yet canonicalized**:

| Entry Point | Canonical Path |
|---|---|
| SmartUploadFlow | ❌ → future `saveIngestedSettlement()` |
| AccountingDashboard | ❌ → future `saveIngestedSettlement()` |
| ShopifyOrdersDashboard | ❌ → future `saveIngestedSettlement()` |
| settlement-engine (2 paths) | ❌ → consolidate |

There are currently **4 client-side settlement insert paths** (plus 4 server-side edge functions). The source priority logic must be enforced at the canonical layer, not in individual UI flows.

### Plan

**1. Add canonical settlement creation action** — `src/actions/settlements.ts`

Add two new exported functions:

- `saveSettlementCanonical(settlement, options)` — the single client-side insert path
  - Calls `applySourcePriority()` after insert
  - Logs `system_event` for any suppression
  - Returns the new settlement ID + any suppressed records

- `applySourcePriority(userId, marketplace, periodStart, periodEnd, newSettlementId, newSource)` — the invariant rule:
  - If `newSource === 'manual'` (CSV upload): query for overlapping `api_sync` settlements on same marketplace + overlapping period. For each match, update `status = 'duplicate_suppressed'`, `duplicate_of_settlement_id = newSettlementId`, `duplicate_reason = 'CSV upload takes priority over Shopify-derived data'`. Log `system_event: settlement_suppressed_by_source_priority`.
  - If `newSource === 'api_sync'`: query for existing `manual` settlements on same marketplace + overlapping period. If found, self-suppress the new record immediately.

- `getSourcePreference(userId, marketplaceCode)` — reads `app_settings` key `source_preference:{code}`, returns `'csv' | 'api' | null`.

**2. Migrate existing insert paths** to use `saveSettlementCanonical()`

Replace direct `from('settlements').insert()` in:
- `src/utils/settlement-engine.ts` (2 code paths, lines ~832 and ~898)
- `src/components/admin/accounting/AccountingDashboard.tsx` (line ~143)

The `promote_and_save_settlement` RPC path in `settlement-engine.ts` (line ~587) stays as-is since it's an atomic DB function — but add a post-RPC call to `applySourcePriority()` after it returns.

**3. Update edge function: `auto-generate-shopify-settlements`**

Add source preference check before generating records:
- Read `app_settings` for `source_preference:{marketplace_code}`
- If preference is `'csv'`, skip settlement record creation for that sub-channel
- After inserting any `api_sync` record, check for existing `manual` records on overlapping period and self-suppress if found

**4. Add guardrail test** — `src/actions/__tests__/canonical-actions.test.ts`

New test:
```
it('no direct settlements.insert() outside canonical actions', () => {
  const violations = scanForPattern(/from\('settlements'\)\.insert\(/);
  expect(violations).toEqual([]);
});
```

This will initially fail against the 3 existing non-canonical insert sites, which get fixed in step 2.

**5. Source badges** (UI only, read-only) — `ReconciliationHub.tsx`, `GenericMarketplaceDashboard.tsx`

Display badge on settlement cards:
- `source === 'api_sync'` → "Shopify Orders" (amber)
- `source === 'manual'` → "CSV Upload" (blue)
- Default → "API" (green)

Safe: read-only, no writes.

**6. Upload warning** (UI only, read-only query) — `SmartUploadFlow.tsx`

Before save, query for existing `api_sync` settlements matching marketplace + period. If found, show info banner: "A Shopify-derived settlement exists for this period. Your CSV upload will take priority." No writes here — the actual suppression happens inside `saveSettlementCanonical()`.

**7. Source preference setting** — `src/components/settings/ApiConnectionsPanel.tsx`

Add "Marketplace Data Sources" card listing detected sub-channels with toggle: "CSV uploads (recommended)" vs "Shopify Orders API". Stored in `app_settings` as `source_preference:{marketplace_code}` = `'csv' | 'api'`. Enforcement happens in canonical action + edge function, not here.

**8. Update audit matrix** — `docs/action-audit-matrix.md`

Section B updated:
- All client-side insert paths → ✅ `saveSettlementCanonical()`
- New row for `applySourcePriority` canonical action
- Guardrail test row added

### Files Changed

| File | Change Type |
|---|---|
| `src/actions/settlements.ts` | Add `saveSettlementCanonical()`, `applySourcePriority()`, `getSourcePreference()` |
| `src/actions/index.ts` | Export new functions |
| `src/utils/settlement-engine.ts` | Replace 2 direct inserts with canonical call + post-RPC priority check |
| `src/components/admin/accounting/AccountingDashboard.tsx` | Replace direct insert with canonical call |
| `src/actions/__tests__/canonical-actions.test.ts` | Add insert guardrail test |
| `src/components/admin/accounting/ReconciliationHub.tsx` | Source badge (read-only) |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Source badge (read-only) |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Pre-save overlap warning (read-only query) |
| `src/components/settings/ApiConnectionsPanel.tsx` | Source preference UI |
| `supabase/functions/auto-generate-shopify-settlements/index.ts` | Preference check + self-suppress logic |
| `docs/action-audit-matrix.md` | Update Section B |

No database migrations needed.

