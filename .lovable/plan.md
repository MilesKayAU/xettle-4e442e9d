

## Problem

When files are uploaded with wrong column mappings (e.g. pre-fingerprint Kogan files parsed via AI with guessed mappings), the system saves settlements with catastrophically wrong values — `sales_principal` of -$174M, `bank_deposit` of $0. There is **no sanity check** anywhere in the pipeline. The generic CSV parser produces whatever the mapping tells it, and `saveSettlement()` inserts it verbatim. The user only discovers corruption later when Insights charts are broken.

The fix should happen at **two gates** — pre-save validation in the parser output, and a final sanity check before database insert — so corrupted data can never reach the database regardless of how bad the mapping is.

---

## Plan

### 1. Add sanity validation to `saveSettlement()` (settlement-engine.ts)

Before inserting into the database, add a `validateSettlementSanity()` check:

| Check | Rule | Action |
|-------|------|--------|
| Zero net with large sales | `bank_deposit === 0` AND `abs(sales_principal) > 1000` | Block save, return error |
| Implausible magnitude | `abs(sales_principal) > 10,000,000` (>$10M per settlement) | Block save, return error |
| Fees exceed sales | `abs(seller_fees) > abs(sales_principal) * 5` | Block save, return error |
| All zeroes | `sales_principal === 0 AND seller_fees === 0 AND bank_deposit === 0` | Block save, return error |
| Negative net with positive sales | `bank_deposit < 0` AND `sales_principal > 10000` | Warning only (valid for refund-heavy periods) |

Return a structured error like: `"Settlement failed sanity check: bank deposit is $0 but sales are $174,000,000. This likely indicates incorrect column mapping."`

### 2. Add pre-parse sanity in generic-csv-parser.ts

After building each settlement in `parseGenericCSV`, run a lightweight check before adding to the results array. If a settlement fails (e.g. net=0 but gross > $1000), add it to a new `warnings` entry and either:
- Skip it entirely, OR  
- Include it but flag it with `metadata.sanity_failed = true`

This catches the problem before `saveSettlement` is even called.

### 3. Surface sanity failures in SmartUploadFlow UI

When `saveSettlement()` returns a sanity error (not a duplicate), show a **red warning card** on the file result instead of silently failing:

```
⛔ Data integrity check failed
Sales: $174,000,000 but Bank Deposit: $0
This usually means the columns were mapped incorrectly.
→ Try re-uploading with the correct report format, or use "Analyze with AI" for auto-detection.
```

Also in the settlement preview (before confirm), highlight any settlement row where the preview numbers look implausible — e.g. show a red `⚠ Check mapping` badge next to the net payout if it's $0 while gross is > $1000.

### 4. Add preview-stage sanity indicators

In the existing settlement preview table (the financial breakdown shown after detection), add inline warnings:
- If `net_payout === 0` and `sales_ex_gst > 500`: show amber warning "Net is $0 — check column mapping"
- If `fees_ex_gst > sales_ex_gst * 3`: show "Fees seem disproportionate"

These visual cues let the user catch problems **before** clicking Confirm.

---

## Files to change

| File | Change |
|------|--------|
| `src/utils/settlement-engine.ts` | Add `validateSettlementSanity()` function, call it at top of `saveSettlement()` before insert |
| `src/utils/generic-csv-parser.ts` | Add post-aggregation sanity check per settlement, flag or skip failed ones |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Show sanity errors distinctly from duplicates, add preview-stage warnings on suspicious numbers |

