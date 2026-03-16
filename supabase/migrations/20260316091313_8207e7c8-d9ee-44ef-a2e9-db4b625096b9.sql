ALTER TABLE public.rail_posting_settings
  ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'AU_GST_STANDARD',
  ADD COLUMN IF NOT EXISTS support_acknowledged_at timestamptz NULL;