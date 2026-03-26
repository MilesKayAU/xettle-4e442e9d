/**
 * useAccountingBoundaryDate — Shared hook returning the accounting boundary date.
 * All settlement/validation queries should filter by this date.
 * Defaults to '2026-01-01' if not set.
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const DEFAULT_BOUNDARY = '2026-01-01';

export function useAccountingBoundaryDate() {
  const [boundaryDate, setBoundaryDate] = useState<string>(DEFAULT_BOUNDARY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'accounting_boundary_date')
          .maybeSingle();
        if (data?.value) setBoundaryDate(data.value);
      } catch {
        // use default
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { boundaryDate, loading };
}

/**
 * Non-hook version for use in standalone async functions.
 */
export async function getAccountingBoundaryDate(): Promise<string> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'accounting_boundary_date')
      .maybeSingle();
    return data?.value || DEFAULT_BOUNDARY;
  } catch {
    return DEFAULT_BOUNDARY;
  }
}
