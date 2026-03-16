
-- ═══════════════════════════════════════════════════════════════════
-- Migration: Add partial unique index on xero_accounting_matches
-- Constraint: One xero_invoice_id per user (when not NULL)
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Log existing duplicates to system_events before cleanup
INSERT INTO public.system_events (user_id, event_type, severity, details)
SELECT 
  dupes.user_id,
  'duplicate_invoice_link_fixed',
  'warning',
  jsonb_build_object(
    'xero_invoice_id', dupes.xero_invoice_id,
    'duplicate_count', dupes.cnt,
    'kept_row_id', dupes.kept_id,
    'removed_row_ids', dupes.removed_ids,
    'cleanup_reason', 'Adding partial unique index ux_xam_user_invoice'
  )
FROM (
  SELECT
    m.user_id,
    m.xero_invoice_id,
    COUNT(*) AS cnt,
    (ARRAY_AGG(m.id ORDER BY m.confidence DESC NULLS LAST, m.created_at DESC))[1] AS kept_id,
    ARRAY_REMOVE(
      ARRAY_AGG(m.id ORDER BY m.confidence DESC NULLS LAST, m.created_at DESC),
      (ARRAY_AGG(m.id ORDER BY m.confidence DESC NULLS LAST, m.created_at DESC))[1]
    ) AS removed_ids
  FROM public.xero_accounting_matches m
  WHERE m.xero_invoice_id IS NOT NULL
  GROUP BY m.user_id, m.xero_invoice_id
  HAVING COUNT(*) > 1
) dupes;

-- Step 2: Clear xero_invoice_id on duplicate rows (keep best row intact)
UPDATE public.xero_accounting_matches
SET xero_invoice_id = NULL,
    notes = COALESCE(notes, '') || ' [deduped: xero_invoice_id cleared by migration — original invoice linked to another settlement row]'
WHERE id IN (
  SELECT unnest(removed_ids) FROM (
    SELECT
      ARRAY_REMOVE(
        ARRAY_AGG(m.id ORDER BY m.confidence DESC NULLS LAST, m.created_at DESC),
        (ARRAY_AGG(m.id ORDER BY m.confidence DESC NULLS LAST, m.created_at DESC))[1]
      ) AS removed_ids
    FROM public.xero_accounting_matches m
    WHERE m.xero_invoice_id IS NOT NULL
    GROUP BY m.user_id, m.xero_invoice_id
    HAVING COUNT(*) > 1
  ) dupes
);

-- Step 3: Create partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS ux_xam_user_invoice
ON public.xero_accounting_matches (user_id, xero_invoice_id)
WHERE xero_invoice_id IS NOT NULL;
