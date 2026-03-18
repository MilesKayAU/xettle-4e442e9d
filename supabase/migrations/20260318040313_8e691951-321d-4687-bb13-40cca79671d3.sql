
CREATE TABLE public.growth_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  thread_url text,
  thread_title text NOT NULL,
  thread_snippet text,
  relevance_score integer DEFAULT 0,
  draft_response text,
  status text NOT NULL DEFAULT 'new',
  search_query text,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);

ALTER TABLE public.growth_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin users can manage growth_opportunities"
ON public.growth_opportunities
FOR ALL
TO authenticated
USING (public.has_role('admin'::app_role))
WITH CHECK (public.has_role('admin'::app_role));
