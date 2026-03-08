
-- Fix 1: Restrict app_settings write access to admin users only
DROP POLICY IF EXISTS "Authenticated users can insert settings" ON public.app_settings;
DROP POLICY IF EXISTS "Authenticated users can update settings" ON public.app_settings;

CREATE POLICY "Admins can insert settings"
ON public.app_settings FOR INSERT
TO authenticated
WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can update settings"
ON public.app_settings FOR UPDATE
TO authenticated
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can delete settings"
ON public.app_settings FOR DELETE
TO authenticated
USING (has_role('admin'));
