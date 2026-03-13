

# Diagnostic Plan: Amazon Settlement Matching Evidence

## What this plan does
Runs live data queries to produce two deliverables:
1. **Settlement coverage table** — every `amazon_au` settlement in DB vs what should exist
2. **21-invoice classification table** — per-invoice proof of why each does/doesn't match

Then applies one small code fix for split-part extraction.

## Phase 0 — Environment confirmation
Run SQL to confirm user context:
```sql
SELECT id, tenant_id FROM xero_tokens ORDER BY created_at DESC LIMIT 1;
```
Output: user_id, tenant_id, timestamp.

## Phase 1 — Settlement ingestion coverage
Query all `amazon_au` settlements from Jan 2026:
```sql
SELECT settlement_id, marketplace, period_start, period_end, bank_deposit, status, source, created_at
FROM settlements
WHERE marketplace = 'amazon_au' AND period_end >= '2026-01-01'
ORDER BY period_end ASC;
```
Plus gap detection:
```sql
SELECT period_start::date, period_end::date, COUNT(*)
FROM settlements
WHERE marketplace = 'amazon_au'
GROUP BY 1, 2
ORDER BY 2;
```
Deliverable: list of ingested periods + any gaps relative to Seller Central screenshots.

## Phase 2 — Invoice classification
Invoke `fetch-outstanding` edge function and produce a table for all returned rows with columns:
- `xero_invoice_number`, `xero_reference`, `amount`, `currency_code`
- `marketplace` (detected), `settlement_id` (extracted), `has_settlement`
- `match_status`, `settlement_evidence.split_part`
- `reason_unmatched` (one of: `reference_unrecognized`, `settlement_not_ingested`, `marketplace_mismatch`, `currency_mismatch`, `matched`, `matched_fuzzy`)

This is the "21-row truth table" that resolves every invoice.

## Phase 3 — Split-part extraction fix
**File**: `supabase/functions/fetch-outstanding/index.ts`
**Location**: `extractSettlementId()` (line 57-71)

Add explicit pattern before the generic numeric regex (line 65):
```typescript
// Handle "Amazon AU Settlement {id} - Part {n}" format
const amazonSettlementMatch = reference.match(/Amazon.*Settlement\s+(\d+)\s*-\s*Part\s+(\d+)/i);
if (amazonSettlementMatch) return { id: amazonSettlementMatch[1], part: Number(amazonSettlementMatch[2]) };
```

This ensures INV-0788 and similar split invoices populate `split_part` correctly, using part-specific evidence totals instead of full-settlement figures.

## Phase 4 — Report conclusion
After data collection, classify root causes into buckets:
- **Matched correctly**: invoice has `has_settlement=true` via reference or fuzzy
- **Settlement not ingested**: extracted ID exists but no DB row (older periods or US marketplace)
- **Non-Xettle invoice**: no recognizable reference pattern
- **Bank deposit missing**: settlement matched but no bank txn (separate from this diagnostic — requires bank account mapping)

## Execution order
1. Run Phase 0+1 SQL queries via database read tool
2. Invoke fetch-outstanding edge function for Phase 2
3. Apply Phase 3 code fix
4. Report findings with per-invoice evidence

