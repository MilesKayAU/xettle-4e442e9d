-- Fix security issue: Restrict access to distributor_inquiries
-- Remove public read access while keeping anonymous insert capability

-- Drop all existing policies for distributor_inquiries
DROP POLICY IF EXISTS "Allow anonymous users to submit distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to delete distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to delete inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to read distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to submit distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to update distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to update inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to view all inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow authenticated users to view distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow public to create distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow public to insert distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Allow public to insert inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Anyone can submit distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Authenticated users can delete distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Authenticated users can update distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Authenticated users can view all distributor inquiries" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Enable insert for anonymous users" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Enable insert for public" ON public.distributor_inquiries;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON public.distributor_inquiries;

-- Create secure policies
-- Allow anonymous users to submit inquiries (business requirement)
CREATE POLICY "Allow anonymous to submit distributor inquiries"
  ON public.distributor_inquiries
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow authenticated users to submit inquiries
CREATE POLICY "Allow authenticated to submit distributor inquiries"
  ON public.distributor_inquiries
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only authenticated users can view inquiries (fixes security issue)
CREATE POLICY "Only authenticated can view distributor inquiries"
  ON public.distributor_inquiries
  FOR SELECT
  TO authenticated
  USING (true);

-- Only authenticated users can update inquiries
CREATE POLICY "Only authenticated can update distributor inquiries"
  ON public.distributor_inquiries
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only authenticated users can delete inquiries
CREATE POLICY "Only authenticated can delete distributor inquiries"
  ON public.distributor_inquiries
  FOR DELETE
  TO authenticated
  USING (true);