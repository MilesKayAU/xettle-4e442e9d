-- G1 FIX: Sync settlements.status to match mv.overall_status for 5 drifted rows

-- kogan_357889: mv=ready_to_push but settlement=saved
UPDATE settlements SET status = 'ready_to_push', updated_at = now()
WHERE settlement_id = 'kogan_357889' AND status = 'saved';

-- shopify_auto_everyday_market: mv=reconciliation_only but settlement=duplicate_suppressed
UPDATE settlements SET status = 'reconciliation_only', updated_at = now()
WHERE settlement_id = 'shopify_auto_everyday_market_2026-03_9d34d250' AND status = 'duplicate_suppressed';

-- shopify_auto_ebay: mv=reconciliation_only but settlement=duplicate_suppressed
UPDATE settlements SET status = 'reconciliation_only', updated_at = now()
WHERE settlement_id = 'shopify_auto_ebay_2026-01_9d34d250' AND status = 'duplicate_suppressed';

-- BUN-2301-2026-01-14: mv=already_recorded but settlement=saved
UPDATE settlements SET status = 'already_recorded', updated_at = now()
WHERE settlement_id = 'BUN-2301-2026-01-14' AND status = 'saved';

-- BUN-2301-2025-12-27: mv=already_recorded but settlement=duplicate_suppressed
UPDATE settlements SET status = 'already_recorded', updated_at = now()
WHERE settlement_id = 'BUN-2301-2025-12-27' AND status = 'duplicate_suppressed';

-- G2 FIX: Create MV row for orphan kogan_360140
INSERT INTO marketplace_validation (user_id, settlement_id, marketplace_code, period_label, period_start, period_end, overall_status, settlement_uploaded, settlement_net, reconciliation_difference, settlement_source)
SELECT user_id, settlement_id, marketplace, TO_CHAR(period_end::date, 'Mon YYYY'), period_start, period_end, 'ready_to_push', true, bank_deposit, 0, source
FROM settlements WHERE settlement_id = 'kogan_360140'
ON CONFLICT DO NOTHING;