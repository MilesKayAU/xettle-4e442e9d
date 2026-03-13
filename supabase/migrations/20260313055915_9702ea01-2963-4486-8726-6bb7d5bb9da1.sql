
-- Add JSONB column for unified Xero entry tracking
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS xero_entries jsonb DEFAULT '[]'::jsonb;

-- Backfill from existing columns
UPDATE public.settlements
SET xero_entries = (
  CASE
    -- Split-month: both journal_id_1 and journal_id_2
    WHEN xero_journal_id_1 IS NOT NULL AND xero_journal_id_2 IS NOT NULL THEN
      jsonb_build_array(
        jsonb_build_object('type', COALESCE(xero_type, 'journal'), 'id', xero_journal_id_1, 'month', 1),
        jsonb_build_object('type', COALESCE(xero_type, 'journal'), 'id', xero_journal_id_2, 'month', 2)
      )
    -- Split-month: only journal_id_1
    WHEN xero_journal_id_1 IS NOT NULL THEN
      jsonb_build_array(
        jsonb_build_object('type', COALESCE(xero_type, 'journal'), 'id', xero_journal_id_1, 'month', 1)
      )
    -- Single entry via xero_journal_id or xero_invoice_id
    WHEN xero_journal_id IS NOT NULL OR xero_invoice_id IS NOT NULL THEN
      jsonb_build_array(
        jsonb_build_object('type', COALESCE(xero_type, 'journal'), 'id', COALESCE(xero_invoice_id, xero_journal_id))
      )
    ELSE '[]'::jsonb
  END
)
WHERE xero_journal_id IS NOT NULL 
   OR xero_journal_id_1 IS NOT NULL 
   OR xero_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.settlements.xero_entries IS 'Unified JSONB array of Xero entries. Each element: {"type": "ACCREC"|"journal"|..., "id": "xero-id", "month": 1|2 (optional, for split-month)}. Replaces xero_journal_id, xero_journal_id_1, xero_journal_id_2, xero_invoice_id.';
