-- Fix overly permissive RLS policies on purchase_orders table
-- Drop the existing policies
DROP POLICY IF EXISTS "Public can view POs via approval token" ON public.purchase_orders;
DROP POLICY IF EXISTS "Public can approve POs via token" ON public.purchase_orders;

-- Create more secure policies for token-based access
-- Public can only view a specific PO if they provide the correct approval token (handled in application layer)
-- For now, allow authenticated users to manage their POs, and use edge function for public approval
CREATE POLICY "Admins can view all purchase orders"
ON public.purchase_orders
FOR SELECT
USING (has_role('admin'));

CREATE POLICY "Admins can manage all purchase orders"
ON public.purchase_orders
FOR ALL
USING (has_role('admin'))
WITH CHECK (has_role('admin'));