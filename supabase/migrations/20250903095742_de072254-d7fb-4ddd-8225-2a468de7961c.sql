-- Fix RLS policies for alibaba-attachments bucket to allow uploads

-- Ensure the bucket exists and is configured correctly
INSERT INTO storage.buckets (id, name, public)
VALUES ('alibaba-attachments', 'Alibaba Attachments', false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;

-- Remove any existing conflicting policies first
DROP POLICY IF EXISTS "Authenticated users can upload alibaba attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view their alibaba attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their alibaba attachments" ON storage.objects;

-- Create policy for authenticated users to upload files
CREATE POLICY "Authenticated users can upload alibaba attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'alibaba-attachments');

-- Create policy for authenticated users to view their own files
CREATE POLICY "Authenticated users can view their alibaba attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'alibaba-attachments');

-- Create policy for authenticated users to delete their own files
CREATE POLICY "Authenticated users can delete their alibaba attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'alibaba-attachments');