/**
 * useReconciliation — Shared hook for inline reconciliation checks per settlement.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import { useState, useCallback } from 'react';
import { runUniversalReconciliation, type UniversalReconciliationResult } from '@/utils/universal-reconciliation';
import type { StandardSettlement } from '@/utils/settlement-engine';

interface UseReconciliationOptions {
  toStandardSettlement: (settlement: any) => StandardSettlement;
}

export function useReconciliation({ toStandardSettlement }: UseReconciliationOptions) {
  const [reconResults, setReconResults] = useState<Record<string, UniversalReconciliationResult>>({});
  const [expandedRecon, setExpandedRecon] = useState<string | null>(null);

  const toggleReconCheck = useCallback((settlement: any) => {
    const sid = settlement.settlement_id;
    if (expandedRecon === sid) {
      setExpandedRecon(null);
      return;
    }
    if (!reconResults[sid]) {
      const stdSettlement = toStandardSettlement(settlement);
      const result = runUniversalReconciliation(stdSettlement);
      setReconResults(prev => ({ ...prev, [sid]: result }));
    }
    setExpandedRecon(sid);
  }, [expandedRecon, reconResults, toStandardSettlement]);

  return {
    reconResults,
    expandedRecon,
    toggleReconCheck,
  };
}
