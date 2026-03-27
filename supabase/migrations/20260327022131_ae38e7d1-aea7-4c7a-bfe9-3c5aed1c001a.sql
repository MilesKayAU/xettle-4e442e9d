DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlements_payout_status_check'
  ) THEN
    -- Use a trigger instead of CHECK for flexibility
    ALTER TABLE settlements
      ADD CONSTRAINT settlements_payout_status_check
      CHECK (payout_status IS NULL OR payout_status IN ('scheduled', 'in_transit', 'paid', 'failed', 'cancelled', 'open', 'closed'));
  END IF;
END $$;