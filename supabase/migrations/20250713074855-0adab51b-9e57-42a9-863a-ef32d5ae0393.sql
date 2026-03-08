-- Fix infinite recursion in user_roles table by updating RLS policies

-- Drop ALL existing policies to start clean
DROP POLICY IF EXISTS "Only admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Primary admin can insert user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Enable select for all users" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage all user roles" ON public.user_roles;

-- Create a proper security definer function to check roles without recursion
CREATE OR REPLACE FUNCTION public.check_user_role(user_uuid uuid, role_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = user_uuid AND role = role_name
  );
$$;

-- Create a function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT public.check_user_role(auth.uid(), 'admin');
$$;

-- Create new safe policies without recursion
CREATE POLICY "Safe admin management policy"
ON public.user_roles
FOR ALL
USING (public.is_primary_admin());

CREATE POLICY "Users view own roles policy"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id OR public.is_primary_admin());