/**
 * useAiPageContext — Hook for pages to register their AI context.
 *
 * Usage:
 *   useAiPageContext(() => ({
 *     routeId: 'outstanding',
 *     pageTitle: 'Outstanding Invoices',
 *     primaryEntities: { xero_invoice_ids: invoiceIds },
 *     pageStateSummary: { total_invoices: 5, ready_to_push: 2 },
 *   }));
 *
 * The builder function is called on every render but context is only
 * updated when the JSON changes (deduped in the provider).
 * Pages must only provide data they already have loaded — no new queries.
 */

import { useEffect, useRef } from 'react';
import { type AiPageContext } from './aiContextContract';
import { useAiContext } from './AiContextProvider';

export function useAiPageContext(builder: () => AiPageContext) {
  const { setPageContext, clearPageContext } = useAiContext();
  const builderRef = useRef(builder);
  builderRef.current = builder;
  const prevJsonRef = useRef<string>('');

  useEffect(() => {
    const ctx = builderRef.current();
    const json = JSON.stringify(ctx);
    if (json !== prevJsonRef.current) {
      prevJsonRef.current = json;
      setPageContext(ctx);
    }

    return () => {
      clearPageContext();
    };
  }, [setPageContext, clearPageContext]);

  // Re-run when builder output changes
  useEffect(() => {
    const ctx = builder();
    const json = JSON.stringify(ctx);
    if (json !== prevJsonRef.current) {
      prevJsonRef.current = json;
      setPageContext(ctx);
    }
  });
}
