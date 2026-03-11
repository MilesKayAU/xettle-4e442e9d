

## Problem Analysis

After auditing the full onboarding flow, there are several gaps:

1. **No momentum after Xero connection** — The wizard jumps straight to Step 2 (Marketplaces) with a generic "Which marketplaces do you sell on?" No celebration, no "You're on a roll!" encouragement to keep connecting.

2. **Scanning step is cosmetic** — `SetupStepScanning` only calls `run-validation-sweep`. It does NOT call `scan-xero-history` (to find existing invoices and auto-detect marketplaces), `fetch-amazon-settlements`, or `fetch-shopify-payouts`. The animated checklist is fake — it never waits for real results.

3. **Dashboard lands cold** — After completing the wizard, the Dashboard tab shows `ActionCentre`, `ValidationSweep`, and `ChannelAlertsBanner` — none of which acknowledge the just-completed setup or show scanning progress. The user has no idea if their Xero data is being processed.

4. **No adaptive messaging per decision path** — Whether the user connects Xero only, Xero + Amazon, or skips everything, they all get the same generic flow. No tailored next-step suggestions.

5. **`hasXero` prop is stale** — After OAuth return, `xeroConnected` relies on a `xero_tokens` query that may not have completed before the wizard re-renders at Step 2.

---

## Plan

### 1. Add celebration + momentum to Step 2 after Xero connection

In `SetupStepConnectStores.tsx`, detect when the user just connected Xero (via a new `justConnectedXero` prop) and show a motivational header:

- **Header**: "Nice one — Xero is connected!" with a green checkmark
- **Subtext**: "Now let's connect your sales channels so Xettle can automatically pull your settlement data. The more you connect, the less manual work you'll have."
- Highlight Amazon and Shopify with benefit-driven copy: "Auto-fetch settlements every cycle — no more downloading CSVs"

### 2. Make the Scanning step actually scan

In `SetupStepScanning.tsx`:

- Call `scan-xero-history` (if Xero connected) — this already auto-detects marketplaces from invoice references
- Call `fetch-amazon-settlements` (if Amazon connected)
- Call `fetch-shopify-payouts` + `scan-shopify-channels` (if Shopify connected)
- Call `run-validation-sweep` last
- Track real completion via Promise resolution, not just timers
- Keep the animated checklist but tie checkmarks to actual API responses
- Fall back to timer-based advance if APIs take too long (30s safety net)

### 3. Add a post-setup dashboard banner

Create a new `PostSetupBanner` component shown on the Dashboard tab when `onboarding_wizard_complete` was just set (within last 5 minutes):

- If Xero connected: "Xettle is scanning your Xero history for existing marketplace invoices. This runs in the background — we'll surface what we find."
- If no marketplaces yet: "Upload your first settlement file to get started" with Upload CTA
- If marketplaces detected from Xero scan: "We found [N] marketplace(s) in your Xero history" with a list
- Auto-dismiss after data appears in `marketplace_validation`

### 4. Adaptive messaging per decision path

In `SetupStepResults.tsx`, tailor the results page based on what was connected:

| Path | Results message |
|------|----------------|
| Xero only | "Xettle is scanning your Xero for existing records. Upload a settlement file to get started." |
| Xero + Amazon | "Amazon settlements will sync automatically. We're scanning Xero for existing records." |
| Xero + Shopify | "Shopify payouts will sync automatically. We're scanning for sub-channels." |
| All three | "You're fully connected! Settlements will flow in automatically." |
| No connections | "Upload settlement CSVs manually — you can connect APIs anytime from Settings." |

### 5. Fix stale `hasXero` after OAuth return

In `Dashboard.tsx`, when `searchParams.get('connected') === 'xero'`:
- Immediately set `xeroConnected = true` before opening the wizard
- Pass this to `SetupWizard` so Step 1 shows "Xero Connected" state
- Add `justConnectedXero` prop to pass through to Step 2

---

### Files to modify

- `src/components/onboarding/SetupStepConnectStores.tsx` — Add celebration header
- `src/components/onboarding/SetupStepScanning.tsx` — Call real scan APIs
- `src/components/onboarding/SetupStepResults.tsx` — Adaptive messaging per path
- `src/components/onboarding/SetupWizard.tsx` — Pass connection context through
- `src/pages/Dashboard.tsx` — Fix stale `hasXero`, add post-setup banner
- `src/components/dashboard/PostSetupBanner.tsx` — New component for background scan status

