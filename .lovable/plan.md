

## Fix: Hide Reconciliation-Only Settlements from File Reconciliation Table

### Problem
The `shopify_auto_bunnings_*` settlements are Shopify-derived summary aggregations that are correctly blocked from Xero push via `isReconciliationOnly()`. However:

1. **They still appear in the File Reconciliation card**, creating false "check required" warnings that confuse users
2. **The `isReconOnly` check in the table** (line 618) only checks `marketplace.startsWith('shopify_orders_')` — it misses the `settlementId.startsWith('shopify_auto_')` rule from `settlement-policy.ts`

### Changes

#### 1. Filter recon-only settlements out of FileReconciliationStatus (`GenericMarketplaceDashboard.tsx`)

Before passing `settlements` to `<FileReconciliationStatus>`, filter out any that match `isReconciliationOnly()`:

```typescript
import { isReconciliationOnly } from '@/utils/settlement-policy';

// In the FileReconciliationStatus section (~line 410):
const reconEligible = settlements.filter(s => 
  !isReconciliationOnly((s as any).source, s.marketplace, s.settlement_id)
);
// Pass reconEligible instead of settlements
```

#### 2. Fix incomplete `isReconOnly` check in table rows (line 618)

Replace the inline check with the canonical `isReconciliationOnly()` function so it catches both `shopify_orders_*` marketplaces AND `shopify_auto_*` settlement IDs:

```typescript
const isReconOnly = isReconciliationOnly((s as any).source, s.marketplace, s.settlement_id);
```

### Files Modified
1. **`src/components/admin/accounting/GenericMarketplaceDashboard.tsx`** — import `isReconciliationOnly`, filter FileReconciliation input, fix table row check

### Result
- `shopify_auto_bunnings_*` settlements disappear from File Reconciliation (no more false warnings)
- The table's "Recon Only" badge and push-blocking logic correctly catches all reconciliation-only patterns
- Real BUN- settlements remain visible and interactive for drill-down

