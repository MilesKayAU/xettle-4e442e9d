UPDATE public.marketplace_validation
SET updated_at = now()
WHERE overall_status = 'ready_to_push' AND COALESCE(settlement_net, 0) = 0