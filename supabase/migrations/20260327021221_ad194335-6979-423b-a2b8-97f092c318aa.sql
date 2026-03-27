ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payout_status text DEFAULT 'paid';

COMMENT ON COLUMN settlements.payout_status IS 'Shopify payout lifecycle status: scheduled, in_transit, paid, failed, cancelled';