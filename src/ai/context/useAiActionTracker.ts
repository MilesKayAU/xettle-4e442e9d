/**
 * useAiActionTracker — Hook to record user actions for AI context.
 *
 * Usage:
 *   const trackAction = useAiActionTracker();
 *   trackAction('pushed_to_xero', 'settlement AMZ-2025-03');
 *
 * Actions are stored in AiContextProvider and surfaced to the assistant
 * as a short timeline (last 10 events). No PII is stored.
 */

import { useCallback } from 'react';
import { useAiContext } from './AiContextProvider';

export function useAiActionTracker() {
  const { recordAction } = useAiContext();

  return useCallback(
    (action: string, detail?: string) => {
      recordAction(action, detail);
    },
    [recordAction],
  );
}
