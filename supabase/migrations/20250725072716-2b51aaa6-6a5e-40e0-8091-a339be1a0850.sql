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