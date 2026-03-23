CREATE TABLE public.mirakl_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  marketplace_label text NOT NULL,
  base_url text,
  error_message text,
  event_log jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mirakl_issue_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own reports"
  ON public.mirakl_issue_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admin can read all reports"
  ON public.mirakl_issue_reports FOR SELECT
  TO authenticated
  USING (public.is_primary_admin());

CREATE POLICY "Admin can update reports"
  ON public.mirakl_issue_reports FOR UPDATE
  TO authenticated
  USING (public.is_primary_admin())
  WITH CHECK (public.is_primary_admin());