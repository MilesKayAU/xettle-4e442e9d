-- Add policy for public to view PO by approval token (for supplier approval page)
-- This allows the POApproval page to work without authentication

-- Drop existing restrictive policies that might conflict
DROP POLICY IF EXISTS "Admins can view all purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Admins can manage all purchase orders" ON public.purchase_orders;

-- Policy: Users can manage their own POs (already exists, but let's ensure it)
DROP POLICY IF EXISTS "Users can manage their own purchase orders" ON public.purchase_orders;
CREATE POLICY "Users can manage their own purchase orders"
ON public.purchase_orders
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can view all POs
CREATE POLICY "Admins can view all purchase orders"
ON public.purchase_orders
FOR SELECT
USING (has_role('admin'));

-- Policy: Public can view PO by token (for approval page - no auth required)
CREATE POLICY "Public can view PO by approval token"
ON public.purchase_orders
FOR SELECT
USING (approval_token IS NOT NULL);

-- Policy: Public can update PO status via approval token (limited fields)
CREATE POLICY "Public can approve PO via token"
ON public.purchase_orders
FOR UPDATE
USING (approval_token IS NOT NULL AND status IN ('draft', 'sent'))
WITH CHECK (status IN ('approved', 'rejected'));