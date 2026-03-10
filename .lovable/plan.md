

# UX Hierarchy Redesign — Settlements Dashboard

Based on the UX audit, the core issue is flat visual hierarchy. Everything looks the same priority. This plan addresses the 10 feedback points while preserving existing functionality.

## What Changes

### 1. Financial Summary Strip (New Component)
Add a `SettlementsSummaryStrip` at the top of the Settlements → All view, above `MonthlyReconciliationStatus`. Fetches settlements for the current month and displays:

```text
┌──────────────────────────────────────────────────────────────┐
│  March 2026                                                  │
│                                                              │
│  Revenue        Fees          Net Payout      Settlements    │
│  $8,456.00      -$2,041.00    $6,415.00       ✓8  ⚠2  ✕1   │
└──────────────────────────────────────────────────────────────┘
```

- Uses `bg-gradient-to-r from-primary/5 to-primary/10` background
- Large numbers with `text-2xl font-bold`
- Coloured status chips: green matched, amber ready, red missing
- Pulls data from the same query `MonthlyReconciliationStatus` uses

**File:** `src/components/admin/accounting/SettlementsSummaryStrip.tsx`

### 2. Enhanced Primary Tab Bar (Dashboard.tsx)
- Add filled pill/background highlight on active tab instead of just border-bottom
- Active: `bg-primary text-primary-foreground rounded-lg` pill style
- Inactive: keep current ghost style
- Add workflow step numbers: `① Smart Upload  ② Settlements  ③ Insights`

### 3. Stronger Marketplace Tabs
In `MarketplaceSwitcher`, update the selected tab styling:
- Active: `bg-primary/10 border-primary text-primary font-semibold` with marketplace icon
- Inactive: keep current outline

**File:** `src/components/admin/accounting/MarketplaceSwitcher.tsx` (styling only)

### 4. Upload Drop Zone Enhancement (GenericMarketplaceDashboard)
Change the upload prompt card:
- Increase padding, add dashed border `border-dashed border-2`
- Larger text: "Drag settlement files here or click to upload"
- Subtle cloud upload icon, centered layout
- Already has dashed border — make it more prominent with larger container

### 5. Settlement Cards — Stronger Separation
In `GenericMarketplaceDashboard`, update settlement cards:
- Add `shadow-sm` and `border-border/80` for more depth
- Add subtle left-border colour coding: `border-l-4 border-l-amber-400` for ready, `border-l-emerald-500` for synced, `border-l-red-400` for failed

### 6. Button Hierarchy Fix
In `GenericMarketplaceDashboard`:
- "Push to Xero" → filled primary button (`variant="default"`)
- "Already in Xero" → ghost/outline button (`variant="ghost"`)
- Currently both appear as similar weight — differentiate clearly

### 7. Reconciliation Section Elevation
In `MonthlyReconciliationStatus`:
- Add coloured status chips instead of plain text counts
- Use `Badge` components with green/amber/red backgrounds
- Move the missing marketplace warning to use a more prominent alert card

### 8. Profit Summary Placeholder Enhancement
In `MarketplaceProfitCard`, when no data exists:
- Show a value-proposition card listing what profit insights unlock
- "You'll see: Net profit per marketplace, Margin %, Best and worst performers"
- Use a subtle gradient background to make it feel premium

### 9. Xero Connection Card
- Add green `bg-emerald-500` dot next to "Connected" text for faster recognition

### 10. Section Spacing & Headers
In `GenericMarketplaceDashboard`:
- Add `Separator` components between Upload / Settlements / Reconciliation / Profit sections
- Use slightly larger section headers with icons

## Files to Create
- `src/components/admin/accounting/SettlementsSummaryStrip.tsx`

## Files to Modify
- `src/pages/Dashboard.tsx` — tab styling + summary strip integration
- `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` — card styling, button hierarchy, section separation, upload zone, left-border status colours
- `src/components/admin/accounting/MonthlyReconciliationStatus.tsx` — coloured status chips
- `src/components/admin/accounting/MarketplaceSwitcher.tsx` — stronger active tab styling
- `src/components/shared/MarketplaceProfitCard.tsx` — enhanced empty state
- `src/components/admin/XeroConnectionStatus.tsx` — green connected indicator

## What Stays the Same
- All data fetching logic unchanged
- All edge functions unchanged
- No database changes
- No new dependencies
- Component composition architecture preserved

