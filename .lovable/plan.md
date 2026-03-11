

## Plan: Onboarding Wizard UX Fixes

### What the screenshots show
- Wizard still says "Step 4 of 4" with no Scanning step visible (image-173)
- Results shows "0 Settlements ready, 1 Gaps detected" prematurely
- No back navigation exists between steps

### Changes

**1. Back navigation (SetupWizard.tsx + each step component)**

Add `handleBack` function to SetupWizard that decrements step, respecting skip logic (if Upload was skipped, back from Scanning goes to Marketplaces). Pass `onBack` prop to Steps 2, 3, and 4. Each step renders a `← Back` link in bottom-left. Step 1 and Step 5 (Results) have NO back button.

Affected files:
- `SetupWizard.tsx` — add `handleBack`, pass `onBack` to steps 2-4
- `SetupStepConnectStores.tsx` — accept `onBack`, render back link
- `SetupStepUpload.tsx` — accept `onBack`, render back link  
- `SetupStepScanning.tsx` — accept `onBack`, render back link (only before scans start running)

**2. Redesign Results as two-phase scanning + summary (merge Scanning into Results)**

The current architecture has Scanning (Step 4) auto-advancing to Results (Step 5). The user wants these merged into a single "Results" step with Phase A (scanning progress) and Phase B (summary). This means:

- **Remove SetupStepScanning as a separate wizard step** — move its scan orchestration INTO SetupStepResults
- Wizard goes back to 4 steps: `Connect Xero → Marketplaces → Upload → Results`
- Results renders Phase A (scanning indicators with ⟳→✅) while scans run, then transitions to Phase B (summary) when all complete or after 3-min timeout
- Phase A shows "Go to Dashboard" button so users can leave early
- Phase B shows per-marketplace breakdown with real counts

**3. Scan polling from app_settings**

Results component polls `app_settings` for `scan_amazon_completed`, `scan_shopify_completed`, `scan_xero_completed` every 5 seconds. Each poll updates the corresponding step indicator. Phase B triggers when all relevant flags exist or 3-minute timeout.

**4. Step label fix**

Wizard header goes back to 4 labels: `['Connect Xero', 'Marketplaces', 'Upload', 'Results']`. The "Step X of 4" shown in screenshots matches user expectation.

### Files to modify

| File | Change |
|------|--------|
| `SetupWizard.tsx` | Revert to 4 steps, add `handleBack`, pass `onBack` to steps 2-3, remove SetupStepScanning rendering |
| `SetupStepConnectStores.tsx` | Add `onBack` prop, render `← Back` link |
| `SetupStepUpload.tsx` | Add `onBack` prop, render `← Back` link |
| `SetupStepResults.tsx` | Full rewrite: Phase A scanning orchestration (moved from SetupStepScanning), Phase B summary. Poll scan flags. 3-min timeout. "Go to Dashboard" escape hatch. |

### Results Phase A layout
```text
┌──────────────────────────────────────┐
│  🔍 Scanning your accounts...       │
│  This takes 1-3 minutes.            │
│                                      │
│  ████████░░░░░░░░░░░░  35%          │
│                                      │
│  ✅ Scanning Xero history...        │
│  ⟳ Fetching Amazon settlements...   │
│  ⟳ Syncing Shopify payouts...       │
│  ○ Detecting sales channels...       │
│  ○ Building marketplace picture...   │
│                                      │
│  [Go to Dashboard →]  [Wait here]   │
└──────────────────────────────────────┘
```

### Results Phase B layout
```text
┌──────────────────────────────────────┐
│  🎉 Here's what we found            │
│                                      │
│  ┌─────────┐ ┌─────────┐            │
│  │ 19      │ │ 2       │            │
│  │ settled │ │ push    │            │
│  └─────────┘ └─────────┘            │
│                                      │
│  ✅ Amazon AU: 19 settlements        │
│  ✅ Shopify: 15 payouts synced       │
│  ✅ Channels: MyDeal, Bunnings       │
│  ✅ Xero: 18 existing records        │
│  ⚠️ Upload needed: 3 marketplaces   │
│                                      │
│  [Go to Dashboard →]                │
└──────────────────────────────────────┘
```

