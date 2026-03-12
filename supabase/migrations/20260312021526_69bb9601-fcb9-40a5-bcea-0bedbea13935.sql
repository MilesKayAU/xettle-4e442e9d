CREATE TABLE public.xero_contact_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  contact_name text NOT NULL,
  account_code text NOT NULL,
  usage_count integer NOT NULL DEFAULT 1,
  confidence_pct numeric NOT NULL DEFAULT 0,
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_name, account_code)
);

ALTER TABLE public.xero_contact_account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own contact account mappings"
  ON public.xero_contact_account_mappings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);