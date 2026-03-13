-- Create gst_audit_summary table
CREATE TABLE IF NOT EXISTS public.gst_audit_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  marketplace_sales_ex_gst numeric,
  marketplace_gst_on_sales_estimate numeric,
  marketplace_fees_ex_gst numeric,
  marketplace_gst_on_fees_estimate numeric,
  marketplace_refund_gst_estimate numeric,
  marketplace_adjustment_gst_estimate numeric,
  marketplace_tax_collected_by_platform numeric,
  marketplace_unknown_gst numeric,
  xero_gst numeric,
  difference numeric,
  breakdown jsonb,
  notes jsonb,
  confidence_score integer,
  confidence_label text,
  xero_source_mode text NOT NULL DEFAULT 'xettle_invoices_only',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique index for upsert
CREATE UNIQUE INDEX IF NOT EXISTS gst_audit_summary_user_period_unique
  ON public.gst_audit_summary(user_id, period_start, period_end);

-- RLS
ALTER TABLE public.gst_audit_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gst_audit_summary_select_own" ON public.gst_audit_summary
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "gst_audit_summary_insert_own" ON public.gst_audit_summary
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "gst_audit_summary_update_own" ON public.gst_audit_summary
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- updated_at trigger
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

CREATE TRIGGER gst_audit_summary_updated_at
  BEFORE UPDATE ON public.gst_audit_summary
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- Performance indexes
CREATE INDEX IF NOT EXISTS settlements_user_period
  ON public.settlements(user_id, period_end);

CREATE INDEX IF NOT EXISTS settlement_lines_user_settlement
  ON public.settlement_lines(user_id, settlement_id);

CREATE INDEX IF NOT EXISTS xero_matches_user_settlement
  ON public.xero_accounting_matches(user_id, settlement_id);