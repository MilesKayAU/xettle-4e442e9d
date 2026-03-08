-- Create product_supplier_links table for permanent product-supplier relationships
CREATE TABLE IF NOT EXISTS public.product_supplier_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sku text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_title text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, sku)
);

-- Enable RLS on product_supplier_links
ALTER TABLE public.product_supplier_links ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for product_supplier_links
CREATE POLICY "Users can manage their own product supplier links"
ON public.product_supplier_links
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create trigger for updating updated_at
CREATE TRIGGER update_product_supplier_links_updated_at
BEFORE UPDATE ON public.product_supplier_links
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();