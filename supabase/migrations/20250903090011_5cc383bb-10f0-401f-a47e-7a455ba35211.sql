-- Enhanced Alibaba Orders table for Xero integration
-- Add new fields for invoice management and Xero sync

ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS invoice_type TEXT CHECK (invoice_type IN ('Product', 'Freight', 'Service Fee'));
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS invoice_date DATE;
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'USD';
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS pdf_file_path TEXT;
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS line_items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10,2);
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS xero_invoice_id TEXT;
ALTER TABLE public.alibaba_orders ADD COLUMN IF NOT EXISTS xero_invoice_number TEXT;

-- Create suppliers table for dropdown options
CREATE TABLE IF NOT EXISTS public.invoice_suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Insert default suppliers
INSERT INTO public.invoice_suppliers (name, contact_name) VALUES 
('Alibaba.com Singapore E-Commerce Private Ltd', 'Alibaba Support'),
('DHL Express', 'DHL Customer Service'),
('Demo Supplier', 'Demo Contact')
ON CONFLICT (name) DO NOTHING;

-- Enable RLS on suppliers table
ALTER TABLE public.invoice_suppliers ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read suppliers
CREATE POLICY "Authenticated users can read suppliers" 
ON public.invoice_suppliers 
FOR SELECT 
TO authenticated 
USING (true);

-- Allow authenticated users to manage suppliers
CREATE POLICY "Authenticated users can manage suppliers" 
ON public.invoice_suppliers 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- Create updated_at trigger for suppliers
CREATE TRIGGER update_invoice_suppliers_updated_at
  BEFORE UPDATE ON public.invoice_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();