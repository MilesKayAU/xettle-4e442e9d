import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FeeAnalysisRow {
  marketplace: string;
  month: string;
  sales_ex_gst: number;
  total_fees: number;
  fee_percentage: number;
  gst_payable: number;
  net_amount: number;
  settlement_count: number;
}

export interface GstLiabilityRow {
  quarter: string;
  quarter_start: string;
  quarter_end: string;
  gst_payable: number;
  gst_claimable: number;
  net_gst_liability: number;
  sales_principal: number;
  fees_total: number;
  settlements_count: number;
}

export interface TrendRow {
  period_label: string;
  period_end: string;
  gross_sales: number;
  refunds_net: number;
  total_fees: number;
  gst_on_income: number;
  net_deposit: number;
  settlement_count: number;
  margin_pct: number;
}

export interface ChannelComparisonRow {
  marketplace: string;
  total_settlements: number;
  total_gross_sales: number;
  total_refunds: number;
  total_fees_seller: number;
  total_fees_fba: number;
  total_fees_storage: number;
  total_fees_other: number;
  total_all_fees: number;
  total_gst_payable: number;
  total_gst_claimable: number;
  total_net_payout: number;
  avg_fee_rate_pct: number;
  margin_pct: number;
  date_range: string;
}

export function useInsightsData() {
  const [feeAnalysis, setFeeAnalysis] = useState<FeeAnalysisRow[]>([]);
  const [gstLiability, setGstLiability] = useState<GstLiabilityRow[]>([]);
  const [trend12Month, setTrend12Month] = useState<TrendRow[]>([]);
  const [channelComparison, setChannelComparison] = useState<ChannelComparisonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError('Not authenticated');
          setLoading(false);
          return;
        }

        const [feeRes, gstRes, trendRes, channelRes] = await Promise.all([
          supabase.rpc('get_marketplace_fee_analysis', { p_user_id: user.id } as any),
          supabase.rpc('get_gst_liability_by_quarter', { p_user_id: user.id } as any),
          supabase.rpc('get_rolling_12_month_trend', { p_user_id: user.id } as any),
          supabase.rpc('get_channel_comparison', { p_user_id: user.id } as any),
        ]);

        if (feeRes.error) throw feeRes.error;
        if (gstRes.error) throw gstRes.error;
        if (trendRes.error) throw trendRes.error;
        if (channelRes.error) throw channelRes.error;

        setFeeAnalysis((feeRes.data || []) as FeeAnalysisRow[]);
        setGstLiability((gstRes.data || []) as GstLiabilityRow[]);
        setTrend12Month((trendRes.data || []) as TrendRow[]);
        setChannelComparison((channelRes.data || []) as ChannelComparisonRow[]);
      } catch (err: any) {
        console.error('[useInsightsData]', err);
        setError(err.message || 'Failed to load insights');
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, []);

  return { feeAnalysis, gstLiability, trend12Month, channelComparison, loading, error };
}
