
CREATE OR REPLACE FUNCTION public.assign_trial_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'trial')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.app_settings (user_id, key, value)
  VALUES (NEW.id, 'trial_started_at', now()::text)
  ON CONFLICT (user_id, key) DO NOTHING;

  INSERT INTO public.app_settings (user_id, key, value)
  VALUES (NEW.id, 'unmatched_deposit_threshold', '50')
  ON CONFLICT (user_id, key) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.assign_trial_role();
