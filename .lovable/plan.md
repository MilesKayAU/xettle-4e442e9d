

# Fix Debit Period Detection in AI Gap Analysis

## Problem
The `analyzeReconciliationGap` tool returns `contact_marketplace` for Bunnings settlement BUN-2301-2026-03-14, which has a negative bank deposit (-$50). This is a normal debit period (fees exceeded sales), not a gap requiring marketplace contact. The existing Bunnings branch (line 893) even diagnoses "fee-only period" but doesn't set the correct action.

Additionally, `sync-settlement-to-xero` already handles ACCPAY for negative settlements (line 738: `netAmount < 0 → ACCPAY`), so no changes needed there.

## Plan

### 1. Add debit period detection at Priority 0 in the decision tree
**File:** `supabase/functions/_shared/ai_tool_registry.ts` (~line 846, before the existing `if` chain)

Insert two new rules before all existing checks:
- **Priority 0a:** `bankDeposit < 0 && expectedNet > 0` — marketplace debited the account; fees/refunds exceeded sales
- **Priority 0b:** `bankDeposit < 0 && expectedNet <= 0` — pure fee debit, no sales

Both set `recommended_action = 'record_as_bill'` with clear explanation that this should be an ACCPAY bill in Xero.

### 2. Update the Bunnings-specific branch
**File:** `supabase/functions/_shared/ai_tool_registry.ts` (lines 893-905)

The Bunnings branch currently handles `bankDeposit < 0` in diagnosis text but still falls through. After fix #1, debit periods will be caught before reaching this branch, so no change needed here — but we'll verify the flow is correct.

### 3. Add `record_as_bill` to the client-side registry
**File:** `src/ai/tools/aiToolRegistry.ts`

Update the tool description to mention the `record_as_bill` action in the available actions list.

### 4. Redeploy the edge function
Deploy `ai-assistant` to pick up the updated `ai_tool_registry.ts`.

## Technical Detail

The debit period check inserts at line ~846, before `if (xeroMatch && ...)`:

```typescript
// Priority 0 — Debit period: bank deposit is negative
if (bankDeposit < 0 && expectedNet > 0) {
  diagnosis = `Bank deposit is negative ($${bankDeposit.toFixed(2)}), meaning the marketplace debited your account this period. Fees and refunds exceeded sales. This should be recorded as a bill (ACCPAY) in Xero.`;
  gapType = "debit_period";
  recommendedAction = "record_as_bill";
  recommendedActionReason = `Bank deposit is -$${Math.abs(bankDeposit).toFixed(2)} against computed net of $${expectedNet.toFixed(2)}. This is a debit period where marketplace deductions exceeded sales. Record as an ACCPAY bill, not an ACCREC invoice.`;
} else if (bankDeposit < 0 && expectedNet <= 0) {
  diagnosis = `Both bank deposit ($${bankDeposit.toFixed(2)}) and computed net ($${expectedNet.toFixed(2)}) are negative. Pure fee debit period with no net sales.`;
  gapType = "debit_period";
  recommendedAction = "record_as_bill";
  recommendedActionReason = `Pure fee debit period. Record as ACCPAY bill in Xero.`;
}
```

The existing `sync-settlement-to-xero` line 738 already does `netAmount < 0 → ACCPAY` for all marketplaces including Bunnings — no changes needed there.

## Files Modified
- `supabase/functions/_shared/ai_tool_registry.ts` — add debit period rules
- `src/ai/tools/aiToolRegistry.ts` — update description

