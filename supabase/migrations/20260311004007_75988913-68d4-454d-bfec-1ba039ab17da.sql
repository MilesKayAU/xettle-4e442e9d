-- Fix 1: Split marketplace_fingerprints UPDATE policy
DROP POLICY IF EXISTS "Users can update fingerprints" ON public.marketplace_fingerprints;

CREATE POLICY "Users can update own fingerprints" ON public.marketplace_fingerprints
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can update shared fingerprints" ON public.marketplace_fingerprints
  FOR UPDATE TO authenticated
  USING (user_id IS NULL AND public.has_role('admin'::app_role))
  WITH CHECK (user_id IS NULL AND public.has_role('admin'::app_role));