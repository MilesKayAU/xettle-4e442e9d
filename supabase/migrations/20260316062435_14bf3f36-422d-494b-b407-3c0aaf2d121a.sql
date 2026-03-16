-- Delete duplicate marketplace_validation rows where ebay_au already has the same period
DELETE FROM marketplace_validation 
WHERE marketplace_code = 'ebay' 
AND (user_id, period_label) IN (
  SELECT user_id, period_label FROM marketplace_validation WHERE marketplace_code = 'ebay_au'
);

-- Now migrate remaining ebay validation records to ebay_au
UPDATE marketplace_validation SET marketplace_code = 'ebay_au' WHERE marketplace_code = 'ebay';

-- Migrate settlements
UPDATE settlements SET marketplace = 'ebay_au' WHERE marketplace = 'ebay';

-- Delete the orphan marketplace_connection
DELETE FROM marketplace_connections WHERE marketplace_code = 'ebay';

-- Clean up all other tables
UPDATE marketplace_account_mapping SET marketplace_code = 'ebay_au' WHERE marketplace_code = 'ebay';
UPDATE marketplace_fee_alerts SET marketplace_code = 'ebay_au' WHERE marketplace_code = 'ebay';
UPDATE marketplace_fee_observations SET marketplace_code = 'ebay_au' WHERE marketplace_code = 'ebay';
UPDATE reconciliation_checks SET marketplace_code = 'ebay_au' WHERE marketplace_code = 'ebay';
UPDATE channel_alerts SET source_name = 'ebay_au' WHERE source_name = 'ebay';
UPDATE settlement_components SET marketplace_code = 'ebay_au' WHERE marketplace_code = 'ebay';