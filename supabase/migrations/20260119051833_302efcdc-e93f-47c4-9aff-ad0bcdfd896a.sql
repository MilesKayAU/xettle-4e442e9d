-- Drop existing has_role function with CASCADE to remove dependent policies
DROP FUNCTION IF EXISTS public.has_role(text) CASCADE;

-- Recreate with unambiguous parameter name  
CREATE OR REPLACE FUNCTION public.has_role(_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = _role
  );
END;
$$;

-- Recreate video_categories policies
CREATE POLICY "Admins can insert video categories" ON public.video_categories
FOR INSERT WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can update video categories" ON public.video_categories
FOR UPDATE USING (public.has_role('admin'));

CREATE POLICY "Admins can delete video categories" ON public.video_categories
FOR DELETE USING (public.has_role('admin'));

-- Recreate videos policies
CREATE POLICY "Admins can insert videos" ON public.videos
FOR INSERT WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can update videos" ON public.videos
FOR UPDATE USING (public.has_role('admin'));

CREATE POLICY "Admins can delete videos" ON public.videos
FOR DELETE USING (public.has_role('admin'));

-- Recreate research_links policies
CREATE POLICY "Allow admins full access to research links" ON public.research_links
FOR ALL USING (public.has_role('admin'));

-- Recreate distributor_inquiries policies
CREATE POLICY "Only admins can view distributor inquiries" ON public.distributor_inquiries
FOR SELECT USING (public.has_role('admin'));

CREATE POLICY "Only admins can update distributor inquiries" ON public.distributor_inquiries
FOR UPDATE USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));

CREATE POLICY "Only admins can delete distributor inquiries" ON public.distributor_inquiries
FOR DELETE USING (public.has_role('admin'));

-- Recreate purchase_orders policies
CREATE POLICY "Admins can view all purchase orders" ON public.purchase_orders
FOR SELECT USING (public.has_role('admin'));

CREATE POLICY "Admins can create purchase orders" ON public.purchase_orders
FOR INSERT WITH CHECK (public.has_role('admin'));

CREATE POLICY "Admins can update purchase orders" ON public.purchase_orders
FOR UPDATE USING (public.has_role('admin'));

CREATE POLICY "Admins can delete purchase orders" ON public.purchase_orders
FOR DELETE USING (public.has_role('admin'));

-- Recreate token-based approval policies for purchase_orders
CREATE POLICY "Authenticated users can view PO by token for approval" ON public.purchase_orders
FOR SELECT USING (public.has_role('admin') OR approval_token IS NOT NULL);

CREATE POLICY "Authenticated users can approve PO via token" ON public.purchase_orders
FOR UPDATE 
USING (public.has_role('admin') OR (approval_token IS NOT NULL AND status IN ('draft', 'sent')))
WITH CHECK (public.has_role('admin') OR status IN ('approved', 'rejected'));