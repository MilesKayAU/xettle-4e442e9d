

## Plan: Relax Reconciliation Tab Filter to Show Externally-Posted Records

### Problem
The Reconciliation tab currently hides `shopify_auto_*` rows with `already_recorded` status. These are legitimate records — they represent settlements posted to Xero by external tools like Link My Books. The user expects to see these larger-value Kogan periods ($5,354 across 7 rows) as confirmation that external posting was detected.

### Database Evidence
- 7 Kogan rows with `already_recorded` totaling **$5,354.36** — hidden by filter
- 3 eBay AU rows with `already_recorded` totaling $150.09 — correctly hidden (has direct API)
- 3 Shopify Payments rows with `already_recorded` — correctly hidden (has direct API)
- Only 2 rows currently visible: Kogan $1,098 and Everyday Market $241

### Change

**`src/components/onboarding/ValidationSweep.tsx`**

Update `isUsefulRecon` to only exclude `duplicate_suppressed` (true duplicates), not `already_recorded` (externally posted). The `already_recorded` status is valuable — it confirms Link My Books or A2X already handled the period.

```typescript
// Before:
!['already_recorded', 'duplicate_suppressed'].includes(r.overall_status)

// After:
r.overall_status !== 'duplicate_suppressed'
```

This will surface the 7 hidden Kogan reconciliation rows, bringing the Reconciliation tab count from 2 to 9 and showing the full picture of externally-managed periods.

### Files Modified
1. **`src/components/onboarding/ValidationSweep.tsx`** — Remove `already_recorded` from recon exclusion filter

