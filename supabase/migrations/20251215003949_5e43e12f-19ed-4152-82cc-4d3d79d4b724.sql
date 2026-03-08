-- Create app_settings table to store application settings like notification email
CREATE TABLE public.app_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read settings
CREATE POLICY "Authenticated users can read settings"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert/update settings
CREATE POLICY "Authenticated users can insert settings"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update settings"
ON public.app_settings
FOR UPDATE
TO authenticated
USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();