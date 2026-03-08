-- Drop the existing overly permissive SELECT policy
DROP POLICY IF EXISTS "Only authenticated can view distributor inquiries" ON public.distributor_inquiries;

-- Create new SELECT policy that only allows admins to view
CREATE POLICY "Only admins can view distributor inquiries" 
ON public.distributor_inquiries 
FOR SELECT 
USING (has_role('admin'));

-- Also update UPDATE policy to be admin-only (currently allows any authenticated user)
DROP POLICY IF EXISTS "Only authenticated can update distributor inquiries" ON public.distributor_inquiries;

CREATE POLICY "Only admins can update distributor inquiries" 
ON public.distributor_inquiries 
FOR UPDATE 
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

-- Also update DELETE policy to be admin-only
DROP POLICY IF EXISTS "Only authenticated can delete distributor inquiries" ON public.distributor_inquiries;

CREATE POLICY "Only admins can delete distributor inquiries" 
ON public.distributor_inquiries 
FOR DELETE 
USING (has_role('admin'));