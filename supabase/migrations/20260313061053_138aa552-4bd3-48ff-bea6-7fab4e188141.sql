
-- ═══════════════════════════════════════════════════════════════
-- Settlement State Machine Migration
-- Adds metadata columns and migrates status values to canonical states
-- ═══════════════════════════════════════════════════════════════

-- 1. Add new columns
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pre_boundary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_settlement_id text NULL,
  ADD COLUMN IF NOT EXISTS duplicate_reason text NULL,
  ADD COLUMN IF NOT EXISTS sync_origin text NOT NULL DEFAULT 'xettle';

-- 2. Migrate: already_recorded → ingested + is_pre_boundary
UPDATE public.settlements
SET status = 'ingested', is_pre_boundary = true
WHERE status = 'already_recorded';

-- 3. Migrate: synced_external → keep workflow state + sync_origin
UPDATE public.settlements
SET sync_origin = 'external',
    status = CASE
      WHEN xero_journal_id IS NOT NULL OR xero_invoice_id IS NOT NULL THEN 'pushed_to_xero'
      ELSE 'ingested'
    END
WHERE status = 'synced_external' OR status = 'synced';

-- 4. Migrate: saved/parsed/processing → ingested
UPDATE public.settlements
SET status = 'ingested'
WHERE status IN ('saved', 'parsed', 'processing');

-- 5. Migrate: ready_to_push stays as-is (canonical)

-- 6. Migrate: draft_in_xero / authorised_in_xero → pushed_to_xero
UPDATE public.settlements
SET status = 'pushed_to_xero'
WHERE status IN ('draft_in_xero', 'authorised_in_xero', 'pushed_to_xero');

-- 7. Migrate: reconciled_in_xero stays as-is (canonical)

-- 8. Migrate: bank_verified / deposit_matched / verified_payout → bank_verified
UPDATE public.settlements
SET status = 'bank_verified'
WHERE status IN ('deposit_matched', 'verified_payout');

-- 9. Migrate: duplicate_suppressed → ingested + duplicate metadata
UPDATE public.settlements
SET status = 'ingested',
    duplicate_reason = 'legacy_suppressed'
WHERE status = 'duplicate_suppressed';

-- 10. Migrate: hidden → ingested + is_hidden
UPDATE public.settlements
SET status = 'ingested', is_hidden = true
WHERE status = 'hidden';

-- 11. Add comments
COMMENT ON COLUMN public.settlements.is_hidden IS 'UI flag: user has hidden this settlement from views. Does not affect workflow status.';
COMMENT ON COLUMN public.settlements.is_pre_boundary IS 'True if settlement falls before the accounting boundary date. Excluded from push logic.';
COMMENT ON COLUMN public.settlements.duplicate_of_settlement_id IS 'If set, this settlement is a duplicate of the referenced settlement_id.';
COMMENT ON COLUMN public.settlements.duplicate_reason IS 'Reason for duplicate detection: fingerprint_match, amount_match, legacy_suppressed, etc.';
COMMENT ON COLUMN public.settlements.sync_origin IS 'Where the Xero entry originated: xettle (pushed by us) or external (pre-existing in Xero).';
