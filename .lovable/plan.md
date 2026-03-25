

# AI Scan Diagnosis Report — Bunnings Settlement BUN-2301-2026-03-14

## What the AI actually said

The AI scan returned a weak, generic response:
- "detailed gap breakdown is currently unavailable"
- Mentioned bank deposit of -$50.00
- Flagged 5 missing account mappings (Sales, Seller Fees, Refunds, Other Fees, Shipping)
- Recommended fixing account mappings first

The pre-AI rule-based text in the table row shows: "Bank deposit is lower than computed net — there may be deductions not captured in the settlement fields." This comes from `diagnoseGapReason()`, NOT from the upgraded tool.

## What went wrong with the AI scan

The upgraded tool code (lines 513-768 in `ai_tool_registry.ts`) is **structurally correct** — 7 parallel queries via `Promise.all()`, proper Bunnings rules, bank matching with ±$1 tolerance. The code itself is sound.

However, the AI model's response ("detailed gap breakdown is currently unavailable") strongly suggests one of two things happened:

1. **The tool returned `{ error: "Settlement not found" }`** — The query at line 519 uses `.eq("settlement_id", sid)` against the `settlements` table. If the settlement_id format passed from the UI (`BUN-2301-2026-03-14`) doesn't exactly match what's stored in `settlements.settlement_id`, the query returns null and the tool short-circuits at line 558.

2. **The AI model chose not to call the tool** — The prompt says "Use the analyzeReconciliationGap tool" but the model may have attempted its own analysis instead of invoking the tool, which means none of the 7 queries ran.

## What the code SHOULD have returned for Bunnings with a $550.73 gap

Based on lines 691-703, the Bunnings rule would fire:
- `absGap` = 550.73 (> $5 threshold)
- `recommended_action` = `"investigate_gap"`
- `recommended_action_reason` = "Bunnings gap exceeds $5. Check PDF extraction quality."
- `diagnosis` = "Bunnings PDF extraction can produce rounding errors." (or negative deposit variant)

Plus the 5 new data sections: xero_status, bank_match, top_line_items, fee_analysis, outstanding_invoices.

## The $550.73 gap itself — is it real?

With bank_deposit = -$50.00 and a gap of -$550.73, that means `expected_net ≈ $500.73`. A -$50 bank deposit on a Bunnings settlement strongly suggests:
- This is a **fee-only period** (no sales, just monthly platform fees / commission adjustments)
- OR the bank deposit field was incorrectly captured from the PDF

The gap is likely **real data** — either the PDF parser missed revenue lines, or this genuinely was a debit period where Bunnings charged fees exceeding sales.

## The missing account mappings

All 5 categories missing (Sales, Seller Fees, Refunds, Other Fees, Shipping) means Bunnings has **never been mapped** in the Account Mapper. This is a separate blocker from the gap — even if the gap resolves, pushing is blocked until mappings are configured.

## Recommended fixes

### Fix 1: Verify tool invocation (debug why AI said "unavailable")
Check edge function logs for the `ai-assistant` call to confirm whether `analyzeReconciliationGap` was actually invoked and what it returned. The settlement_id format may not match.

### Fix 2: Strengthen the AI prompt to force tool use
The current prompt in `handleAiScan` (line 152) says "Use the analyzeReconciliationGap tool" but the model can ignore this. Add a system message or use function_call forcing if the AI model supports it.

### Fix 3: Investigate the Bunnings settlement data
The -$50 bank deposit with $500+ computed net is a significant discrepancy. Check the original Bunnings PDF to verify whether revenue lines were captured correctly by the parser.

## Files involved

| File | Role |
|------|------|
| `supabase/functions/_shared/ai_tool_registry.ts` (lines 513-768) | Tool execution — code is correct |
| `src/components/dashboard/GapTriageTable.tsx` (lines 135-197) | AI scan trigger — prompt may need strengthening |
| `src/utils/diagnose-gap-reason.ts` | Rule-based fallback text shown in table row (working correctly) |

## Summary

The system coding is correct. The 7-query forensic tool, the Bunnings-specific rules, and the decision tree are all properly implemented. The issue is that **the AI model either didn't call the tool or the settlement wasn't found by ID**. The next step is to check the edge function logs to confirm which scenario occurred, then fix accordingly.

