

## Problem

When uploading files for settlements that already exist with `already_recorded` status, the system shows an amber "Re-parse Confirm" card instead of automatically processing them. Users don't notice or understand these confirmation cards, so the data silently fails to ingest.

`already_recorded` settlements are pre-boundary legacy records with no Xero linkage — there is zero risk in overwriting them with fresh data.

## Fix

**One-line change** in `SmartUploadFlow.tsx` (line 783):

Add `already_recorded` to the auto-reparse status list:

```typescript
// BEFORE
['gap_detected', 'settlement_needed', 'upload_needed', 'missing', 'ingested'].includes(firstDupeStatus)

// AFTER
['gap_detected', 'settlement_needed', 'upload_needed', 'missing', 'ingested', 'already_recorded'].includes(firstDupeStatus)
```

This makes `already_recorded` settlements auto-reparse on upload (same as `gap_detected` or `ingested`), with an info toast confirming it happened. No manual confirmation step needed.

The only statuses that will still require confirmation are:
- `ready_to_push` — user has validated this data, so a confirmation is reasonable
- `pushed_to_xero` — hard-blocked as it should be

## Technical Details

- File: `src/components/admin/accounting/SmartUploadFlow.tsx`, line 783
- The `alwaysConfirmReparse` user preference toggle still overrides this for users who want extra caution
- The validation sweep runs after save regardless, so data integrity is maintained

