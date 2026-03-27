

# Settlements UX Overhaul — Clarity-First Redesign

## The Problem

Looking at the current Kogan settlements page (screenshot) and the codebase, a new user faces several issues:

1. **No marketplace-specific guidance** — The page says "upload settlement files" but never tells you *what files* each marketplace needs (e.g., Kogan needs CSV + PDF, Amazon needs a TSV, Woolworths needs a CSV per payment group)
2. **The settlement table is overwhelming** — A raw audit grid with columns like "Xero", "Bank", "Expected", "Actual", "Diff" is bookkeeper jargon thrown at users without context
3. **File Reconciliation section is cryptic** — Shows settlement IDs with numbers but no explanation of what reconciliation means or what action to take
4. **Transaction drilldown is a data dump** — Expanding a settlement shows 70+ raw line items with no grouping or summary
5. **Only eBay has an upload guide** — `EbayUploadGuide` exists but no equivalent for Kogan, Bunnings, Woolworths, Amazon, or Shopify

## Plan

### 1. Create a Marketplace Upload Requirements Card

A new component `MarketplaceUploadGuide` that renders per-marketplace, showing:

- **What files you need** — e.g., "Kogan: 1 CSV (payout report) + 1 PDF (remittance advice)", "Amazon: 1 TSV (settlement report)", "Bunnings: 1 PDF (billing cycle summary)"
- **Where to find them** — Step-by-step with portal links (like `EbayUploadGuide` does, but for every marketplace)
- **Collapsible by default** — Shows a one-line summary like "Kogan needs: CSV + PDF" with expand for full instructions

Data source: a static config object mapping marketplace codes to `{ files: [{type, label, required}], portalUrl, steps[] }`.

Replace the existing `EbayUploadGuide` with this unified component.

### 2. Add a "What You Need" Banner on Each Marketplace Tab

At the top of `GenericMarketplaceDashboard`, before the settlement table, show a compact requirements strip:

```text
┌──────────────────────────────────────────────────────┐
│ 📋 Kogan requires: CSV (payout report) + PDF        │
│    (remittance advice) per settlement period          │
│    [How to download ↗]  [Upload →]                   │
└──────────────────────────────────────────────────────┘
```

- Shown when `settlements.length < 3` or always collapsible
- Auto-dismissed once user has 3+ settlements (they know the drill)

### 3. Simplify the Settlement Table for Non-Power-Users

Replace the current dense 9-column grid with a **card-based layout** that shows:

- Settlement period and amount (prominent)
- Status as a clear badge with human-readable label ("Ready to push to Xero", "Needs review — $4.12 gap", "Synced to Xero")
- Actions as clear buttons ("Push to Xero", "View details", "Upload missing PDF")

The current audit grid (Expected/Actual/Diff columns) moves into the **detail drawer** — it's power-user data, not the default view. The main list becomes scannable cards.

### 4. Add Status Explainers

Each settlement status badge gets a tooltip or inline subtitle explaining what it means in plain language:

| Status | Current | Proposed |
|--------|---------|----------|
| `ingested` | Orange badge | "Uploaded — review before pushing" |
| `ready_to_push` | Green badge | "Reconciled — ready to push to Xero" |
| `pushed_to_xero` | Green check | "In Xero — awaiting bank match" |
| `gap_detected` | Red badge | "Numbers don't add up — check the gap" |

### 5. Simplify the File Reconciliation Section

Current: Shows `kogan_362490 Sales: $866.81 Fees: -$13.00 Net: $869.15 ` — meaningless to most users.

Proposed: Replace with a status-first summary:

```text
┌─────────────────────────────────────────────────┐
│ ✅ 3 settlements reconciled                      │
│ ⚠️ 1 settlement has a $4.12 gap — click to fix  │
│ 📎 1 settlement missing PDF — upload to complete │
└─────────────────────────────────────────────────┘
```

The raw financial breakdown moves into the expandable detail.

### 6. Collapse Transaction Drilldown by Default + Add Summary Row

When expanding a settlement's line items, show a **grouped summary first**:

```text
Orders: 47 items — $862.25
Fees: 3 types — -$13.00  
Refunds: 2 items — -$18.50
──────────────────────────
Net: $830.75
```

The full 70-row transaction list becomes a "Show all transactions" toggle below the summary.

## Technical Approach

### Files to create:
- `src/components/admin/accounting/shared/MarketplaceUploadGuide.tsx` — unified upload guide with per-marketplace config
- `src/components/admin/accounting/shared/SettlementCard.tsx` — simplified card view for settlement rows

### Files to modify:
- `GenericMarketplaceDashboard.tsx` — integrate upload guide, swap table for cards, add requirements banner
- `FileReconciliationStatus.tsx` — simplify to status-first summary
- `SettlementStatusBadge.tsx` — add plain-language tooltips
- Delete `EbayUploadGuide.tsx` (absorbed into unified guide)

### Marketplace file requirements config (static data):
```typescript
const MARKETPLACE_FILE_REQUIREMENTS = {
  kogan: { files: ['CSV (payout report)', 'PDF (remittance advice)'], note: 'Both required per settlement' },
  amazon_au: { files: ['TSV (settlement report)'], note: 'Downloaded from Seller Central → Reports → Payments' },
  bunnings: { files: ['PDF (billing cycle summary)'], note: 'Downloaded from Mirakl portal' },
  ebay_au: { files: ['CSV (transaction report)'], note: 'From Seller Hub → Payments → Reports' },
  shopify_payments: { files: ['CSV (payout export)'], note: 'From Shopify Admin → Finances → Payouts' },
  woolworths_marketplus: { files: ['CSV (MarketPlus report)'], note: 'From Woolworths seller portal' },
  // ...
};
```

## Priority Order

1. MarketplaceUploadGuide (biggest gap — users literally don't know what to upload)
2. Requirements banner on each tab
3. Simplified settlement cards
4. Status explainers
5. Reconciliation summary simplification
6. Transaction drilldown grouping

