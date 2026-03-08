-- Add supplier field to uploaded_inventory_raw table
ALTER TABLE public.uploaded_inventory_raw 
ADD COLUMN supplier_name text,
ADD COLUMN supplier_contact text;

-- Create suppliers table for better data management
CREATE TABLE public.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on suppliers table
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to manage suppliers
CREATE POLICY "Authenticated users can manage suppliers" 
ON public.suppliers 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create trigger for automatic timestamp updates on suppliers
CREATE TRIGGER update_suppliers_updated_at
BEFORE UPDATE ON public.suppliers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();