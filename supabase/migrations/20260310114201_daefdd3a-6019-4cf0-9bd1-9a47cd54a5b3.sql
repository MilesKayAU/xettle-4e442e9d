
CREATE TABLE public.bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid NOT NULL,
  page_url text,
  description text NOT NULL,
  screenshot_base64 text,
  console_errors jsonb DEFAULT '[]'::jsonb,
  severity text NOT NULL DEFAULT 'medium',
  ai_summary text,
  ai_classification text,
  ai_lovable_prompt text,
  ai_complexity text,
  status text NOT NULL DEFAULT 'open',
  owner_notes text,
  resolved_at timestamptz,
  notify_submitter boolean NOT NULL DEFAULT false
);

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

-- Users can insert their own bug reports
CREATE POLICY "Users can insert own bug reports" ON public.bug_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = submitted_by);

-- Users can select their own bug reports
CREATE POLICY "Users can select own bug reports" ON public.bug_reports
  FOR SELECT TO authenticated USING (auth.uid() = submitted_by);

-- Admins can select all bug reports
CREATE POLICY "Admins can select all bug reports" ON public.bug_reports
  FOR SELECT TO authenticated USING (has_role('admin'::app_role));

-- Admins can update all bug reports
CREATE POLICY "Admins can update all bug reports" ON public.bug_reports
  FOR UPDATE TO authenticated USING (has_role('admin'::app_role));
