

# Gap Analysis: Current Clone COA vs. Sitewide Guided Flow Spec

## What Already Exists (Strong Foundation)

| Spec Phase | Status | What's Built |
|---|---|---|
| **Phase 1 — Canonical Actions** | ~90% done | `detectCoaCoverageGaps` → `getMarketplaceCoverage()` in `coaCoverage.ts`. `getEligibleCloneTemplates` → `validateTemplateEligibility()` in `coaClone.ts`. `buildClonePreview()` exists with pattern matching. `executeCoaClone()` exists with batching. All exported from `@/actions`. |
| **Phase 5 — Telemetry** | ~80% done | `logCloneEvent()` logs `coa_clone_executed`, `coa_clone_failed`, `coa_clone_previewed`, `coa_clone_cancelled` to `system_events`. Missing: `coa_clone_preview_generated` is defined in types but never called. |
| **Phase 6 — Guardrails** | Done | 24/24 canonical action tests pass. `validateAccountCode()` enforced. PIN gate on clone trigger in `AccountMapperCard`. |

## What's Missing (Phases 2, 3, 4)

### Phase 2 — Sitewide "Resolve Mapping Blockers" CTA
**Not implemented.** Clone is only reachable from `AccountMapperCard.tsx` (Settings page). The spec requires it from:
- `PushSafetyPreview` — when push blocked by `MAPPING_REQUIRED`
- Compare drawer / Outstanding tab — when verdict is `BLOCKED`
- Marketplace connect flow — on provision

**Plan:** Create a shared `CoaBlockerCta` component that renders the three CTA options (Open Mapper, Clone COA, Create manually). Wire it into `PushSafetyPreview` and `SettlementDetailDrawer` where `MAPPING_REQUIRED` errors surface.

### Phase 3 — Marketplace Connect Onboarding Integration
**Not implemented.** When a marketplace is provisioned (via `provisionMarketplace()` in `src/actions/marketplaces.ts`), there is no COA coverage check or clone prompt.

**Plan:** After marketplace provisioning completes, run `getMarketplaceCoverage()` for the new marketplace. If uncovered and a template exists, show the `CloneCoaDialog` with an introductory message. This hooks into the existing `SetupStepConnectStores` or the marketplace config flow.

### Phase 4 — Auto-map + Re-check Readiness
**Partially implemented.** After clone in `AccountMapperCard`, the `onComplete` callback does update `editableMapping` with the created codes. But:
- No auto-save of the mapping to `app_settings` (user must still click Confirm)
- No automatic `checkPushCategoryCoverage()` re-run
- No automatic COA cache refresh (it does refresh COA, but doesn't re-run push eligibility)
- No success banner with "mappings applied, posting unblocked"

**Plan:** After clone completes, auto-save mappings as draft, trigger COA refresh, re-run coverage check, and show a success toast with unblock status.

## Implementation Plan

### 1. Create `CoaBlockerCta` shared component
**File:** `src/components/shared/CoaBlockerCta.tsx`

A small component that accepts `marketplace`, `missingCategories`, and renders:
- "Open Account Mapper" button (links to settings)
- "Clone COA" button (opens `CloneCoaDialog`, PIN-gated)
- "Create manually" guidance link

Requires COA accounts + coverage data passed as props or fetched internally.

### 2. Wire `CoaBlockerCta` into `PushSafetyPreview`
When `MAPPING_REQUIRED` error is detected in the validation checks, render `CoaBlockerCta` inline instead of just a red error badge.

### 3. Wire into marketplace provisioning
In `SetupStepConnectStores` or the marketplace connect confirmation flow, after successful provision:
- Fetch COA accounts
- Run `getMarketplaceCoverage([newMarketplace], accounts)`
- If uncovered + template available → open `CloneCoaDialog`

### 4. Auto-map after clone
Enhance `CloneCoaDialog`'s `onComplete` to:
- Auto-save created mappings as draft in `app_settings`
- Re-run `checkPushCategoryCoverage()` and surface result in toast
- Show "COA created + mappings applied" success banner

### 5. Log `coa_clone_preview_generated`
Add the missing `logCloneEvent` call in `CloneCoaDialog` when preview rows are generated.

### 6. Update audit matrix
Add entry points: PushSafetyPreview, marketplace connect flow, compare drawer.

## Files Changed

| File | Change |
|------|--------|
| `src/components/shared/CoaBlockerCta.tsx` | New — shared CTA component |
| `src/components/admin/accounting/PushSafetyPreview.tsx` | Wire `CoaBlockerCta` for MAPPING_REQUIRED |
| `src/components/settings/CloneCoaDialog.tsx` | Add preview event log, enhance onComplete for auto-map |
| `src/components/onboarding/SetupStepConnectStores.tsx` | Post-provision COA check + clone prompt |
| `docs/action-audit-matrix.md` | Update entry points |

## Safety
- All new paths use canonical actions only — no direct edge calls
- Clone still requires PIN + explicit confirmation
- Auto-map writes to draft only (confirm still requires PIN)
- No automatic Xero writes

