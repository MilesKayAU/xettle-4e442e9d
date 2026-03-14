

## Plan: Settlement-Level Matching in fetch-outstanding

### Problem
The current code groups Amazon invoices into **5-day date windows** (lines 847-878) and then tries to match each group against **bank transactions**. This is wrong because:
- Amazon pays per **settlement_id**, not per date window
- Bank feed is not required for matching — settlements already contain the payout amount
- Invoices with the same settlement_id get split across date windows, breaking the match

### What Changes (single file: `supabase/functions/fetch-outstanding/index.ts`)

**1. Replace 5-day window grouping with settlement_id grouping (lines ~807-946)**

Remove the entire `AggregateGroup` / 5-day window block. Replace with:
- Group all invoices by their extracted `settlement_id` (already done per-invoice at line 976)
- For each settlement group: sum `AmountDue` across all invoices in the group
- Load the corresponding settlement from `settlementMap`
- Compare: `abs(group_sum - abs(settlement.bank_deposit ?? settlement.net_ex_gst))` with tolerance `<= 0.50`
- Store result as `settlement_group_match: { matched, group_sum, settlement_net, difference, invoice_count, confidence }`

**2. Update match_status logic (lines ~1183-1213)**

Add a new status path before the bank-dependent checks:
- If invoice belongs to a settlement group that matched at settlement level → `match_status = 'settlement_matched'`
- Confidence: `high` if diff <= 0.10, `medium` if diff <= 0.50
- This does NOT require bank feed

**3. Expose settlement group info in response rows (lines ~1220-1289)**

Add fields to each row:
- `settlement_group_matched: boolean`
- `settlement_group_sum: number | null`
- `settlement_group_net: number | null`  
- `settlement_group_diff: number | null`
- `settlement_group_invoice_count: number | null`
- `settlement_group_confidence: 'high' | 'medium' | null`

**4. Keep existing 1:1 bank matching intact**

The per-invoice bank matcher (lines 1059-1173) stays as-is for optional bank verification. Settlement-level matching takes priority; bank match becomes supplementary evidence.

**5. Update summary counters**

`matched_with_settlement` counter increments for settlement-group-matched invoices. Add `settlement_level_matches` to `sync_info`.

### What Does NOT Change
- No new edge functions
- No new tables
- No new pipelines
- Bank feed logic stays (optional verification)
- `extractSettlementId()` already works correctly
- `settlementMap` already loaded

### Expected Result
Outstanding tab will show:
```
Settlement 291854 | 2 invoices | $742.18 due | $742.18 settlement | Matched (high)
```
Instead of: `Awaiting deposit`

