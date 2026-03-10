-- Bug 1 fix: Delete fabricated reconciliation checks for shopify_payments
-- These compared settlement_net against unfiltered settlement_lines from ALL marketplaces
-- producing fake "gap" figures. They should only be regenerated when proper bank verification exists.
DELETE FROM reconciliation_checks 
WHERE marketplace_code = 'shopify_payments';