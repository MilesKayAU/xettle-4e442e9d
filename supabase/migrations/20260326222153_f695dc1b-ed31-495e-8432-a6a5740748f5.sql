-- Remove stale alias that incorrectly maps kogan_357889 → kogan_360140
-- These are DIFFERENT settlements with different AP Invoice numbers
DELETE FROM settlement_id_aliases 
WHERE alias_id = 'kogan_357889' 
AND canonical_settlement_id = 'kogan_360140';