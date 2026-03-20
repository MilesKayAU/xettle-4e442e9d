
CREATE OR REPLACE FUNCTION public.check_and_expire_trial(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_trial_start text;
  v_days_since integer;
  v_days_remaining integer;
BEGIN
  -- Check if user actually has trial role
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'trial') THEN
    RETURN jsonb_build_object('expired', false, 'has_trial', false);
  END IF;

  -- Get trial start date
  SELECT value INTO v_trial_start
  FROM public.app_settings
  WHERE user_id = p_user_id AND key = 'trial_started_at';

  IF v_trial_start IS NULL THEN
    RETURN jsonb_build_object('expired', false, 'days_remaining', 10);
  END IF;

  v_days_since := EXTRACT(DAY FROM (now() - v_trial_start::timestamptz))::integer;
  v_days_remaining := GREATEST(0, 10 - v_days_since);

  IF v_days_since > 10 THEN
    -- Atomically downgrade: remove trial, add free
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = 'trial';
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'free')
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN jsonb_build_object('expired', true, 'days_remaining', 0);
  END IF;

  RETURN jsonb_build_object('expired', false, 'days_remaining', v_days_remaining);
END;
$$;
