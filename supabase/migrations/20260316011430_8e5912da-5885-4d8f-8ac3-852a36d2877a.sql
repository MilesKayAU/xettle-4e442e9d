-- Hide corrupt Kogan records: junk settlement_ids that are CSV artifacts
UPDATE public.settlements
SET is_hidden = true
WHERE marketplace = 'kogan'
  AND (
    settlement_id IN ('APCreditNote', 'Claim details below', 'Monthly Marketplace Seller Fee', '------------------------------', 'ungrouped')
    OR sales_principal < -1000
    OR (sales_principal = 50 AND bank_deposit = 0 AND seller_fees = 0)
  );

-- Fix all 8 RPC insight functions: remove is_pre_boundary filter, add duplicate_suppressed exclusion
-- Analytics should show ALL settlement data regardless of accounting boundary

CREATE OR REPLACE FUNCTION public.get_marketplace_fee_analysis(p_user_id uuid, p_marketplace text DEFAULT NULL::text)
RETURNS TABLE(marketplace text, month text, sales_ex_gst numeric, total_fees numeric, fee_percentage numeric, gst_payable numeric, net_amount numeric, settlement_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    s.marketplace,
    TO_CHAR(s.period_end, 'YYYY-MM') AS month,
    ROUND(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) + COALESCE(SUM(s.promotional_discounts), 0) - COALESCE(SUM(s.gst_on_income), 0), 2) AS sales_ex_gst,
    ROUND(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0), 2) AS total_fees,
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(ABS(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0)) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 2)
    END AS fee_percentage,
    ROUND(COALESCE(SUM(s.gst_on_income), 0), 2) AS gst_payable,
    ROUND(COALESCE(SUM(s.bank_deposit), 0), 2) AS net_amount,
    COUNT(*) AS settlement_count
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL
    AND s.is_hidden = false
    AND (p_marketplace IS NULL OR s.marketplace = p_marketplace)
  GROUP BY s.marketplace, TO_CHAR(s.period_end, 'YYYY-MM')
  ORDER BY month DESC, marketplace;
$$;

CREATE OR REPLACE FUNCTION public.get_marketplace_fee_analysis(p_user_id uuid)
RETURNS TABLE(marketplace text, month text, sales_ex_gst numeric, total_fees numeric, fee_percentage numeric, gst_payable numeric, net_amount numeric, settlement_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    s.marketplace,
    TO_CHAR(s.period_end, 'YYYY-MM') AS month,
    ROUND(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) + COALESCE(SUM(s.promotional_discounts), 0) - COALESCE(SUM(s.gst_on_income), 0), 2) AS sales_ex_gst,
    ROUND(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0), 2) AS total_fees,
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(ABS(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0)) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 2)
    END AS fee_percentage,
    ROUND(COALESCE(SUM(s.gst_on_income), 0), 2) AS gst_payable,
    ROUND(COALESCE(SUM(s.bank_deposit), 0), 2) AS net_amount,
    COUNT(*) AS settlement_count
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL
    AND s.is_hidden = false
  GROUP BY s.marketplace, TO_CHAR(s.period_end, 'YYYY-MM')
  ORDER BY month DESC, marketplace;
$$;

CREATE OR REPLACE FUNCTION public.get_gst_liability_by_quarter(p_user_id uuid, p_marketplace text DEFAULT NULL::text)
RETURNS TABLE(quarter text, quarter_start date, quarter_end date, gst_payable numeric, gst_claimable numeric, net_gst_liability numeric, sales_principal numeric, fees_total numeric, settlements_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL
    AND s.is_hidden = false
    AND (p_marketplace IS NULL OR s.marketplace = p_marketplace)
  GROUP BY DATE_TRUNC('quarter', s.period_end)
  ORDER BY quarter_start DESC LIMIT 8;
$$;

CREATE OR REPLACE FUNCTION public.get_gst_liability_by_quarter(p_user_id uuid)
RETURNS TABLE(quarter text, quarter_start date, quarter_end date, gst_payable numeric, gst_claimable numeric, net_gst_liability numeric, sales_principal numeric, fees_total numeric, settlements_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL
    AND s.is_hidden = false
  GROUP BY DATE_TRUNC('quarter', s.period_end)
  ORDER BY quarter_start DESC LIMIT 8;
$$;

CREATE OR REPLACE FUNCTION public.get_rolling_12_month_trend(p_user_id uuid, p_marketplace text DEFAULT NULL::text)
RETURNS TABLE(period_label text, period_end date, gross_sales numeric, refunds_net numeric, total_fees numeric, gst_on_income numeric, net_deposit numeric, settlement_count bigint, margin_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(COALESCE(SUM(s.bank_deposit), 0) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1)
    END AS margin_pct
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL
    AND s.is_hidden = false
    AND s.period_end >= (CURRENT_DATE - INTERVAL '12 months')
    AND (p_marketplace IS NULL OR s.marketplace = p_marketplace)
  GROUP BY TO_CHAR(s.period_end, 'Mon YYYY'), TO_CHAR(s.period_end, 'YYYY-MM')
  ORDER BY TO_CHAR(s.period_end, 'YYYY-MM') ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_rolling_12_month_trend(p_user_id uuid)
RETURNS TABLE(period_label text, period_end date, gross_sales numeric, refunds_net numeric, total_fees numeric, gst_on_income numeric, net_deposit numeric, settlement_count bigint, margin_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(COALESCE(SUM(s.bank_deposit), 0) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1)
    END AS margin_pct
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL
    AND s.is_hidden = false
    AND s.period_end >= (CURRENT_DATE - INTERVAL '12 months')
  GROUP BY TO_CHAR(s.period_end, 'Mon YYYY'), TO_CHAR(s.period_end, 'YYYY-MM')
  ORDER BY TO_CHAR(s.period_end, 'YYYY-MM') ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_comparison(p_user_id uuid, p_marketplace text DEFAULT NULL::text)
RETURNS TABLE(marketplace text, total_settlements bigint, total_gross_sales numeric, total_refunds numeric, total_fees_seller numeric, total_fees_fba numeric, total_fees_storage numeric, total_fees_other numeric, total_all_fees numeric, total_gst_payable numeric, total_gst_claimable numeric, total_net_payout numeric, avg_fee_rate_pct numeric, margin_pct numeric, date_range text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.marketplace, COUNT(*) AS total_settlements,
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
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(ABS(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0)) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1) END AS avg_fee_rate_pct,
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(COALESCE(SUM(s.bank_deposit), 0) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1) END AS margin_pct,
    MIN(s.period_start)::TEXT || ' to ' || MAX(s.period_end)::TEXT AS date_range
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL AND s.is_hidden = false
    AND (p_marketplace IS NULL OR s.marketplace = p_marketplace)
  GROUP BY s.marketplace ORDER BY total_gross_sales DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_comparison(p_user_id uuid)
RETURNS TABLE(marketplace text, total_settlements bigint, total_gross_sales numeric, total_refunds numeric, total_fees_seller numeric, total_fees_fba numeric, total_fees_storage numeric, total_fees_other numeric, total_all_fees numeric, total_gst_payable numeric, total_gst_claimable numeric, total_net_payout numeric, avg_fee_rate_pct numeric, margin_pct numeric, date_range text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.marketplace, COUNT(*) AS total_settlements,
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
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(ABS(COALESCE(SUM(s.seller_fees), 0) + COALESCE(SUM(s.fba_fees), 0) + COALESCE(SUM(s.storage_fees), 0) + COALESCE(SUM(s.advertising_costs), 0) + COALESCE(SUM(s.other_fees), 0)) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1) END AS avg_fee_rate_pct,
    CASE WHEN COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0) = 0 THEN 0
      ELSE ROUND(COALESCE(SUM(s.bank_deposit), 0) / NULLIF(COALESCE(SUM(s.sales_principal), 0) + COALESCE(SUM(s.sales_shipping), 0), 0) * 100, 1) END AS margin_pct,
    MIN(s.period_start)::TEXT || ' to ' || MAX(s.period_end)::TEXT AS date_range
  FROM public.settlements s
  WHERE s.user_id = p_user_id
    AND s.status NOT IN ('push_failed_permanent', 'duplicate_suppressed')
    AND s.duplicate_of_settlement_id IS NULL AND s.is_hidden = false
  GROUP BY s.marketplace ORDER BY total_gross_sales DESC;
$$;