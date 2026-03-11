
CREATE TABLE public.reconciliation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_type text NOT NULL,
  item_id text NOT NULL,
  note text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  resolved boolean DEFAULT false,
  resolved_at timestamptz
);

ALTER TABLE public.reconciliation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reconciliation notes"
  ON public.reconciliation_notes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR created_by = auth.uid());

CREATE POLICY "Users can insert own reconciliation notes"
  ON public.reconciliation_notes
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own reconciliation notes"
  ON public.reconciliation_notes
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "Users can delete own reconciliation notes"
  ON public.reconciliation_notes
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());
