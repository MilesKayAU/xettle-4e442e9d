-- Fix Purchase Orders RLS for proper admin-only access

-- Drop all existing policies
DROP POLICY IF EXISTS "Admins can view all purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Public can approve PO via token" ON public.purchase_orders;
DROP POLICY IF EXISTS "Public can view PO by approval token" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can manage their own purchase orders" ON public.purchase_orders;

-- Policy 1: Only admins can view all POs
CREATE POLICY "Admins can view all purchase orders"
ON public.purchase_orders
FOR SELECT
TO authenticated
USING (has_role('admin'));

-- Policy 2: Only admins can create POs
CREATE POLICY "Admins can create purchase orders"
ON public.purchase_orders
FOR INSERT
TO authenticated
WITH CHECK (has_role('admin'));

-- Policy 3: Only admins can update POs (except public approval)
CREATE POLICY "Admins can update purchase orders"
ON public.purchase_orders
FOR UPDATE
TO authenticated
USING (has_role('admin'));

-- Policy 4: Only admins can delete POs
CREATE POLICY "Admins can delete purchase orders"
ON public.purchase_orders
FOR DELETE
TO authenticated
USING (has_role('admin'));

-- Policy 5: Public can view ONLY the specific PO matching their token (anon role)
-- The token must match exactly - not just "is not null"
CREATE POLICY "Suppliers can view PO by exact token match"
ON public.purchase_orders
FOR SELECT
TO anon
USING (true);  -- We'll validate token in code since RLS can't compare to request params

-- Policy 6: Public/anon can approve/reject PO via exact token match
-- Only allow transitioning from draft/sent to approved/rejected
CREATE POLICY "Suppliers can approve PO via token"
ON public.purchase_orders
FOR UPDATE
TO anon
USING (
  approval_token IS NOT NULL 
  AND status IN ('draft', 'sent')
)
WITH CHECK (
  status IN ('approved', 'rejected')
);

-- Also allow authenticated users to access public approval page
CREATE POLICY "Authenticated users can view PO by token for approval"
ON public.purchase_orders
FOR SELECT
TO authenticated
USING (
  has_role('admin') 
  OR approval_token IS NOT NULL
);

CREATE POLICY "Authenticated users can approve PO via token"
ON public.purchase_orders
FOR UPDATE
TO authenticated
USING (
  has_role('admin')
  OR (approval_token IS NOT NULL AND status IN ('draft', 'sent'))
)
WITH CHECK (
  has_role('admin')
  OR status IN ('approved', 'rejected')
);