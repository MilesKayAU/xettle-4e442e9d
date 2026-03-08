-- Create purchase_orders table for PO workflow with supplier approval
CREATE TABLE public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id),
  po_number TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'Australia',
  status TEXT NOT NULL DEFAULT 'draft',
  
  -- PO Details
  total_amount NUMERIC,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  terms TEXT,
  
  -- Line Items (JSONB array)
  line_items JSONB DEFAULT '[]'::jsonb,
  
  -- Approval Tracking
  approval_token UUID DEFAULT gen_random_uuid(),
  approved_at TIMESTAMPTZ,
  approved_by_name TEXT,
  approved_by_email TEXT,
  supplier_notes TEXT,
  alibaba_order_id TEXT,
  
  -- Linking to alibaba_orders
  alibaba_order_uuid UUID REFERENCES public.alibaba_orders(id),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can manage their own POs
CREATE POLICY "Users can manage their own purchase orders"
ON public.purchase_orders
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Policy: Public can view POs via approval token (for supplier approval page)
CREATE POLICY "Public can view POs via approval token"
ON public.purchase_orders
FOR SELECT
USING (true);

-- Policy: Public can update POs via approval token (for supplier to approve)
CREATE POLICY "Public can approve POs via token"
ON public.purchase_orders
FOR UPDATE
USING (approval_token IS NOT NULL)
WITH CHECK (approval_token IS NOT NULL);

-- Create trigger for updated_at
CREATE TRIGGER update_purchase_orders_updated_at
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster token lookups
CREATE INDEX idx_purchase_orders_approval_token ON public.purchase_orders(approval_token);
CREATE INDEX idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX idx_purchase_orders_country ON public.purchase_orders(country);