-- Fix database function security by adding search_path to all functions
-- This prevents potential privilege escalation attacks

-- Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Fix update_data_uploads_updated_at function
CREATE OR REPLACE FUNCTION public.update_data_uploads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Fix check_user_role function
CREATE OR REPLACE FUNCTION public.check_user_role(user_uuid uuid, role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = user_uuid AND role = role_name
  );
$function$;

-- Fix is_current_user_admin function
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.check_user_role(auth.uid(), 'admin');
$function$;

-- Fix update_ignored_products_updated_at function
CREATE OR REPLACE FUNCTION public.update_ignored_products_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Fix has_role function
CREATE OR REPLACE FUNCTION public.has_role(role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = $1
  );
END;
$function$;

-- Fix handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  RETURN new;
END;
$function$;

-- Fix is_primary_admin function
CREATE OR REPLACE FUNCTION public.is_primary_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  user_email text;
BEGIN
  -- Get the current user's email from auth.users
  SELECT email INTO user_email 
  FROM auth.users 
  WHERE id = auth.uid();
  
  -- Check if the email matches the primary admin email
  RETURN LOWER(user_email) = LOWER('mileskayaustralia@gmail.com');
END;
$function$;

-- Fix force_delete_product function
CREATE OR REPLACE FUNCTION public.force_delete_product(product_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  deleted_row RECORD;
BEGIN
  -- Attempt to directly delete the row and return it
  DELETE FROM public.product_submissions
  WHERE id = product_id
  RETURNING * INTO deleted_row;
  
  -- Check if we actually deleted something
  IF deleted_row IS NOT NULL THEN
    RAISE NOTICE 'Successfully deleted product %', product_id;
    RETURN TRUE;
  ELSE
    RAISE WARNING 'Product % not found or could not be deleted', product_id;
    RETURN FALSE;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error deleting product %: %', product_id, SQLERRM;
    RETURN FALSE;
END;
$function$;

-- Fix before_insert_update_video function
CREATE OR REPLACE FUNCTION public.before_insert_update_video()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Extract YouTube ID
  NEW.youtube_id := public.extract_youtube_id(NEW.youtube_url);
  
  -- Set thumbnail URL if not provided
  IF NEW.thumbnail_url IS NULL OR NEW.thumbnail_url = '' THEN
    NEW.thumbnail_url := 'https://img.youtube.com/vi/' || NEW.youtube_id || '/mqdefault.jpg';
  END IF;
  
  -- Update updated_at
  NEW.updated_at := now();
  
  RETURN NEW;
END;
$function$;

-- Fix extract_youtube_id function
CREATE OR REPLACE FUNCTION public.extract_youtube_id(youtube_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  youtube_id TEXT;
BEGIN
  -- Extract YouTube ID from different URL formats
  IF youtube_url ~ 'youtube\.com\/watch\?v=' THEN
    youtube_id := substring(youtube_url from 'v=([^&]*)');
  ELSIF youtube_url ~ 'youtu\.be\/' THEN
    youtube_id := substring(youtube_url from 'youtu\.be\/([^?]*)');
  ELSIF youtube_url ~ 'youtube\.com\/embed\/' THEN
    youtube_id := substring(youtube_url from 'embed\/([^?]*)');
  ELSE
    youtube_id := youtube_url;
  END IF;

  RETURN youtube_id;
END;
$function$;

-- Consolidate and fix overly permissive RLS policies

-- Fix contact_messages table policies - remove redundant policies and restrict access
DROP POLICY IF EXISTS "Allow authenticated users to create contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Allow authenticated users to read contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Allow authenticated users to update contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Allow authenticated users to view contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Allow public to create contact messages" ON public.contact_messages;

-- Keep only essential policies for contact_messages
CREATE POLICY "Allow public to insert contact messages"
ON public.contact_messages
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Allow admins to view contact messages"
ON public.contact_messages
FOR SELECT
TO authenticated
USING (public.has_role('admin'));

-- Fix distributor_inquiries table policies - consolidate redundant policies
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

-- Create consolidated policies for distributor_inquiries
CREATE POLICY "Allow public to submit distributor inquiries"
ON public.distributor_inquiries
FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Allow admins to manage distributor inquiries"
ON public.distributor_inquiries
FOR ALL
TO authenticated
USING (public.has_role('admin'))
WITH CHECK (public.has_role('admin'));

-- Fix suppliers table - restrict to admin access only
DROP POLICY IF EXISTS "Authenticated users can manage suppliers" ON public.suppliers;

CREATE POLICY "Allow admins to manage suppliers"
ON public.suppliers
FOR ALL
TO authenticated
USING (public.has_role('admin'))
WITH CHECK (public.has_role('admin'));

-- Fix product_submissions policies - remove overly permissive policies
DROP POLICY IF EXISTS "Allow authenticated users to insert product_submissions" ON public.product_submissions;
DROP POLICY IF EXISTS "Allow authenticated users to update product submissions" ON public.product_submissions;

-- Keep existing policies that are properly scoped
-- "Allow authenticated users to update their own product_submissio" - this one is good
-- "Allow public read access to product_submissions" - this one is acceptable for a public product catalog

-- Add proper admin management policy for product_submissions
CREATE POLICY "Allow admins to manage all product_submissions"
ON public.product_submissions
FOR ALL
TO authenticated
USING (public.has_role('admin'))
WITH CHECK (public.has_role('admin'));

-- Fix storage bucket RLS policies
CREATE POLICY "Allow public read access to product-images bucket"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'product-images');

CREATE POLICY "Allow authenticated users to upload to product-images bucket"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Allow users to update their own uploads in product-images bucket"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images' AND owner = auth.uid());

CREATE POLICY "Allow users to delete their own uploads in product-images bucket"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'product-images' AND owner = auth.uid());