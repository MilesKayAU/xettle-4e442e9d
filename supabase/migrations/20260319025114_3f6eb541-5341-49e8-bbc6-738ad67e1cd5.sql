-- Create a system_config table for system-level settings (no FK to auth.users)
CREATE TABLE IF NOT EXISTS public.system_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS but allow only service role / security definer functions
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- No public policies — only accessible via security definer functions

-- Seed primary admin email
INSERT INTO public.system_config (key, value)
VALUES ('primary_admin_email', 'mileskayaustralia@gmail.com')
ON CONFLICT (key) DO NOTHING;

-- Replace is_primary_admin() with dynamic lookup
CREATE OR REPLACE FUNCTION public.is_primary_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.system_config sc
    WHERE sc.key = 'primary_admin_email'
      AND sc.value = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
$$;