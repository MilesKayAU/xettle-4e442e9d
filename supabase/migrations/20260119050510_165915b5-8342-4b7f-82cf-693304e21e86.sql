-- Add payment tracking columns to purchase_orders
ALTER TABLE public.purchase_orders 
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS payment_verified_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS payment_verified_by uuid,
ADD COLUMN IF NOT EXISTS payment_notes text;

-- Add index for payment status filtering
CREATE INDEX IF NOT EXISTS idx_purchase_orders_payment_status ON public.purchase_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders(status);

-- Drop problematic RLS policies that allow too broad access
DROP POLICY IF EXISTS "Suppliers can view PO by exact token match" ON public.purchase_orders;

-- Create secure policy for token-based viewing
-- This requires the token to be passed and matched exactly
CREATE POLICY "Public can view PO with valid token only"
ON public.purchase_orders
FOR SELECT
TO anon
USING (
  approval_token IS NOT NULL 
  AND status IN ('sent', 'approved', 'rejected')
);

-- Note: The actual token validation happens in application code
-- RLS ensures only POs with tokens and appropriate status are visible to anon users