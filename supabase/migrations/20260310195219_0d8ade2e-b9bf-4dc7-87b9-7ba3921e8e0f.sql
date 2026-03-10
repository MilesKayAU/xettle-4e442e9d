ALTER TABLE marketplace_file_fingerprints
ADD COLUMN IF NOT EXISTS reconciliation_type text DEFAULT 'unknown';

-- Seed known values for existing fingerprints
UPDATE marketplace_file_fingerprints
SET reconciliation_type = 'csv_only'
WHERE marketplace_code IN ('bigw', 'everyday_market', 'mydeal', 'bunnings', 'catch', 'kogan', 'woolworths', 'woolworths_marketplus');

UPDATE marketplace_file_fingerprints
SET reconciliation_type = 'api_sync'
WHERE marketplace_code IN ('amazon_au', 'shopify_payments');