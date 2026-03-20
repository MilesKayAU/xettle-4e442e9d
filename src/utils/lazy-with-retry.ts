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
        try {
          const key = 'chunk_reload_retry';
          const hasRetried = sessionStorage.getItem(key);
          if (!hasRetried) {
            sessionStorage.setItem(key, '1');
            window.location.reload();
            return new Promise(() => {}); // never resolves — page is reloading
          }
          sessionStorage.removeItem(key);
        } catch {
          // sessionStorage unavailable — fall through
        }
      }
      throw err;
    })
  );
}
