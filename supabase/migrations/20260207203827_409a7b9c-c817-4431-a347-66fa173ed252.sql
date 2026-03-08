
CREATE TABLE public.logistics_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_name TEXT NOT NULL,
  ship_date DATE,
  cartons INTEGER,
  shipping_method TEXT,
  destination_country TEXT,
  destination_detail TEXT,
  tracking_number TEXT,
  reference_number TEXT,
  tracking_url TEXT,
  vessel_name TEXT,
  status TEXT DEFAULT 'waiting',
  etd DATE,
  eta DATE,
  actual_arrival DATE,
  notes TEXT,
  source_year INTEGER,
  upload_batch_id TEXT,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.logistics_shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage logistics shipments"
ON public.logistics_shipments
FOR ALL
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can view logistics shipments"
ON public.logistics_shipments
FOR SELECT
USING (has_role('admin'));

CREATE TRIGGER update_logistics_shipments_updated_at
BEFORE UPDATE ON public.logistics_shipments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
