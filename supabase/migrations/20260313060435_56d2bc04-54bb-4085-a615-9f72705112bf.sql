
-- Fix: reconciliation_notes INSERT policy must enforce user_id = auth.uid()
-- This prevents authenticated users from injecting notes into other users' views
DROP POLICY IF EXISTS "Users can insert own reconciliation notes" ON public.reconciliation_notes;
CREATE POLICY "Users can insert own reconciliation notes"
  ON public.reconciliation_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND user_id = auth.uid());
