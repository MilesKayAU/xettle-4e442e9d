
-- Add 'trial' and 'free' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'trial';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'free';
