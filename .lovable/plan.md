

# Fix: External Xero Invoices (Link My Books) Not Recognized as "Already in Xero"

## Problem

Link My Books has already pushed all Amazon settlements to Xero (status: "Posted"/PAID). But Xettle still shows 16 Amazon settlements as "Ready to Push". This affects **all marketplaces**, not just Amazon — any settlement posted by an external tool (LMB, A2X, manual) is invisible to the validation system.

## Root Cause (3 gaps in the pipeline)

### Gap 1: Validation sweep ignores `xero_accounting_matches`

The `run-validation-sweep` function (Step 4, line 617) only checks for Xero status via:
- Direct Xero API call filtered to `Reference.StartsWith("Xettle-")` — completely misses LMB/A2X/manual invoices
- `settlement.xero_journal_id` — only set when Xettle pushes
- `settlement.status === 'pushed_to_xero'` — only set when Xettle pushes

It **never reads `xero_accounting_matches`**, where `sync-xero-status` correctly stores external invoices as `external_candidate` entries.

### Gap 2: Auto-resolve only triggers for `PAID` status

In `sync-xero-status` (line 1100), the auto-resolve logic that marks settlements as `already_recorded` only fires when `xero_status === 'PAID'`. If LMB invoices are `AUTHORISED` (posted but not yet bank-reconciled in Xero), they're ignored.

### Gap 3: External candidates require manual review that doesn't exist

External invoices are stored with `confidence: 0` and `match_method: 'external_candidate'`, requiring "user review before linking" — but there's no UI for this review. The data sits in the cache unused.

## Fix Plan

### 1. Validation sweep: Read `xero_accounting_matches` for external coverage

**File: `supabase/functions/run-validation-sweep/index.ts`**

After building the Xettle-only `xeroInvoiceMap`, also query `xero_accounting_matches` for all settlements belonging to this user. In Step 4, after checking the Xettle invoice map, add a fallback:

```
If settlement_id exists in xero_accounting_matches
  AND xero_status is PAID or AUTHORISED:
    → set xero_pushed = true
    → set xero_invoice_id from the match
```

This ensures externally-posted settlements (LMB, A2X, manual) are recognized.

### 2. Auto-resolve: Expand to include `AUTHORISED` status

**File: `supabase/functions/sync-xero-status/index.ts`**

Change the auto-resolve query (line 1100) from:
```sql
.eq('xero_status', 'PAID')
```
To:
```sql
.in('xero_status', ['PAID', 'AUTHORISED'])
```

And update the settlement status to `already_recorded` with `sync_origin: 'external'` for both statuses.

### 3. Settlements table: Mark externally-covered settlements

**File: `supabase/functions/sync-xero-status/index.ts`**

After the auto-resolve step, also update `marketplace_validation` rows for these resolved settlements to set `xero_pushed = true` so the dashboard trigger correctly computes `overall_status`.

### 4. Add `external_candidate` entries to validation sweep's xero check

**File: `supabase/functions/run-validation-sweep/index.ts`**

Before the per-period loop, load all `xero_accounting_matches` for the user:

```typescript
const { data: xamRows } = await adminSupabase
  .from('xero_accounting_matches')
  .select('settlement_id, xero_invoice_id, xero_status')
  .eq('user_id', userId)
  .in('xero_status', ['PAID', 'AUTHORISED', 'DRAFT'])

const xamBySettlement = new Map()
for (const row of (xamRows || [])) {
  xamBySettlement.set(row.settlement_id, row)
}
```

Then in Step 4, after the existing checks:

```typescript
// Fallback: check xero_accounting_matches (covers LMB, A2X, manual)
if (!record.xero_pushed && settlement && xamBySettlement.has(settlement.settlement_id)) {
  const xam = xamBySettlement.get(settlement.settlement_id)
  if (['PAID', 'AUTHORISED'].includes(xam.xero_status)) {
    record.xero_pushed = true
    record.xero_invoice_id = xam.xero_invoice_id
    record.xero_pushed_at = new Date().toISOString()
  }
}
```

For `PAID` matches, also force `overall_status = 'already_recorded'` on the settlement row itself.

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/run-validation-sweep/index.ts` | Load `xero_accounting_matches`, use as fallback in Step 4 for external invoice detection |
| `supabase/functions/sync-xero-status/index.ts` | Expand auto-resolve from PAID-only to PAID+AUTHORISED; update marketplace_validation after resolve |

## Expected outcome

- Amazon (and all other marketplaces) settlements that LMB/A2X have already posted to Xero will be recognized as "already recorded"
- The "Ready to Push" count will drop from 16 to only truly unposted settlements
- Homepage and Settlements Overview will agree on counts
- No manual review step needed for high-confidence external matches (PAID/AUTHORISED status is definitive)

