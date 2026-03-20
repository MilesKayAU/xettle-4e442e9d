

## Problem

The "Failed to fetch dynamically imported module" error keeps crashing the dashboard. This is a Vite chunk-loading failure — the browser tries to load a JS module that's been invalidated (dev server restart, code change, or network hiccup) and gets a 404/network error. React's lazy loader throws, and the ErrorBoundary catches it with no recovery path.

## Solution

Add automatic retry with page reload for chunk-loading failures. Two changes:

### 1. Add a retry wrapper for lazy imports (`src/utils/lazy-with-retry.ts`)

Create a helper that wraps `React.lazy()` with retry logic:
- On import failure, check if the error message contains "dynamically imported module" or "Loading chunk"
- If so, do a hard page reload (once — use sessionStorage flag to prevent infinite loops)
- If it's already been retried, let the error propagate normally

### 2. Update `src/App.tsx` to use the retry wrapper

Replace all `lazy(() => import(...))` calls with the new `lazyWithRetry(() => import(...))` wrapper. No other changes needed — the existing Suspense fallback handles the loading state.

### Technical Details

**`src/utils/lazy-with-retry.ts`**:
```typescript
import { lazy, ComponentType } from 'react';

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((err) => {
      const isChunkError =
        err?.message?.includes('dynamically imported module') ||
        err?.message?.includes('Loading chunk');

      if (isChunkError) {
        const key = 'chunk_reload_retry';
        const hasRetried = sessionStorage.getItem(key);
        if (!hasRetried) {
          sessionStorage.setItem(key, '1');
          window.location.reload();
          return new Promise(() => {}); // never resolves — page is reloading
        }
        sessionStorage.removeItem(key);
      }
      throw err;
    })
  );
}
```

**`src/App.tsx`**: Replace `lazy()` with `lazyWithRetry()` for all 16 page imports. No other changes.

This eliminates the crash screen for transient chunk failures by silently reloading once.

