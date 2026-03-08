-- Add 'starter' and 'pro' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'starter';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pro';

-- Create sync_history table for logging auto-fetch and Xero push events
CREATE TABLE public.sync_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL, -- 'amazon_fetch', 'xero_push', 'xero_auto_push'
  status text NOT NULL DEFAULT 'success', -- 'success', 'error', 'partial'
  details jsonb DEFAULT '{}'::jsonb,
  settlements_affected integer DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sync_history ENABLE ROW LEVEL SECURITY;

-- Users can read their own sync history
CREATE POLICY "Users can view their own sync history"
  ON public.sync_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own sync history (for client-side logging)
CREATE POLICY "Users can insert their own sync history"
  ON public.sync_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Add unique constraint on xero_tokens for upsert
-- (check if it already exists first — this may fail if already there)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'xero_tokens_user_id_tenant_id_key'
  ) THEN
    ALTER TABLE public.xero_tokens ADD CONSTRAINT xero_tokens_user_id_tenant_id_key UNIQUE (user_id, tenant_id);
  END IF;
END
$$;