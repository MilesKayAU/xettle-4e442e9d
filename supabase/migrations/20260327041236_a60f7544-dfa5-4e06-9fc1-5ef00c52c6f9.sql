
DELETE FROM marketplace_validation 
WHERE settlement_id = '290145_EverydayMarket';

DELETE FROM settlement_lines
WHERE settlement_id = '290145_EverydayMarket';

DELETE FROM settlements
WHERE settlement_id = '290145_EverydayMarket'
AND status NOT IN ('pushed_to_xero', 'already_recorded');
