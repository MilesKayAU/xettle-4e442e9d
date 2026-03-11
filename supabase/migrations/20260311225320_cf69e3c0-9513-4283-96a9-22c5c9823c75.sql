
-- Indexes for insights queries
CREATE INDEX IF NOT EXISTS idx_settlements_user_marketplace 
  ON public.settlements(user_id, marketplace, period_end);

CREATE INDEX IF NOT EXISTS idx_settlements_user_status 
  ON public.settlements(user_id, status);

-- FUNCTION 1: Fee analysis by marketplace and month
CREATE OR REPLACE FUNCTION public.get_marketplace_fee_analysis(p_user_id UUID)
RETURNS TABLE(
  marketplace TEXT,
  month TEXT,
  sales_ex_gst NUMERIC,
  total_fees NUMERIC,
  fee_percentage NUMERIC,
  gst_payable NUMERIC,
  net_amount NUMERIC,
  settlement_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.marketplace,
    TO_CHAR(s.period_end, 'YYYY-MM') AS month,
    ROUND(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) + COALESCE(SUM(s.promotional_discounts), 0) - COALESCE(SUM(s.gst_on_income), 0), 2) AS sales_ex_gst,
    ROUND(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0), 2) AS total_fees,
    CASE 
      WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(
        ABS(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0))
        / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 2)
    END AS fee_percentage,
    ROUND(COALESCE(SUM(s.gst_on_income), 0), 2) AS gst_payable,
    ROUND(COALESCE(SUM(s.bank_deposit), 0), 2) AS net_amount,
    COUNT(*) AS settlement_count
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('duplicate_suppressed', 'already_recorded', 'push_failed_permanent')
  GROUP BY s.marketplace, TO_CHAR(s.period_end, 'YYYY-MM')
  ORDER BY month DESC, marketplace;
$$;

-- FUNCTION 2: GST liability by quarter
CREATE OR REPLACE FUNCTION public.get_gst_liability_by_quarter(p_user_id UUID)
RETURNS TABLE(
  quarter TEXT,
  quarter_start DATE,
  quarter_end DATE,
  gst_payable NUMERIC,
  gst_claimable NUMERIC,
  net_gst_liability NUMERIC,
  sales_principal NUMERIC,
  fees_total NUMERIC,
  settlements_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'Q' || EXTRACT(QUARTER FROM DATE_TRUNC('quarter', s.period_end))::TEXT || ' ' || EXTRACT(YEAR FROM DATE_TRUNC('quarter', s.period_end))::TEXT AS quarter,
    DATE_TRUNC('quarter', s.period_end)::DATE AS quarter_start,
    (DATE_TRUNC('quarter', s.period_end) + INTERVAL '3 months' - INTERVAL '1 day')::DATE AS quarter_end,
    ROUND(COALESCE(SUM(s.gst_on_income), 0), 2) AS gst_payable,
    ROUND(ABS(COALESCE(SUM(s.gst_on_expenses), 0)), 2) AS gst_claimable,
    ROUND(COALESCE(SUM(s.gst_on_income), 0) - ABS(COALESCE(SUM(s.gst_on_expenses), 0)), 2) AS net_gst_liability,
    ROUND(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 2) AS sales_principal,
    ROUND(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0), 2) AS fees_total,
    COUNT(*) AS settlements_count
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('duplicate_suppressed', 'already_recorded', 'push_failed_permanent')
  GROUP BY DATE_TRUNC('quarter', s.period_end)
  ORDER BY quarter_start DESC
  LIMIT 8;
$$;

-- FUNCTION 3: Rolling 12-month trend
CREATE OR REPLACE FUNCTION public.get_rolling_12_month_trend(p_user_id UUID)
RETURNS TABLE(
  period_label TEXT,
  period_end DATE,
  gross_sales NUMERIC,
  refunds_net NUMERIC,
  total_fees NUMERIC,
  gst_on_income NUMERIC,
  net_deposit NUMERIC,
  settlement_count BIGINT,
  margin_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    TO_CHAR(s.period_end, 'Mon YYYY') AS period_label,
    MAX(s.period_end) AS period_end,
    ROUND(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 2) AS gross_sales,
    ROUND(COALESCE(SUM(s.refunds), 0), 2) AS refunds_net,
    ROUND(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0), 2) AS total_fees,
    ROUND(COALESCE(SUM(s.gst_on_income), 0), 2) AS gst_on_income,
    ROUND(COALESCE(SUM(s.bank_deposit), 0), 2) AS net_deposit,
    COUNT(*) AS settlement_count,
    CASE 
      WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(COALESCE(SUM(s.bank_deposit), 0) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1)
    END AS margin_pct
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('duplicate_suppressed', 'already_recorded', 'push_failed_permanent')
    AND s.period_end >= (CURRENT_DATE - INTERVAL '12 months')
  GROUP BY TO_CHAR(s.period_end, 'Mon YYYY'), TO_CHAR(s.period_end, 'YYYY-MM')
  ORDER BY TO_CHAR(s.period_end, 'YYYY-MM') ASC;
$$;

-- FUNCTION 4: Channel comparison (all time)
CREATE OR REPLACE FUNCTION public.get_channel_comparison(p_user_id UUID)
RETURNS TABLE(
  marketplace TEXT,
  total_settlements BIGINT,
  total_gross_sales NUMERIC,
  total_refunds NUMERIC,
  total_fees_seller NUMERIC,
  total_fees_fba NUMERIC,
  total_fees_storage NUMERIC,
  total_fees_other NUMERIC,
  total_all_fees NUMERIC,
  total_gst_payable NUMERIC,
  total_gst_claimable NUMERIC,
  total_net_payout NUMERIC,
  avg_fee_rate_pct NUMERIC,
  margin_pct NUMERIC,
  date_range TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.marketplace,
    COUNT(*) AS total_settlements,
    ROUND(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 2) AS total_gross_sales,
    ROUND(COALESCE(SUM(s.refunds), 0), 2) AS total_refunds,
    ROUND(COALESCE(SUM(s.seller_fees), 0), 2) AS total_fees_seller,
    ROUND(COALESCE(SUM(s.fba_fees), 0), 2) AS total_fees_fba,
    ROUND(COALESCE(SUM(s.storage_fees), 0), 2) AS total_fees_storage,
    ROUND(COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0), 2) AS total_fees_other,
    ROUND(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0), 2) AS total_all_fees,
    ROUND(COALESCE(SUM(s.gst_on_income), 0), 2) AS total_gst_payable,
    ROUND(ABS(COALESCE(SUM(s.gst_on_expenses), 0)), 2) AS total_gst_claimable,
    ROUND(COALESCE(SUM(s.bank_deposit), 0), 2) AS total_net_payout,
    CASE 
      WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(ABS(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0)) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1)
    END AS avg_fee_rate_pct,
    CASE 
      WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(COALESCE(SUM(s.bank_deposit), 0) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1)
    END AS margin_pct,
    MIN(s.period_start)::TEXT || ' to ' || MAX(s.period_end)::TEXT AS date_range
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('duplicate_suppressed', 'already_recorded', 'push_failed_permanent')
  GROUP BY s.marketplace
  ORDER BY total_gross_sales DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_marketplace_fee_analysis(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gst_liability_by_quarter(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rolling_12_month_trend(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_channel_comparison(UUID) TO authenticated;
