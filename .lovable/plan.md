

# Reconciliation Gap Triage Table — Homepage Dashboard

## What This Adds

A dedicated "Gaps to Resolve" section on the homepage between the ActionCentre and RecentSettlements, giving bookkeepers a focused worklist of settlements with reconciliation gaps. Each row shows the gap amount, likely cause, and provides inline tools to fix, edit, and save — plus an AI diagnosis button that analyzes whether the gap is real or a data artifact.

## Current State

- **ActionCentre** computes `gapDetected` rows (line 274) but never renders them — they're a dead variable
- **SettlementDetailDrawer** has `diagnoseGapReason()` (rule-based) and Edit Figures mode, but these require clicking into each settlement individually
- **AI tool registry** has no gap-specific tool — the assistant can't analyze individual gap causes
- The homepage has no dedicated gap resolution UX; bookkeepers must navigate to the Settlements tab to find and fix gaps

## Plan

### 1. Create GapTriageTable component

New file: `src/components/dashboard/GapTriageTable.tsx`

- Query `marketplace_validation` where `overall_status = 'gap_detected'`, joined to `settlements` for financial fields
- Display as a compact table with columns: Marketplace, Period, Gap Amount, Likely Cause, Actions
- Use `getDisplayGap()` for gap amounts (validation-first, settlement fallback)
- Extract `diagnoseGapReason()` from SettlementDetailDrawer into a shared utility (`src/utils/diagnose-gap-reason.ts`) so both the drawer and this table can use it
- Each row gets:
  - Gap amount with color coding (amber for warn, red for blocking)
  - Rule-based diagnosis text (from `diagnoseGapReason`)
  - "Edit" button → opens SettlementDetailDrawer in edit mode
  - "AI Scan" button → calls new AI tool to analyze the gap
- Collapsible if > 5 rows, sorted by absolute gap descending
- Shows "No gaps — all clear" if empty (collapsed/hidden state)

### 2. Extract diagnoseGapReason to shared utility

New file: `src/utils/diagnose-gap-reason.ts`

- Move the `diagnoseGapReason()` function from SettlementDetailDrawer (lines 90-141) to this shared file
- Update SettlementDetailDrawer to import from the new location
- GapTriageTable imports from the same location

### 3. Add AI gap analysis tool

Update `supabase/functions/_shared/ai_tool_registry.ts`:
- Add `analyzeReconciliationGap` tool that takes a `settlement_id` and returns:
  - The financial breakdown (sales, fees, refunds, bank deposit, expected net)
  - The gap amount and direction
  - The rule-based diagnosis
  - Whether the gap is likely real (data missing) or an artifact (rounding, API bug)
- Available on routes: `dashboard`, `settlements`

Update `supabase/functions/ai-assistant/index.ts`:
- Implement the tool execution: query settlements + marketplace_validation for the given settlement_id, run diagnosis logic server-side, return structured analysis

### 4. Wire into Dashboard.tsx

- Import GapTriageTable
- Place it between the ActionCentre section and the RecentSettlements section (between lines 1112 and 1114)
- Pass `onOpenDrawer` callback to open SettlementDetailDrawer when "Edit" is clicked

### 5. AI Scan UX in GapTriageTable

- "AI Scan" button per row sends a message to the AI assistant via `useAiAssistant` hook
- The message is pre-formatted: "Analyze the reconciliation gap for settlement [ID]. Is this gap real or a data artifact? What's the likely fix?"
- Response appears inline below the row in a collapsible panel
- Alternatively, a "Scan All Gaps" button at the table header sends a batch analysis request

## Technical Details

- All gap data reads from `marketplace_validation` (source of truth) via `getDisplayGap()`
- No new database tables or migrations required
- The AI tool is read-only per existing policy
- Edit/save flow reuses existing SettlementDetailDrawer infrastructure
- After saving edits, the validation sweep auto-runs and the table refreshes via realtime subscription on `marketplace_validation`

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/utils/diagnose-gap-reason.ts` | Create — extract shared diagnosis logic |
| `src/components/dashboard/GapTriageTable.tsx` | Create — main triage table component |
| `src/components/shared/SettlementDetailDrawer.tsx` | Modify — import from shared utility |
| `supabase/functions/_shared/ai_tool_registry.ts` | Modify — add analyzeReconciliationGap tool |
| `supabase/functions/ai-assistant/index.ts` | Modify — implement tool execution |
| `src/pages/Dashboard.tsx` | Modify — add GapTriageTable to home view |

