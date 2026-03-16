/**
 * AiContextProvider — Sitewide provider for AI page context.
 *
 * Mounted inside AuthenticatedLayout. Pages register context via useAiPageContext().
 * AskAiButton reads the context from this provider — no prop drilling.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { type AiPageContext, EMPTY_CONTEXT, sanitizeContext } from './aiContextContract';

interface AiContextValue {
  /** Current sanitized page context */
  context: AiPageContext;
  /** Register/update page context — called by useAiPageContext */
  setPageContext: (ctx: AiPageContext) => void;
  /** Clear context (e.g., on unmount) */
  clearPageContext: () => void;
}

const AiContext = createContext<AiContextValue>({
  context: EMPTY_CONTEXT,
  setPageContext: () => {},
  clearPageContext: () => {},
});

export function useAiContext() {
  return useContext(AiContext);
}

export function AiContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<AiPageContext>(EMPTY_CONTEXT);
  const lastJson = useRef('');

  const setPageContext = useCallback((ctx: AiPageContext) => {
    const sanitized = sanitizeContext(ctx);
    const json = JSON.stringify(sanitized);
    // Avoid unnecessary re-renders
    if (json !== lastJson.current) {
      lastJson.current = json;
      setContext(sanitized);
    }
  }, []);

  const clearPageContext = useCallback(() => {
    lastJson.current = '';
    setContext(EMPTY_CONTEXT);
  }, []);

  return (
    <AiContext.Provider value={{ context, setPageContext, clearPageContext }}>
      {children}
    </AiContext.Provider>
  );
}
