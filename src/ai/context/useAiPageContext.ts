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

  useEffect(() => {
    const ctx = builderRef.current();
    setPageContext(ctx);

    return () => {
      clearPageContext();
    };
  }, [setPageContext, clearPageContext]);

  // Re-run when builder changes (deps change in calling component)
  useEffect(() => {
    const ctx = builder();
    setPageContext(ctx);
  });
}
