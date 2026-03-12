# Xettle Architecture Rules

## Rule 1: All Marketplace Dashboards Must Use Shared Hooks

Every marketplace dashboard (Amazon, Shopify Payments, Bunnings, Generic, ShopifyOrders, etc.)
**MUST** compose from the shared hooks and components below.

This prevents feature drift where one dashboard gets a capability (e.g. inline recon, Xero-aware
bulk delete) but others don't.

### Mandatory Shared Hooks

| Hook | Location | What it provides |
|------|----------|-----------------|
| `useSettlementManager` | `src/hooks/use-settlement-manager.ts` | Load, delete, realtime subscription |
| `useBulkSelect` | `src/hooks/use-bulk-select.ts` | Checkbox selection, Xero-aware bulk delete |
| `useXeroSync` | `src/hooks/use-xero-sync.ts` | Push, rollback, refresh, mark-as-synced |
| `useReconciliation` | `src/hooks/use-reconciliation.ts` | Inline recon checks per settlement |
| `useTransactionDrilldown` | `src/hooks/use-transaction-drilldown.ts` | Line item expansion + loading |

### Mandatory Shared Components

| Component | Location | What it provides |
|-----------|----------|-----------------|
| `SettlementStatusBadge` | `src/components/admin/accounting/shared/SettlementStatusBadge.tsx` | Consistent status badges |
| `ReconChecksInline` | `src/components/admin/accounting/shared/ReconChecksInline.tsx` | Reconciliation check display |
| `BulkDeleteDialog` | `src/components/admin/accounting/shared/BulkDeleteDialog.tsx` | Xero-aware delete confirmation |
| `GapDetector` | `src/components/admin/accounting/shared/GapDetector.tsx` | Period gap warnings |

### Mandatory Feature Checklist

Every marketplace dashboard **MUST** implement all of:

- [ ] **Dedup on save** — `saveSettlement()` checks `settlement_id + marketplace + user_id` uniqueness
- [ ] **Transaction drill-down** — Eye button queries `settlement_lines`, fallback shows summary
- [ ] **Inline reconciliation** — `runUniversalReconciliation()` results shown per settlement card
- [ ] **Xero push with recon gate** — Block push if `canSync === false`
- [ ] **Rollback** — Void Xero invoice and reset status
- [ ] **Refresh from Xero** — `syncXeroStatus()` wired to UI button
- [ ] **Bulk select + delete** — With Xero-aware confirmation dialog
- [ ] **Gap detection** — Warn on missing periods between settlements
- [ ] **Mark as Already in Xero** — Skip button for pre-existing invoices

### Pattern: Composing a New Dashboard

```tsx
import { useSettlementManager } from '@/hooks/use-settlement-manager';
import { useBulkSelect } from '@/hooks/use-bulk-select';
import { useXeroSync } from '@/hooks/use-xero-sync';
import { useReconciliation } from '@/hooks/use-reconciliation';
import { useTransactionDrilldown } from '@/hooks/use-transaction-drilldown';
import SettlementStatusBadge from './shared/SettlementStatusBadge';
import ReconChecksInline from './shared/ReconChecksInline';
import BulkDeleteDialog from './shared/BulkDeleteDialog';
import GapDetector from './shared/GapDetector';

function NewMarketplaceDashboard({ marketplace }) {
  const { settlements, loading, loadSettlements, handleDelete, deleting } =
    useSettlementManager({ marketplaceCode: marketplace.marketplace_code });

  const { pushing, rollingBack, refreshingXero, toStandardSettlement, handlePushToXero, handleRollback, handleRefreshXero, handleMarkAlreadySynced, handleBulkMarkSynced } =
    useXeroSync({ loadSettlements });

  const { selected, toggleSelect, toggleSelectAll, bulkDeleting, bulkDeleteDialogOpen, syncedSelectedCount, handleBulkDelete, confirmBulkDelete, cancelBulkDelete } =
    useBulkSelect({ settlements, onComplete: loadSettlements });

  const { reconResults, expandedRecon, toggleReconCheck } =
    useReconciliation({ toStandardSettlement });

  const { expandedLines, lineItems, loadingLines, loadLineItems } =
    useTransactionDrilldown();

  // All features are now inherited. Just render the UI.
}
```

### Why Composition Over Inheritance

React doesn't support class-based component inheritance. The equivalent is:
- **Hooks** for shared stateful logic
- **Components** for shared UI patterns
- **Architecture rules** (this document) for governance

This ensures every dashboard automatically gets new features when hooks are updated,
and prevents the "placeholder dashboard" problem where a new marketplace launches
without critical data integrity protections.

## Rule 2: No Direct Color Classes in Components

Always use semantic design tokens from `index.css` and `tailwind.config.ts`.
Never use raw colors like `text-white`, `bg-black`, etc.

## Rule 3: Secrets Never in Code

Never store private API keys in source code. Use Lovable Cloud secrets.
Publishable/anon keys are OK.

## Rule 11: Three-Layer Accounting Source Model (Hardcoded, Never Configurable)

Orders     → NEVER create accounting entries
Payments   → NEVER create accounting entries
Settlements → ONLY source of accounting entries

Payment matching is VERIFICATION ONLY — no invoice, no journal, no Xero push.
This rule is enforced by `src/constants/accounting-rules.ts` and referenced
at the entry point of every payment and sync function.

Canonical constant file: `src/constants/accounting-rules.ts`

### Payment Verification Layer

The payment verification system (PayPal, Shopify Payments, other gateways)
follows the same hybrid matching model as Amazon bank deposit matching:

- Detects gateway bank accounts in Xero (Type=BANK)
- Fetches transactions from those accounts
- Groups and scores candidates against Shopify orders
- Presents suggestions requiring explicit user confirmation
- Stores audit trail in `payment_verifications` table (never in `settlements`)
- **NEVER** creates invoices, journals, or Xero pushes
