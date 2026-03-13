
-- 1. Create sync_locks table for atomic lock acquisition
CREATE TABLE IF NOT EXISTS public.sync_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  integration text NOT NULL,
  lock_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  owner_id text DEFAULT 'system',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, integration, lock_key)
);

ALTER TABLE public.sync_locks ENABLE ROW LEVEL SECURITY;

-- RLS: users can see their own locks, service role manages all
CREATE POLICY "Users can view own sync locks"
  ON public.sync_locks FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own sync locks"
  ON public.sync_locks FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Atomic lock acquisition RPC
CREATE OR REPLACE FUNCTION public.acquire_sync_lock(
  p_user_id uuid,
  p_integration text,
  p_lock_key text,
  p_ttl_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at timestamptz;
  v_result jsonb;
BEGIN
  v_expires_at := now() + (p_ttl_seconds || ' seconds')::interval;
  
  -- Atomic acquire: insert or update only if expired
  INSERT INTO public.sync_locks (user_id, integration, lock_key, expires_at, owner_id, updated_at)
  VALUES (p_user_id, p_integration, p_lock_key, v_expires_at, gen_random_uuid()::text, now())
  ON CONFLICT (user_id, integration, lock_key)
  DO UPDATE SET
    expires_at = v_expires_at,
    owner_id = gen_random_uuid()::text,
    updated_at = now()
  WHERE sync_locks.expires_at < now();  -- Only acquire if expired
  
  -- Check if we got the lock
  IF FOUND THEN
    v_result := jsonb_build_object('acquired', true, 'expires_at', v_expires_at);
  ELSE
    -- Lock is held by someone else
    SELECT jsonb_build_object(
      'acquired', false,
      'expires_at', sl.expires_at,
      'held_by', sl.owner_id
    ) INTO v_result
    FROM public.sync_locks sl
    WHERE sl.user_id = p_user_id
      AND sl.integration = p_integration
      AND sl.lock_key = p_lock_key;
    
    IF v_result IS NULL THEN
      v_result := jsonb_build_object('acquired', false, 'reason', 'unknown');
    END IF;
  END IF;
  
  RETURN v_result;
END;
$$;

-- 3. Release lock RPC
CREATE OR REPLACE FUNCTION public.release_sync_lock(
  p_user_id uuid,
  p_integration text,
  p_lock_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.sync_locks
  WHERE user_id = p_user_id
    AND integration = p_integration
    AND lock_key = p_lock_key;
  RETURN FOUND;
END;
$$;

-- 4. Check cooldown RPC (reads from app_settings)
CREATE OR REPLACE FUNCTION public.check_sync_cooldown(
  p_user_id uuid,
  p_key text,
  p_window_seconds integer DEFAULT 3600
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_value text;
  v_last_time timestamptz;
  v_retry_after timestamptz;
BEGIN
  SELECT value INTO v_last_value
  FROM public.app_settings
  WHERE user_id = p_user_id AND key = p_key;
  
  IF v_last_value IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  
  v_last_time := v_last_value::timestamptz;
  v_retry_after := v_last_time + (p_window_seconds || ' seconds')::interval;
  
  IF v_retry_after > now() THEN
    RETURN jsonb_build_object('ok', false, 'retry_after', v_retry_after);
  END IF;
  
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5. Hard idempotency: UNIQUE constraint on settlements (if not exists)
-- First check if it exists to avoid error
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'settlements_user_marketplace_id_unique'
  ) THEN
    ALTER TABLE public.settlements
      ADD CONSTRAINT settlements_user_marketplace_id_unique
      UNIQUE (user_id, marketplace, settlement_id);
  END IF;
END $$;

-- 6. Hard idempotency: UNIQUE on settlement_id_aliases
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'settlement_id_aliases_user_alias_unique'
  ) THEN
    ALTER TABLE public.settlement_id_aliases
      ADD CONSTRAINT settlement_id_aliases_user_alias_unique
      UNIQUE (user_id, alias_id);
  END IF;
END $$;
