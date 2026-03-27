-- Fix the $20.19 in_transit payout validation row
UPDATE marketplace_validation 
SET overall_status = 'scheduled', reconciliation_status = 'pending'
WHERE settlement_id = '133394759927' 
AND user_id = '9d34d250-7de4-48e5-9566-11fa7a79852f';

-- Fix the settlement status to 'ingested' (not ready_to_push for in_transit)
UPDATE settlements 
SET status = 'ingested'
WHERE settlement_id = '133394759927' 
AND user_id = '9d34d250-7de4-48e5-9566-11fa7a79852f'
AND marketplace = 'shopify_payments'
AND payout_status = 'in_transit';