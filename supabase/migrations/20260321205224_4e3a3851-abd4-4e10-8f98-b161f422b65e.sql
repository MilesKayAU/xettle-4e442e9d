
-- Amazon SP-API compliance checklist items
CREATE TABLE public.amazon_compliance_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'custom',
  is_compliant BOOLEAN NOT NULL DEFAULT false,
  evidence_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.amazon_compliance_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on amazon_compliance_items"
  ON public.amazon_compliance_items
  FOR ALL
  TO authenticated
  USING (public.is_primary_admin())
  WITH CHECK (public.is_primary_admin());

CREATE TRIGGER update_amazon_compliance_updated_at
  BEFORE UPDATE ON public.amazon_compliance_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
