

## FBM Mismatch Detection — Proactive Dashboard Alerting

### The Scenario
User selects FBA during onboarding. Later they start doing FBM orders on Amazon. New settlements arrive with MFN lines, but the system is configured as `marketplace_fulfilled` (FBA-only). Currently, the mismatch detection only triggers when the user visits Settings > Fulfilment Methods — they may never see it.

### What Already Works
- `FulfilmentMethodsPanel` scans `settlement_lines` for MFN/MFN_inferred tags and shows an amber banner if the marketplace is set to `marketplace_fulfilled` — but only on the Settings page
- `useDashboardTaskCounts` warns about unconfigured fulfilment methods and missing postage costs — but doesn't check for FBA/FBM mismatch
- The backfill edge function correctly classifies orders as AFN_inferred or MFN_inferred from fee patterns

### What Needs to Change

**1. Add FBM mismatch detection to `useDashboardTaskCounts`**

File: `src/hooks/useDashboardTaskCounts.ts`

After the existing fulfilment method checks (around line 191), add a new check: for any marketplace set to `marketplace_fulfilled`, query `settlement_lines` for MFN/MFN_inferred rows. If found, push a setup warning:

```
key: 'fbm_mismatch_detected'
label: 'FBM orders detected on FBA-only account'  
severity: 'warning'
message: 'We found merchant-fulfilled orders for {marketplace}. Update your fulfilment method to "Mixed FBA + FBM" in Settings → Fulfilment Methods for accurate profit.'
```

This surfaces the alert on the Dashboard's DailyTaskStrip alongside other setup warnings.

**2. Add `mixed_fba_fbm` to postage cost missing check**

File: `src/hooks/useDashboardTaskCounts.ts`, line 167

Currently only checks `self_ship` and `third_party_logistics` for missing postage. Add `mixed_fba_fbm` to this check so users in mixed mode also get warned if they haven't set a postage cost.

### What Does NOT Change
- Settings page detection (already works)
- Backfill logic (already classifies MFN correctly)
- Profit engine (already deducts $0 for misconfigured FBA-only, so no incorrect charges — just overstated profit)
- No forced changes — this is advisory, matching the pattern of all other setup warnings

### Technical Detail
The mismatch query needs to be efficient. Add a single query to the existing parallel fetch in `fetchTaskCounts()`:
- Query `settlement_lines` for any rows with `fulfilment_channel IN ('MFN', 'MFN_inferred')`, joined to `settlements` to get marketplace code
- Only check marketplaces where `fulfilment_method` is `marketplace_fulfilled`
- Limit 1 per marketplace (existence check only)

