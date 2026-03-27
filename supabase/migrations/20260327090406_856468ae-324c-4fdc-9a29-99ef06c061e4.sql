UPDATE marketplace_validation 
SET reconciliation_difference = 0, reconciliation_status = 'matched'
WHERE settlement_id = '290145_EverydayMarket';

UPDATE settlements 
SET reconciliation_status = 'matched'
WHERE settlement_id = '290145_EverydayMarket';