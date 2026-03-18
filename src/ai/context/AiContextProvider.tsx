/**
 * AiContextProvider — Sitewide provider for AI page context.
 *
 * Mounted inside AuthenticatedLayout. Pages register context via useAiPageContext().
 * AskAiButton reads the context from this provider — no prop drilling.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { type AiPageContext, type AiUserAction, EMPTY_CONTEXT, sanitizeContext } from './aiContextContract';

const MAX_ACTION_HISTORY = 10;

interface AiContextValue {
  /** Current sanitized page context */
  context: AiPageContext;
  /** Register/update page context — called by useAiPageContext */
  setPageContext: (ctx: AiPageContext) => void;
  /** Clear context (e.g., on unmount) */
  clearPageContext: () => void;
  /** Record a user action into the timeline */
  recordAction: (action: string, detail?: string) => void;
  /** Current action history (for reading) */
  actionHistory: AiUserAction[];
}

const AiContext = createContext<AiContextValue>({
  context: EMPTY_CONTEXT,
  setPageContext: () => {},
  clearPageContext: () => {},
  recordAction: () => {},
  actionHistory: [],
});

export function useAiContext() {
  return useContext(AiContext);
}

export function AiContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<AiPageContext>(EMPTY_CONTEXT);
  const [actionHistory, setActionHistory] = useState<AiUserAction[]>([]);
  const lastJson = useRef('');

  const setPageContext = useCallback((ctx: AiPageContext) => {
    // Merge current action history into context before sanitizing
    setActionHistory(prev => {
      const merged = { ...ctx, recentActions: prev };
      const sanitized = sanitizeContext(merged);
      const json = JSON.stringify(sanitized);
      if (json !== lastJson.current) {
        lastJson.current = json;
        setContext(sanitized);
      }
      return prev;
    });
  }, []);

  const clearPageContext = useCallback(() => {
    lastJson.current = '';
    setContext(EMPTY_CONTEXT);
  }, []);

  const recordAction = useCallback((action: string, detail?: string) => {
    const entry: AiUserAction = {
      action,
      ts: new Date().toISOString(),
      detail: detail?.slice(0, 120),
    };
    setActionHistory(prev => {
      const next = [entry, ...prev].slice(0, MAX_ACTION_HISTORY);
      // Also update the current context with the new action
      setContext(current => {
        const updated = { ...current, recentActions: next };
        const sanitized = sanitizeContext(updated);
        lastJson.current = JSON.stringify(sanitized);
        return sanitized;
      });
      return next;
    });
  }, []);

  return (
    <AiContext.Provider value={{ context, setPageContext, clearPageContext, recordAction, actionHistory }}>
      {children}
    </AiContext.Provider>
  );
}
