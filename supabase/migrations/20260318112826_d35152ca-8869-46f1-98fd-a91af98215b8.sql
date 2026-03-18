-- Delete garbage Kogan settlements from March 15 batch
-- All 8 records have period_start = period_end = '2026-03-15' (upload date fallback)
-- None have been pushed to Xero (xero_invoice_id IS NULL for all)

-- First clean up related tables
DELETE FROM public.settlement_lines 
WHERE user_id IN (
  SELECT user_id FROM public.settlements 
  WHERE marketplace = 'kogan' 
    AND created_at >= '2026-03-15T21:00:00Z' 
    AND created_at <= '2026-03-15T22:00:00Z'
    AND period_start = '2026-03-15' 
    AND period_end = '2026-03-15'
)
AND settlement_id IN (
  SELECT settlement_id FROM public.settlements 
  WHERE marketplace = 'kogan' 
    AND created_at >= '2026-03-15T21:00:00Z' 
    AND created_at <= '2026-03-15T22:00:00Z'
    AND period_start = '2026-03-15' 
    AND period_end = '2026-03-15'
);

DELETE FROM public.settlement_unmapped 
WHERE user_id IN (
  SELECT user_id FROM public.settlements 
  WHERE marketplace = 'kogan' 
    AND created_at >= '2026-03-15T21:00:00Z' 
    AND created_at <= '2026-03-15T22:00:00Z'
    AND period_start = '2026-03-15' 
    AND period_end = '2026-03-15'
)
AND settlement_id IN (
  SELECT settlement_id FROM public.settlements 
  WHERE marketplace = 'kogan' 
    AND created_at >= '2026-03-15T21:00:00Z' 
    AND created_at <= '2026-03-15T22:00:00Z'
    AND period_start = '2026-03-15' 
    AND period_end = '2026-03-15'
);

DELETE FROM public.settlement_id_aliases
WHERE user_id IN (
  SELECT user_id FROM public.settlements 
  WHERE marketplace = 'kogan' 
    AND created_at >= '2026-03-15T21:00:00Z' 
    AND created_at <= '2026-03-15T22:00:00Z'
    AND period_start = '2026-03-15' 
    AND period_end = '2026-03-15'
)
AND canonical_settlement_id IN (
  SELECT settlement_id FROM public.settlements 
  WHERE marketplace = 'kogan' 
    AND created_at >= '2026-03-15T21:00:00Z' 
    AND created_at <= '2026-03-15T22:00:00Z'
    AND period_start = '2026-03-15' 
    AND period_end = '2026-03-15'
);

-- Now delete the settlements themselves
DELETE FROM public.settlements 
WHERE marketplace = 'kogan' 
  AND created_at >= '2026-03-15T21:00:00Z' 
  AND created_at <= '2026-03-15T22:00:00Z'
  AND period_start = '2026-03-15' 
  AND period_end = '2026-03-15';
