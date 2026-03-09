-- Clean up test Shopify & Bunnings settlements and connections
DELETE FROM settlement_lines WHERE settlement_id IN (SELECT settlement_id FROM settlements WHERE marketplace IN ('shopify_payments', 'bunnings'));
DELETE FROM settlement_unmapped WHERE settlement_id IN (SELECT settlement_id FROM settlements WHERE marketplace IN ('shopify_payments', 'bunnings'));
DELETE FROM settlements WHERE marketplace IN ('shopify_payments', 'bunnings');
DELETE FROM marketplace_connections WHERE marketplace_code IN ('shopify_payments', 'bunnings');