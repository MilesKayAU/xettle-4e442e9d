

## Audit: Canonical Rule Compliance Across Loaders and Insights

### Verdict: 90% Compliant — 4 Gaps Found

The SmartUploadFlow correctly routes through `saveSettlement()` → `saveSettlementCanonical()` for all settlement inserts. Source priority, sanity validation, and push gating are enforced. The Insights charts correctly exclude `api_sync` rows when CSV data exists, and `isReconciliationOnly()` is applied at all push surfaces.

However, 4 gaps exist:

---

### Gap 1: InsightsDashboard `settlement_profit` query has no `user_id` filter

**File:** `src/components/admin/accounting/InsightsDashboard.tsx` (line 141-143)

```typescript
// CURRENT — relies solely on RLS
supabase.from('settlement_profit').select('marketplace_code, orders_count')
```

Compare with `MarketplaceProfitComparison.tsx` (line 110-112) which correctly adds `.eq('user_id', user.id)`. While RLS protects the data, the InsightsDashboard query is inconsistent and could silently return empty results if the RLS policy changes or auth state is stale.

**Fix:** Add `.eq('user_id', currentUser.id)` to `settlement_profit`, `marketplace_ad_spend`, `marketplace_shipping_costs`, `marketplace_shipping_stats`, and `order_shipping_estimates` queries. The `settlements` query also lacks it (line 126-132).

---

### Gap 2: InsightsDashboard doesn't filter `settlement_profit` by active settlement IDs

**File:** `src/components/admin/accounting/InsightsDashboard.tsx` (line 183-189)

The `profitOrderCounts` aggregation sums ALL `settlement_profit` rows for the user — including rows from `duplicate_suppressed` or `shopify_auto_*` settlements that the settlements query (line 130-131) excludes. This means order counts may be inflated, leading to over-estimated shipping deductions.

**Fix:** After loading both datasets, filter `profitOrderCounts` to only include `settlement_id`s that exist in the filtered settlements result set. Same pattern `MarketplaceProfitComparison` uses with `activeSettlementIds`.

---

### Gap 3: `MarketplaceProfitComparison` doesn't filter PAC/shipping queries for suppressed settlements

**File:** `src/components/insights/MarketplaceProfitComparison.tsx` (line 122-127)

The `settlement_lines` query fetches ALL lines for the user including those belonging to suppressed settlements. When counting distinct order IDs for shipping calculation, this inflates the count.

**Fix:** After building `activeSettlementIds`, filter `orderCountsRes` rows to only those whose `settlement_id` (via a join or post-filter) is in the active set.

---

### Gap 4: `settlement_lines` inserts in SmartUploadFlow are not part of canonical action

**File:** `src/components/admin/accounting/SmartUploadFlow.tsx` (lines 998-1152)

Settlement line inserts happen directly via `supabase.from('settlement_lines').insert()` in 6+ places across SmartUploadFlow, ShopifyOrdersDashboard, and AccountingDashboard. These bypass the canonical layer. While `settlement_lines` writes don't have the same invariants as `settlements` (no source priority, no sanity check), this fragmentation means:
- No consistent error handling
- No audit logging
- Settlement lines could be inserted without their parent settlement succeeding

**Fix (lower priority):** Extract a `saveSettlementLines()` function into `src/actions/settlements.ts` that validates the parent settlement exists before inserting lines. Migrate all 6 call sites.

---

### Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `src/components/admin/accounting/InsightsDashboard.tsx` | Add `user_id` filter to all queries; filter `profitOrderCounts` by active settlement IDs | High |
| `src/components/insights/MarketplaceProfitComparison.tsx` | Filter order count query by active settlement IDs | Medium |
| `src/actions/settlements.ts` | Add `saveSettlementLines()` canonical function | Low |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Migrate line inserts to canonical function | Low |

### No database changes needed

