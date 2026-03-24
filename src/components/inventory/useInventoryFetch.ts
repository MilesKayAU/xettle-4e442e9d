/**
 * Shared hook for fetching inventory from edge functions.
 * Handles loading, partial results, pagination, errors, and cache-first reads.
 * 
 * ISOLATION: This file must NOT import any settlement, validation, or Xero push logic.
 */
import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface FetchResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
  partial: boolean;
  error?: string;
}

interface CachedPlatformData {
  items: any[];
  has_more: boolean;
  partial: boolean;
  error: string | null;
  fetched_at: string;
}

interface UseInventoryFetchReturn<T> {
  data: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  partial: boolean;
  error: string | null;
  lastFetched: Date | null;
  fetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  loadFromCache: (cached: CachedPlatformData) => void;
}

export function useInventoryFetch<T = any>(functionName: string): UseInventoryFetchReturn<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const cursorRef = useRef<string | undefined>(undefined);

  const loadFromCache = useCallback((cached: CachedPlatformData) => {
    setData((cached.items || []) as T[]);
    setHasMore(cached.has_more || false);
    setPartial(cached.partial || false);
    setError(cached.error || null);
    setLastFetched(cached.fetched_at ? new Date(cached.fetched_at) : null);
    cursorRef.current = undefined;
  }, []);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPartial(false);
    cursorRef.current = undefined;

    try {
      const { data: resp, error: fnError } = await supabase.functions.invoke(functionName, {
        body: { limit: 500 },
      });

      if (fnError) {
        setError(fnError.message || 'Failed to fetch inventory');
        setData([]);
        return;
      }

      const result = resp as FetchResult<T>;
      setData(result.items || []);
      setHasMore(result.hasMore || false);
      setPartial(result.partial || false);
      cursorRef.current = result.nextCursor;
      if (result.error) setError(result.error);
      setLastFetched(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch inventory');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [functionName]);

  const loadMore = useCallback(async () => {
    if (!cursorRef.current || loadingMore) return;
    setLoadingMore(true);

    try {
      const { data: resp, error: fnError } = await supabase.functions.invoke(functionName, {
        body: { limit: 500, cursor: cursorRef.current },
      });

      if (fnError) {
        setError(fnError.message);
        return;
      }

      const result = resp as FetchResult<T>;
      setData(prev => [...prev, ...(result.items || [])]);
      setHasMore(result.hasMore || false);
      cursorRef.current = result.nextCursor;
      if (result.partial) setPartial(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [functionName, loadingMore]);

  return { data, loading, loadingMore, hasMore, partial, error, lastFetched, fetch, loadMore, loadFromCache };
}
