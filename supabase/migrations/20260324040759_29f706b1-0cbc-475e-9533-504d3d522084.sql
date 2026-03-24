-- Clean up orphaned validation rows for shopify_auto settlements
-- where the period_label doesn't match the current settlement boundaries
DELETE FROM public.marketplace_validation mv
WHERE mv.settlement_id LIKE 'shopify_auto_%'
  AND NOT EXISTS (
    SELECT 1 FROM public.settlements s
    WHERE s.settlement_id = mv.settlement_id
      AND s.user_id = mv.user_id
      AND mv.period_label = (s.period_start || ' → ' || s.period_end)
  );