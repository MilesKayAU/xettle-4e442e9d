

## Add Quick-Action Links to FBM Mismatch Dashboard Warnings

### Problem
When the dashboard detects FBM orders on an FBA-only account, it shows a text warning telling users to go to "Settings → Fulfilment Methods" — but there's no clickable action. Users have to manually navigate, find the right marketplace, switch mode, and then add postage costs. Too much friction.

### Change

**1. Add `action` callback to `SetupWarning` type**

File: `src/hooks/useDashboardTaskCounts.ts`

Extend the `SetupWarning` interface with an optional `actionLabel` and `actionTarget` field:
- `actionLabel?: string` — e.g. "Update now"
- `actionTarget?: string` — navigation target, e.g. `settings:fulfilment` or `settings`

Add these to the `fbm_mismatch_detected` and `postage_cost_missing` warnings.

**2. Make warnings clickable in `DailyTaskStrip`**

File: `src/components/dashboard/DailyTaskStrip.tsx`

Update `SetupWarningList` to accept `onNavigate` prop. When a warning has `actionTarget`, render an inline "Update now →" button that calls `onNavigate('settings', 'fulfilment')` to jump directly to the Fulfilment Methods tab in Settings.

**3. Add `fulfilment` sub-tab routing to Settings view**

File: `src/pages/Dashboard.tsx` (or wherever Settings view renders tabs)

Ensure that when `onNavigate('settings', 'fulfilment')` is called, the Settings page opens with the Fulfilment Methods panel visible/scrolled-to, so the user lands directly on the right card to configure FBM postage costs.

### Affected warnings that get quick-action links:
- `fbm_mismatch_detected:*` — "Update now" → opens Settings > Fulfilment Methods
- `postage_cost_missing` — "Set costs" → opens Settings > Fulfilment Methods
- `fulfilment_methods_incomplete` — "Configure" → opens Settings > Fulfilment Methods

### Technical Detail
- `SetupWarning` gains `actionLabel?: string` and `actionTarget?: string`
- `SetupWarningList` receives `onNavigate` from parent, renders action buttons
- No new components needed — just extending existing warning rendering with a clickable link

