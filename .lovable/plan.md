

## Plan: AI-Powered COA Clone Validation and Advice

### Problem
The current clone logic scatters new codes across ranges because `generatePatternBatchCodes` starts scanning from each template account's own code number. When those numbers are already taken, it jumps to the next available slot — which can be far away and in an illogical grouping. For example, cloning Amazon (200, 215.1, 205, 401) for Temu produces 214, 322, 216, 435 — scattered and inconsistent.

Additionally, there is no guidance on whether the suggested account types and groupings follow Xero best practices.

### Changes

**1. New edge function: `supabase/functions/ai-coa-clone-review/index.ts`**

Accepts the clone preview rows plus the full COA and returns:
- A quality verdict (PASS / WARN / FAIL) for each row
- Suggested corrections (better codes, names, account types)
- Brief Xero best-practice advice (e.g. "Revenue accounts should be grouped in 200-299", "Use DIRECTCOSTS for cost-of-sale items like shipping costs and fees")

Uses Lovable AI (`google/gemini-3-flash-preview`) with a specialist system prompt covering:
- Xero account type conventions (REVENUE, DIRECTCOSTS, EXPENSE, OTHERINCOME)
- Australian e-commerce COA best practices
- Code grouping (new marketplace codes should be contiguous)
- Naming conventions (e.g. `{Code} {Marketplace} {Category}`)

**2. Fix code grouping in `src/policy/accountCodePolicy.ts` — `generatePatternBatchCodes`**

Current bug: each base account scans from its own template code, so new codes scatter. Fix: group all revenue-type accounts together by finding a contiguous block of free codes in the revenue range, and same for expense-type accounts. This ensures Temu revenue accounts are e.g. 214, 215, 216, 217 (contiguous) rather than 214, 322, 216.

**3. Update `src/components/settings/CloneCoaDialog.tsx`**

- Add an "AI Review" button/panel below the preview table
- On click, call the new edge function with the preview rows and COA
- Display per-row verdicts (green check / amber warning) inline
- Show a collapsible advice panel with Xero best-practice tips
- AI review is optional — user can still proceed without it
- Loading state while AI processes

### Technical Detail

**Edge function system prompt (excerpt):**
```
You are a Xero Chart of Accounts specialist for Australian e-commerce businesses.
Review the proposed clone accounts and check:
1. Account codes are grouped contiguously per marketplace
2. Revenue items (Sales, Shipping Income, Refunds, Promos) use REVENUE type in 200-399
3. Cost items (Seller Fees, FBA Fees, Advertising) use DIRECTCOSTS or EXPENSE in 400-599
4. Names follow "{Marketplace} {Category}" convention
5. No orphaned codes far from their siblings
Return JSON via tool call with per-row verdicts and overall advice.
```

**Code grouping fix logic:**
- Collect all revenue-type rows and all expense-type rows separately
- For revenue: find the first contiguous block of N free codes in 200-399
- For expense: find the first contiguous block of M free codes in 400-599
- Assign codes sequentially within each block

### Files Changed
- `supabase/functions/ai-coa-clone-review/index.ts` — new
- `src/policy/accountCodePolicy.ts` — fix `generatePatternBatchCodes` grouping
- `src/components/settings/CloneCoaDialog.tsx` — add AI review panel

