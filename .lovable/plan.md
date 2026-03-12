

## Problem

The Setup scanning UI shows raw technical error messages to users (e.g., "fetch-amazon-settlements timed out") with a warning icon. This is alarming and unhelpful — users can't fix API timeouts.

## Root Cause

Two locations create this:

1. **`src/utils/sync-capabilities.ts` line 124**: Timeout errors return `{ ok: false, error: "fetch-amazon-settlements timed out" }` — raw function name exposed.
2. **`src/components/onboarding/SetupStepScanning.tsx` lines 120-122 and 237-239**: Errors are displayed with an amber `AlertTriangle` icon and the raw error message text.

## Plan

### Change 1: Make timeouts and non-critical failures show as "soft success" in the scanning UI

In `SetupStepScanning.tsx`, change the error handling for edge function calls (lines 120-122) to treat timeouts and non-fatal errors as silent "success with background retry" instead of visible errors:

```tsx
// Instead of:
} else {
  updateStep(i, 'error', result.error || 'Failed');
}

// Change to:
} else {
  // Non-critical: show as success with background note, not scary error
  // These will retry automatically via scheduled-sync
  console.warn(`[setup-scan] ${step.fn} non-critical issue:`, result.error);
  updateStep(i, 'success');
}
```

This means ALL scan steps in the onboarding wizard show as either success, skipped, or pending — never error. The scheduled-sync cron will automatically retry anything that failed.

### Change 2: Remove the error message display entirely from the step list

Remove lines 237-239 that render the amber error text under step labels. Since we no longer set 'error' status during scanning, this is cleanup but also a safety net.

### Change 3: Clean up the error return messages in `callEdgeFunctionSafe`

In `sync-capabilities.ts`, make error messages human-friendly (for any other callers):
- Line 108: `"${name} failed (${res.status})"` → `"Temporarily unavailable"`
- Line 124: `"${name} timed out"` → `"Taking longer than expected — will retry automatically"`

### Result
- Users see all green checkmarks during setup
- Failures are logged to console for debugging
- Background sync picks up anything that failed
- No raw function names or status codes shown to users

