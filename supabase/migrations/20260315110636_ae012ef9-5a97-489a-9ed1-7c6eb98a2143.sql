UPDATE settlements s
SET status = 'already_recorded', sync_origin = 'external'
FROM xero_accounting_matches xam
WHERE xam.settlement_id = s.settlement_id
  AND xam.user_id = s.user_id
  AND xam.xero_status = 'PAID'
  AND s.status = 'ready_to_push';