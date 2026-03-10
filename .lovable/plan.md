

# Setup Wizard — Implementation Plan

## What We're Building

A 5-step dismissible modal overlay that guides new users through API connections, triggers a server-side scan, and shows instant value — all without blocking dashboard access.

## Files

| File | Action | ~Lines |
|---|---|---|
| `src/components/onboarding/SetupWizard.tsx` | Create — orchestrator modal | ~130 |
| `src/components/onboarding/SetupStepConnectStores.tsx` | Create | ~90 |
| `src/components/onboarding/SetupStepConnectXero.tsx` | Create | ~70 |
| `src/components/onboarding/SetupStepScanning.tsx` | Create | ~80 |
| `src/components/onboarding/SetupStepResults.tsx` | Create | ~100 |
| `src/components/onboarding/SetupStepActions.tsx` | Create | ~80 |
| `src/pages/Dashboard.tsx` | Modify — add wizard gate | ~25 |
| `src/pages/AmazonCallback.tsx` | Modify — redirect to `/dashboard?connected=amazon` | 1 line |
| `src/pages/ShopifyCallback.tsx` | Modify — redirect to `/dashboard?connected=shopify` | 1 line |
| `src/pages/XeroCallback.tsx` | Modify — redirect to `/dashboard?connected=xero` | 1 line |

## Architecture

### Wizard Show/Hide Logic (Dashboard.tsx)

```text
Show wizard if:
  !wizard_complete
  AND (!amazon_tokens OR !shopify_tokens OR !xero_tokens)
  AND no settlements exist

Skip wizard if:
  wizard_complete (app_settings key)
  OR settlements exist (user already using product)
```

Pre-check runs 4 parallel queries on mount. Wizard renders as a Dialog overlay — user can close anytime via "Skip for now" / X button. Closing without completing does NOT persist `wizard_complete`, so it reappears next visit. Track `wizard_shown_count` in sessionStorage; stop auto-showing after 3 dismissals (persist that count to `app_settings`).

### OAuth Return Detection

Callback pages append query param to redirect:
- `AmazonCallback`: `navigate('/dashboard?connected=amazon')`
- `ShopifyCallback`: `navigate('/dashboard?connected=shopify')`
- `XeroCallback`: `navigate('/dashboard?connected=xero')`

Dashboard reads `searchParams.get('connected')` and passes initial step to wizard:
- `amazon` or `shopify` → open wizard at step 2 (Connect Xero)
- `xero` → open wizard at step 3 (Scanning)

### Step Persistence

Current step stored in `sessionStorage('xettle_setup_step')` so page refresh restores position. No DB persistence needed.

### SetupWizard.tsx (Orchestrator)

- Uses `Dialog` from radix (existing component)
- State: `step` (1-5), passed down to sub-components
- Progress bar at top: 5 labeled dots
- Each step component receives `onNext`, `onSkip`, `onClose`
- Estimated time text: "Setup takes about 60 seconds"

### Step 1 — Connect Stores (SetupStepConnectStores.tsx)

- Title: "Let Xettle automate your accounting"
- Dynamic connector list (future-proof): `[{ id: 'amazon', label: 'Amazon', recommended: true }, { id: 'shopify', label: 'Shopify', recommended: true }]`
- Connect buttons trigger existing OAuth flows:
  - Amazon: invoke `amazon-auth` edge function to get OAuth URL, redirect
  - Shopify: invoke `shopify-auth` edge function with shop domain input
- Trust signal: "Xettle never changes your accounting without your approval."
- "Or upload settlement files manually" link → closes wizard
- "Skip for now" always visible

### Step 2 — Connect Xero (SetupStepConnectXero.tsx)

- Single card with "Connect Xero" button
- Triggers existing `xero-auth` OAuth flow
- Reassurance: "Xettle will safely check your existing accounting so we don't duplicate anything."
- "Skip for now" → advance to step 3

### Step 3 — Scanning (SetupStepScanning.tsx)

- Calls `run-validation-sweep` edge function (single orchestrator, server-side)
- Animated checklist reusing the `SWEEP_STEPS` pattern from `ValidationSweep.tsx`
- **30-second timeout**: if exceeded, show "Scanning is taking longer than expected. We'll continue in the background." and auto-advance
- Progress streaming: poll `marketplace_validation` table every 3s to update checklist items as they complete (lightweight, no WebSocket needed)

### Step 4 — Results (SetupStepResults.tsx)

- Query `marketplace_validation` grouped by `marketplace_code`
- Show value metrics per marketplace:
  - "Amazon AU — 18 settlements, $24,840 revenue detected ✓"
  - "Kogan — settlements missing ⚠"
- Uses `STATUS_CONFIG` pattern from `ValidationSweep.tsx`
- Falls back gracefully if no validation rows yet

### Step 5 — Actions (SetupStepActions.tsx)

- Dynamically ordered by impact:
  1. "Push settlements to Xero" (if Xero connected + settlements exist)
  2. "Upload missing settlements" (if gaps detected)
  3. "Your books look great" (if everything complete)
- Each action links to the appropriate dashboard view
- "Go to Dashboard" marks wizard complete (`app_settings` key `onboarding_wizard_complete`) and closes

## Callback Page Changes

Each callback page gets a single-line change to its redirect target:

- **AmazonCallback** line 57: `navigate('/dashboard?connected=amazon', { replace: true })` (was `/admin?tab=settings`)
- **ShopifyCallback** line 49: `navigate('/dashboard?connected=shopify')` (was `/dashboard`)
- **XeroCallback** line 102: `navigate('/dashboard?connected=xero')` (was `/dashboard`)

## No Database Changes Required

- Reuses `app_settings` table with keys `onboarding_wizard_complete` and `onboarding_dismiss_count`
- All token tables, edge functions, and `marketplace_validation` already exist

