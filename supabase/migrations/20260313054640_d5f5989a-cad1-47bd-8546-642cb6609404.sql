
-- Add xero_invoice_id column to settlements for schema correctness
-- xero_journal_id currently stores Xero InvoiceIDs (not journal IDs) — this creates a proper column
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS xero_invoice_id text;

-- Backfill: copy xero_journal_id values where they represent invoice IDs
-- (xero_type is null or 'ACCREC'/'ACCPAY' = invoice/bill, not manual journal)
UPDATE public.settlements
SET xero_invoice_id = xero_journal_id
WHERE xero_journal_id IS NOT NULL
  AND (xero_type IS NULL OR xero_type IN ('ACCREC', 'ACCPAY'));
