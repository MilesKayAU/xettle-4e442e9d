

## Fire-and-Forget Background Scans — Remove the Scanning Step

### Problem
Currently: Xero (step 1) → Marketplaces (step 2) → Upload (step 3) → **Scan step with spinning circles** (step 4) → Results (step 5). The scan step blocks the user for 20-60 seconds watching progress bars. Since each API connection already knows what to scan, we can fire those scans immediately after connection and let the user keep flowing.

### New Flow
1. **Xero** — connect → fire `scan-xero-history` in background → immediately advance to step 2
2. **Shopify** — connect → fire `fetch-shopify-payouts` + `scan-shopify-channels` in background → advance to Amazon card
3. **Amazon** — connect → fire `fetch-amazon-settlements` in background → advance to CSV card
4. **CSV selection** → Continue
5. **Upload** (if needed) → Continue
6. **Results** — shows what's been found so far + "Your connected accounts are still syncing — results will appear within 5 minutes" if scans haven't completed

### Step Changes

**Remove step 4 (SetupStepScanning) entirely.** Reduce wizard from 5 steps to 4:
- Step 1: Connect Xero
- Step 2: Marketplaces (Shopify → Amazon → CSV)
- Step 3: Upload (if CSV selected)
- Step 4: Results

**`src/components/onboarding/SetupWizard.tsx`**
- Change `STEP_LABELS` from 5 to 4: `['Connect Xero', 'Marketplaces', 'Upload', 'Results']`
- Remove `SetupStepScanning` import and rendering
- Adjust step numbering: Upload = step 3, Results = step 4
- Track `backgroundScansRunning` state (count of in-flight scans)
- Pass `backgroundScansRunning > 0` to `SetupStepResults` as `scansInProgress`

**`src/components/onboarding/SetupStepConnectXero.tsx`**
- On successful Xero connection (when `hasXero` becomes true or on `onNext`), fire `scan-xero-history` + `run-validation-sweep` as fire-and-forget via a callback prop `onFireBackgroundScan`
- Call `onFireBackgroundScan('scan-xero-history')` then immediately call `onNext()`

**`src/components/onboarding/SetupStepConnectStores.tsx`**
- When Shopify connects (step 1 of inner flow), fire `fetch-shopify-payouts` + `scan-shopify-channels` via `onFireBackgroundScan` prop, then advance to Amazon card
- When Amazon connects (step 2), fire `fetch-amazon-settlements` via `onFireBackgroundScan`, then advance to CSV card
- Accept new prop `onFireBackgroundScan: (fnName: string) => void`

**`src/components/onboarding/SetupStepResults.tsx`**
- Accept `scansInProgress?: boolean` prop
- If `scansInProgress` is true, show a subtle banner: "Your connected accounts are still syncing — most complete within 5 minutes. Results will appear on your dashboard automatically."
- Auto-refresh the data query after 5 seconds if scans are in progress (one retry to catch fast completions)

**`src/components/onboarding/SetupWizard.tsx` — background scan orchestrator**
```typescript
const [pendingScans, setPendingScans] = useState(0);

const fireBackgroundScan = async (fnName: string) => {
  setPendingScans(p => p + 1);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    await fetch(`https://${projectId}.supabase.co/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),
    }).catch(() => {});
    // Also run validation sweep after each scan
    await fetch(`https://${projectId}.supabase.co/functions/v1/run-validation-sweep`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),
    }).catch(() => {});
  } finally {
    setPendingScans(p => p - 1);
  }
};
```

### Files to modify
- `src/components/onboarding/SetupWizard.tsx` — remove step 4, add background scan orchestrator, renumber steps
- `src/components/onboarding/SetupStepConnectXero.tsx` — accept + call `onFireBackgroundScan`
- `src/components/onboarding/SetupStepConnectStores.tsx` — accept + call `onFireBackgroundScan` on Shopify/Amazon connect
- `src/components/onboarding/SetupStepResults.tsx` — accept `scansInProgress`, show sync message, auto-retry query
- `src/components/onboarding/SetupStepScanning.tsx` — no longer imported (can be kept for future use but removed from wizard)

