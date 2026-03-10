-- Bug 2 fix: Update Shopify Payments Feb 2026 validation row to correct status
UPDATE marketplace_validation 
SET overall_status = 'ready_to_push',
    updated_at = now()
WHERE id = '8cba7ec1-1f1a-4ae9-b26e-c33fd2ba18ed'
AND overall_status = 'settlement_needed'
AND settlement_uploaded = true;