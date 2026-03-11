
-- Clean up duplicate marketplace_connections (keep oldest)
DELETE FROM marketplace_connections a
USING marketplace_connections b
WHERE a.id > b.id
AND a.user_id = b.user_id
AND a.marketplace_code = b.marketplace_code;

-- Add unique constraint so upsert works correctly
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_connections_user_marketplace_unique 
ON marketplace_connections (user_id, marketplace_code);
