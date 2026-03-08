
-- This SQL will need to be executed in the Supabase SQL editor

-- Create bucket for product images
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('product-images', 'Product Images', TRUE) 
ON CONFLICT (id) DO NOTHING;

-- Set RLS policy to allow anonymous read access
CREATE POLICY "Allow public read access" 
  ON storage.objects 
  FOR SELECT 
  TO public 
  USING (bucket_id = 'product-images');

-- Set RLS policy to allow authenticated users to upload
CREATE POLICY "Allow authenticated users to upload" 
  ON storage.objects 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (bucket_id = 'product-images');

-- Set RLS policy to allow authenticated users to update their own uploads
CREATE POLICY "Allow authenticated users to update their own uploads" 
  ON storage.objects 
  FOR UPDATE 
  TO authenticated 
  USING (bucket_id = 'product-images' AND owner = auth.uid());

-- Set RLS policy to allow authenticated users to delete their own uploads
CREATE POLICY "Allow authenticated users to delete their own uploads" 
  ON storage.objects 
  FOR DELETE 
  TO authenticated 
  USING (bucket_id = 'product-images' AND owner = auth.uid());

-- Allow public access to distributor_inquiries for form submissions
-- Note: These policies are already created in a separate migration
-- CREATE POLICY "Allow public to insert distributor inquiries" 
--  ON distributor_inquiries 
--  FOR INSERT 
--  TO public 
--  WITH CHECK (true);
