
-- Period locks table for month-close workflow
CREATE TABLE public.period_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_month text NOT NULL,  -- 'YYYY-MM' format
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid NOT NULL,
  unlock_reason text DEFAULT NULL,
  unlocked_at timestamptz DEFAULT NULL,
  unlocked_by uuid DEFAULT NULL,
  lock_hash text DEFAULT NULL,  -- SHA-256 of settlement data at lock time
  pre_lock_snapshot jsonb DEFAULT '{}'::jsonb,  -- summary stats at lock time
  notes text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month)
);

ALTER TABLE public.period_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own period locks"
  ON public.period_locks
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_period_locks_user_month ON public.period_locks (user_id, period_month);

COMMENT ON TABLE public.period_locks IS 'Month-close locks preventing modifications to settled periods. Supports unlock-with-reason for safe repost override.';
COMMENT ON COLUMN public.period_locks.lock_hash IS 'SHA-256 hash of all settlement IDs + amounts at lock time for tamper detection.';
COMMENT ON COLUMN public.period_locks.pre_lock_snapshot IS 'Summary stats (count, total, marketplaces) captured at lock time for audit comparison.';
