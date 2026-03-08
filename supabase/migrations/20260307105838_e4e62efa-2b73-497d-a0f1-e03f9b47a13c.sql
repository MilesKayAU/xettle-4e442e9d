-- One-time cleanup: delete all test settlement data so user can re-upload cleanly
DELETE FROM public.settlement_unmapped;
DELETE FROM public.settlement_lines;
DELETE FROM public.settlements;