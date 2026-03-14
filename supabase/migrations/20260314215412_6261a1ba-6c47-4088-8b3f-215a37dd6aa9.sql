-- Add index on posting_state for auto-post batch queries
CREATE INDEX IF NOT EXISTS idx_settlements_posting_state ON public.settlements (posting_state)
WHERE posting_state IS NOT NULL;

-- Add partial index for the common auto-post query pattern
CREATE INDEX IF NOT EXISTS idx_settlements_auto_post_ready ON public.settlements (user_id, marketplace, status)
WHERE status = 'ready_to_push' AND is_hidden = false AND is_pre_boundary = false AND duplicate_of_settlement_id IS NULL;

-- Add comment documenting org-scope intent on rail_posting_settings
COMMENT ON TABLE public.rail_posting_settings IS 'Org-scoped rail posting configuration. user_id acts as org proxy (1 user = 1 org). Will migrate to org_id when multi-user orgs are introduced.';
COMMENT ON COLUMN public.rail_posting_settings.user_id IS 'Acts as org_id proxy. All users in the same org share these settings.';