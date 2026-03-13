

## Dashboard UX Overhaul — Reduce Alarm, Match Accounting Workflow

### Problem
The ActionCentre dashboard uses alarming language and icons for normal states, shows too many card types (6-7), includes unnecessary cards ("Already in Xero"), and lacks a clear visual pipeline. Users see errors where none exist.

### Plan

#### 1. Simplify status cards to 4 workflow stages
Replace the current 6 cards (Upload Needed, Ready for Xero, Awaiting Bank Match, Unmatched Deposits, Complete, Already in Xero) with 4 clean cards matching the accounting pipeline:

| Card | Shows | When visible |
|------|-------|-------------|
| **Needs Upload** | Missing settlements | Only when month is closed AND settlements missing |
| **Ready to Post** | Validated, not yet in Xero | When readyToPush > 0 |
| **Posted — Waiting for Bank** | In Xero, deposit not yet detected | When awaitingBank > 0 |
| **Fully Reconciled** | Everything matched | When complete > 0 |

Remove the "Already in Xero" card entirely (pre-boundary info stays in timeline). Remove "Unmatched Deposits" as a standalone card (fold into reconciliation hub).

**File**: `src/components/dashboard/ActionCentre.tsx`

#### 2. Fix alarming language throughout

| Current | New |
|---------|-----|
| "Upload Needed" with red icon | "Needs Upload" with neutral amber dot |
| "Awaiting bank match" | "Posted — Waiting for Bank" |
| "No bank deposit found" | "Bank feed not synced yet" |
| "Complete this month" | "Fully Reconciled" |
| Red 🔴 icon on Upload Needed | Amber 🟡 icon |

#### 3. "Needs Upload" only shows for closed months
Add a check: only show the upload-needed card if the period's month-end is in the past. Current month settlements are expected to arrive later.

```typescript
const now = new Date();
const uploadNeededClosed = uploadNeededManual.filter(r => {
  const periodEnd = new Date(r.period_end);
  return periodEnd < now; // only show if period already ended
});
```

#### 4. Add timeline legend
The legend already exists (line 656-663) but improve it with clearer labels:

| Icon | Label |
|------|-------|
| ✅ | Reconciled |
| ● | Posted to Xero |
| 🟡 | Ready to post |
| ⚠️ | Gap detected |
| ❌ | Missing upload |

#### 5. Replace top connection banner with sync timestamps
Change `DashboardConnectionStrip` to show simple last-sync times instead of "Checking for new marketplaces..." dev text. The component already does this well — the issue is other banners (PostSetupBanner, ChannelAlertsBanner) that show scanning messages. Suppress those when scans are complete.

**File**: `src/components/dashboard/PostSetupBanner.tsx` — hide when scan is done.

#### 6. Add visual pipeline row per marketplace in timeline
Enhance the 3-month timeline grid to show pipeline stage icons instead of single status emoji. Each cell shows a mini pipeline:

```text
Amazon AU  | Jan: ✅✅✅✅ | Feb: ✅✅✅❌ | Mar: ✅✅❌❌
             S  X  B  R      S  X  B  R      S  X  B  R
```

Where S=Settlement, X=Xero, B=Bank, R=Reconciled. This is the "biggest UI improvement" the user requested. Implement as 4 small dots/icons per cell with tooltip breakdown.

**File**: `src/components/dashboard/ActionCentre.tsx` — modify timeline cell rendering.

### Files to modify
- `src/components/dashboard/ActionCentre.tsx` — main changes (cards, language, upload filter, pipeline cells)
- `src/components/dashboard/PostSetupBanner.tsx` — suppress when scans complete

### What stays unchanged
- Settlement list table, status column, period/marketplace grouping, Push to Xero button, awaiting payment badge
- ReconciliationHub, SettlementsOverview, SettlementsSummaryStrip (separate views)
- All backend logic

