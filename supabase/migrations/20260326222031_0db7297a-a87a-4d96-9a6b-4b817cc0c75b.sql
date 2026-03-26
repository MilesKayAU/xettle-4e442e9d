-- G1+G5 FIX: shopify_auto_everyday_market MV row should be reconciliation_only (settlement is duplicate_suppressed)
UPDATE marketplace_validation 
SET overall_status = 'reconciliation_only', updated_at = now()
WHERE settlement_id = 'shopify_auto_everyday_market_2026-03_9d34d250';

-- G5 FIX: shopify_auto_ebay MV row should be reconciliation_only
UPDATE marketplace_validation 
SET overall_status = 'reconciliation_only', updated_at = now()
WHERE settlement_id = 'shopify_auto_ebay_2026-01_9d34d250';

-- G2 FIX: Create MV rows for orphan settlements
-- kogan_348218 (already_recorded)
INSERT INTO marketplace_validation (user_id, settlement_id, marketplace_code, period_label, period_start, period_end, overall_status, settlement_uploaded, settlement_net)
SELECT user_id, settlement_id, marketplace, TO_CHAR(period_end, 'Mon YYYY'), period_start, period_end, 'already_recorded', true, bank_deposit
FROM settlements WHERE settlement_id = 'kogan_348218'
ON CONFLICT DO NOTHING;

-- kogan_268477 (already_recorded)
INSERT INTO marketplace_validation (user_id, settlement_id, marketplace_code, period_label, period_start, period_end, overall_status, settlement_uploaded, settlement_net)
SELECT user_id, settlement_id, marketplace, TO_CHAR(period_end, 'Mon YYYY'), period_start, period_end, 'already_recorded', true, bank_deposit
FROM settlements WHERE settlement_id = 'kogan_268477'
ON CONFLICT DO NOTHING;

-- shopify_auto_bigw (reconciliation_only)
INSERT INTO marketplace_validation (user_id, settlement_id, marketplace_code, period_label, period_start, period_end, overall_status, settlement_uploaded, settlement_net)
SELECT user_id, settlement_id, marketplace, TO_CHAR(period_end, 'Mon YYYY'), period_start, period_end, 'reconciliation_only', true, bank_deposit
FROM settlements WHERE settlement_id = 'shopify_auto_bigw_2026-03_9d34d250'
ON CONFLICT DO NOTHING;