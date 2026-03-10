

# Fix: Accounting Boundary shows "Connect Xero first" despite Xero being connected

## Problem
In `Dashboard.tsx` line 375, `xeroConnected` is **hardcoded to `false`**:
```tsx
<AccountingBoundarySettings
  xeroConnected={false}  // ← BUG
```

This means the boundary setup always shows "Connect Xero first" regardless of actual Xero connection status.

## Fix

**File: `src/pages/Dashboard.tsx`**

1. Add a `xeroConnected` state variable that queries `xero_tokens` on mount (same pattern used by `ConnectionStatusBar.tsx`)
2. Pass the real value to `AccountingBoundarySettings`

```tsx
// Add state
const [xeroConnected, setXeroConnected] = useState(false);

// Check on mount
useEffect(() => {
  supabase.from('xero_tokens').select('id').limit(1)
    .then(({ data }) => setXeroConnected(!!(data && data.length > 0)));
}, []);

// Pass real value
<AccountingBoundarySettings
  xeroConnected={xeroConnected}
  ...
/>
```

This is a one-file fix. Once corrected, clicking "Re-scan Xero" will trigger the actual `scan-xero-history` edge function and return real detected settlements from the connected Xero account (MILES KAY AUSTRALIA).

