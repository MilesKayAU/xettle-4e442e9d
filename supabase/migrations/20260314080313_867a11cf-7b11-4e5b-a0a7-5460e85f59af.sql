
-- Rail posting settings (user-scoped, per-rail auto-post config)
CREATE TABLE public.rail_posting_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  rail TEXT NOT NULL,
  posting_mode TEXT NOT NULL DEFAULT 'manual',
  require_bank_match BOOLEAN NOT NULL DEFAULT true,
  auto_post_enabled_at TIMESTAMPTZ,
  auto_post_enabled_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, rail)
);

ALTER TABLE public.rail_posting_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own rail posting settings"
  ON public.rail_posting_settings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add posting_state and posting_error to settlements
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS posting_state TEXT,
  ADD COLUMN IF NOT EXISTS posting_error TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

-- Enable realtime for rail_posting_settings
ALTER PUBLICATION supabase_realtime ADD TABLE public.rail_posting_settings;
