

## Audit Results: Why No Data Synced

### Critical Finding: SetupStepScanning is NEVER RENDERED

`SetupStepScanning.tsx` — the component with the full adaptive scan orchestration — **is not imported or used anywhere**. The wizard has 4 steps: `Connect Xero → Marketplaces → Upload → Results`. There is no scanning step. The component is orphaned dead code.

### What Actually Happened

1. User signed up, went through the wizard, connected Xero, Shopify, Amazon
2. Wizard completed → set `onboarding_wizard_complete = true`
3. **No scanning ever ran** during the wizard — it skipped straight to Results
4. User lands on Dashboard (default view) — `PostSetupBanner` only renders on the **Upload Hub tab**, not the Dashboard tab
5. `run-validation-sweep` ran (from somewhere else), but found zero data → created empty "missing" rows for amazon_au and shopify_payments
6. **Result**: All tokens exist, but zero orders, zero settlements, zero sub-channels, zero channel alerts

### Database State Summary

| Data | Count | Expected |
|------|-------|----------|
| shopify_tokens | 1 ✅ | Token exists |
| amazon_tokens | 1 ✅ | Token exists |
| xero_tokens | 1 ✅ | Token exists |
| shopify_orders | **0** ❌ | Should have thousands |
| settlements | **0** ❌ | Should have Amazon + Shopify payouts |
| shopify_sub_channels | **0** ❌ | Should have Bunnings, MyDeal, etc. |
| channel_alerts | **0** ❌ | Should have detected channels |
| scan completion flags | **0** ❌ | Never written |
| Edge function calls (fetch/scan) | **0** ❌ | Never called |

### Root Causes (3 bugs)

**Bug 1 — SetupStepScanning is dead code**
The scanning component exists but is never rendered in the wizard or anywhere else. The wizard goes `Connect Xero → Marketplaces → Upload → Results` with no scanning step.

**Bug 2 — PostSetupBanner only renders on Upload tab**
It's inside `{activeView === 'smart_upload' && ...}`. The default landing is `'dashboard'`. If the user never clicks Upload Hub, scans never trigger.

**Bug 3 — No scan trigger on Dashboard mount**
The Dashboard view shows `DashboardConnectionStrip`, `ChannelAlertsBanner`, `ActionCentre`, and `ValidationSweep` — none of which trigger the API fetch/scan sequence.

### Fix Plan

**Fix 1: Wire SetupStepScanning into the wizard**
Insert it as Step 4 (before Results becomes Step 5) when the user has ANY API connected. The wizard becomes:
- Step 1: Connect Xero
- Step 2: Connect Stores (Amazon/Shopify)
- Step 3: Upload (if CSV marketplaces selected, else skip)
- **Step 4: Scanning** (if any API connected, else skip)
- Step 5: Results

**Fix 2: Move PostSetupBanner to Dashboard view (or both)**
The scan banner should appear on the default Dashboard tab — not hidden in Upload Hub. This ensures scans trigger even if the wizard was skipped or completed without scanning.

**Fix 3: Add a scan-on-first-load trigger**
On Dashboard mount, if tokens exist but no scan completion flags exist, auto-trigger the scan sequence. This catches users who completed the wizard before scanning was wired up (like the current test account).

### Secondary Issues Found

- **Duplicate `onboarding_wizard_complete`** rows for 2 different user_ids (2 test accounts)
- **Duplicate `amazon_au` marketplace_connections** — 2 rows with identical data
- **`callEdgeFunctionSafe` uses raw fetch** — works but edge function logs may not appear in the standard log viewer (explains "No logs found" for functions that did boot in the context logs)

### Implementation Details

**SetupWizard.tsx changes:**
- Import `SetupStepScanning`
- Update `STEP_LABELS` to `['Connect Xero', 'Marketplaces', 'Upload', 'Scanning', 'Results']`
- Update `TOTAL_STEPS` to 5
- Add scanning step rendering at `effectiveStep === 4`
- Auto-skip scanning step if no APIs connected (`!hasXero && !hasAmazon && !hasShopify`)

**Dashboard.tsx changes:**
- Move `PostSetupBanner` into the Dashboard view (not just Upload Hub), OR render it in both views
- Add first-load scan detection: check if tokens exist but scan flags don't, then trigger scan

**Deduplication:**
- Clean up duplicate `amazon_au` marketplace_connections (add `ON CONFLICT` guard in provisioning)

