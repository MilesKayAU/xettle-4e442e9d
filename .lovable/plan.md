

## Audit: Post-Signup Onboarding Flow

### Flow Structure (4 steps — correct)
1. **Connect Xero** → fires `scan-xero-history` background scan on Continue
2. **Marketplaces** (Shopify → Amazon → CSV) → fires `fetch-shopify-payouts`, `scan-shopify-channels`, `fetch-amazon-settlements` as fire-and-forget
3. **Upload** (only if CSV marketplaces selected or all APIs skipped)
4. **Results** → shows what was found, with sync-in-progress banner

### Issues Found

**1. Shopify background scans only fire if already connected — not on fresh connect**
In `SetupStepConnectStores.tsx`, `advanceFromShopify()` (line 113-118) fires scans only when `hasShopify` is already true and user clicks "Continue". But when user clicks "Connect Shopify", they get redirected to OAuth and leave the page entirely. On return, `Dashboard.tsx` sets `wizardInitialStep(2)` and `hasShopify(true)`, but the wizard reopens at step 2 — the Shopify card shows "Connected" with a Continue button. Clicking Continue calls `advanceFromShopify()` which correctly fires the scans. **This path works.**

**2. Same pattern for Amazon — works correctly**
OAuth redirect → return → `hasAmazon=true` → Continue → `advanceFromAmazon()` fires `fetch-amazon-settlements`. **This path works.**

**3. Xero OAuth return sets `wizardInitialStep(3)` — skips step 2 entirely**
Dashboard line 106: `connected === 'xero'` → `setWizardInitialStep(3)`. But step 3 in the new 4-step wizard is **Upload**, not Marketplaces. The user skips the Shopify/Amazon connection cards entirely. This is a **bug** — it should set initial step to **2** so the user lands on the Marketplaces step after connecting Xero.

**4. Upload step doesn't actually process files**
`SetupStepUpload.tsx` collects files into local state but never sends them to the backend. The files are stored in a `useState` and lost when the user clicks Continue. This is a **known limitation** — files need to be processed through SmartUploadFlow on the dashboard. The step is purely a placeholder that gives users a false sense of progress.

**5. `fireBackgroundScan` uses raw fetch instead of `supabase.functions.invoke`**
Lines 64-90 of `SetupWizard.tsx` construct URLs manually. This works but bypasses the Supabase client's built-in error handling and retry logic. Not a bug, but inconsistent with the rest of the codebase.

**6. Xero scan fires on "Continue" but not on fresh OAuth return**
When `hasXero` is true on wizard open (OAuth return), the user sees the green "Connected" card and clicks Continue. `handleContinue()` correctly fires `scan-xero-history`. **This works.**

**7. Results page auto-retry is single-shot**
`SetupStepResults.tsx` retries once after 5 seconds if scans are in progress. For scans that take 30-60 seconds, this single retry won't catch them. The user sees "syncing" but the data won't refresh further. Not critical — dashboard will show results — but the Results step may feel empty.

**8. Wizard show logic has a flaw at line 98**
```typescript
if (!hasAmz || !hasShp || !xeroConnected) { setShowWizard(true); }
```
This means the wizard shows even if the user has settlements + all APIs connected but is missing just one. Combined with `wizardComplete` check at line 93, this is mitigated — but only if the user completed the wizard previously.

### Recommended Fixes

**Critical (bug):**
- `Dashboard.tsx` line 106: Change `setWizardInitialStep(3)` to `setWizardInitialStep(2)` for Xero OAuth return. The old step 3 was "Upload" in the 5-step wizard; in the new 4-step wizard, step 2 is "Marketplaces" which is correct post-Xero.

**Important (UX):**
- Upload step: Either wire it to SmartUploadFlow or remove it and let users upload from dashboard. Currently it's a dead-end that discards files.
- Results auto-retry: Add a second retry at ~15 seconds, or poll until `scansInProgress` becomes false.

**Minor:**
- Shopify domain pre-fill (`mileskayaustralia.myshopify.com`) should be removed before production launch or gated behind a dev flag.

### Verdict
The architecture is sound — fire-and-forget scans, context-aware CSV step, adaptive Results messaging all work well. The one **breaking bug** is the Xero OAuth return setting `wizardInitialStep(3)` which skips the Marketplaces step entirely in the new 4-step wizard. The upload step being a no-op is a secondary concern since SmartUploadFlow on the dashboard handles real uploads.

### Files to Fix
- `src/pages/Dashboard.tsx` — line 106: change `setWizardInitialStep(3)` to `setWizardInitialStep(2)`
- `src/components/onboarding/SetupStepResults.tsx` — add second auto-retry at 15s
- Optionally: remove or wire up `SetupStepUpload.tsx`

