/**
 * Fee Observation Engine
 * 
 * Extracts fee observations from saved settlements and detects anomalies.
 * Called after saveSettlement() succeeds — fire-and-forget, non-blocking.
 */

import { supabase } from '@/integrations/supabase/client';
import type { StandardSettlement } from './settlement-engine';

interface FeeObservation {
  marketplace_code: string;
  settlement_id: string;
  fee_type: 'commission' | 'referral' | 'fba_fulfilment' | 'storage' | 'refund_rate' | 'shipping_fee' | 'transaction_fee';
  fee_category: string;
  observed_rate: number | null;
  observed_amount: number;
  base_amount: number;
  currency: string;
  observation_method: 'parser' | 'derived' | 'manual';
  period_start: string;
  period_end: string;
}

const MIN_BASE_AMOUNT = 100;

/**
 * Extract fee observations from a StandardSettlement (Bunnings, generic marketplaces).
 * For Amazon, use extractAmazonFeeObservations instead.
 */
function extractFromStandardSettlement(settlement: StandardSettlement): FeeObservation[] {
  const observations: FeeObservation[] = [];
  const base = Math.abs(settlement.sales_ex_gst);

  if (base < MIN_BASE_AMOUNT) return observations;

  const feesAbs = Math.abs(settlement.fees_ex_gst);
  if (feesAbs > 0) {
    observations.push({
      marketplace_code: settlement.marketplace,
      settlement_id: settlement.settlement_id,
      fee_type: 'commission',
      fee_category: 'fees',
      observed_rate: feesAbs / base,
      observed_amount: feesAbs,
      base_amount: base,
      currency: 'AUD',
      observation_method: 'parser',
      period_start: settlement.period_start,
      period_end: settlement.period_end,
    });
  }

  return observations;
}

/**
 * Extract fee observations from an Amazon settlement record (from the settlements table).
 */
function extractFromAmazonRecord(record: {
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  sales_principal: number | null;
  seller_fees: number | null;
  fba_fees: number | null;
  storage_fees: number | null;
  refunds: number | null;
}): FeeObservation[] {
  const observations: FeeObservation[] = [];
  const base = Math.abs(record.sales_principal || 0);

  if (base < MIN_BASE_AMOUNT) return observations;

  const marketplace_code = record.marketplace === 'AU' ? 'amazon_au' : record.marketplace;

  // Referral fees
  const sellerFees = Math.abs(record.seller_fees || 0);
  if (sellerFees > 0) {
    observations.push({
      marketplace_code,
      settlement_id: record.settlement_id,
      fee_type: 'referral',
      fee_category: 'fees',
      observed_rate: sellerFees / base,
      observed_amount: sellerFees,
      base_amount: base,
      currency: 'AUD',
      observation_method: 'parser',
      period_start: record.period_start,
      period_end: record.period_end,
    });
  }

  // FBA fulfilment fees
  const fbaFees = Math.abs(record.fba_fees || 0);
  if (fbaFees > 0) {
    observations.push({
      marketplace_code,
      settlement_id: record.settlement_id,
      fee_type: 'fba_fulfilment',
      fee_category: 'fees',
      observed_rate: fbaFees / base,
      observed_amount: fbaFees,
      base_amount: base,
      currency: 'AUD',
      observation_method: 'parser',
      period_start: record.period_start,
      period_end: record.period_end,
    });
  }

  // Storage fees (absolute amount, no rate)
  const storageFees = Math.abs(record.storage_fees || 0);
  if (storageFees > 0) {
    observations.push({
      marketplace_code,
      settlement_id: record.settlement_id,
      fee_type: 'storage',
      fee_category: 'fees',
      observed_rate: null,
      observed_amount: storageFees,
      base_amount: base,
      currency: 'AUD',
      observation_method: 'parser',
      period_start: record.period_start,
      period_end: record.period_end,
    });
  }

  // Refund rate
  const refunds = Math.abs(record.refunds || 0);
  if (refunds > 0) {
    observations.push({
      marketplace_code,
      settlement_id: record.settlement_id,
      fee_type: 'refund_rate',
      fee_category: 'settlement',
      observed_rate: refunds / base,
      observed_amount: refunds,
      base_amount: base,
      currency: 'AUD',
      observation_method: 'derived',
      period_start: record.period_start,
      period_end: record.period_end,
    });
  }

  return observations;
}

/**
 * Detect anomalies by comparing new observations against historical averages.
 * Inserts alerts into marketplace_fee_alerts for deviations > 15%.
 * Requires at least 3 prior observations before flagging.
 */
async function detectAndSaveAnomalies(
  userId: string,
  observations: FeeObservation[]
): Promise<void> {
  for (const obs of observations) {
    // Skip non-rate observations (e.g. storage with null rate)
    if (obs.observed_rate === null) continue;

    const { data: historical, error } = await supabase
      .from('marketplace_fee_observations')
      .select('observed_rate')
      .eq('user_id', userId)
      .eq('marketplace_code', obs.marketplace_code)
      .eq('fee_type', obs.fee_type)
      .not('observed_rate', 'is', null)
      .neq('settlement_id', obs.settlement_id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error || !historical || historical.length < 3) continue;

    const rates = historical.map(h => h.observed_rate as number);
    const avgRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;

    if (avgRate === 0) continue;

    const deviation = Math.abs(obs.observed_rate - avgRate) / avgRate;

    if (deviation > 0.15) {
      await supabase.from('marketplace_fee_alerts').insert({
        user_id: userId,
        marketplace_code: obs.marketplace_code,
        settlement_id: obs.settlement_id,
        fee_type: obs.fee_type,
        expected_rate: avgRate,
        observed_rate: obs.observed_rate,
        deviation_pct: deviation,
        status: 'pending',
      });
    }
  }
}

/**
 * Main entry point: extract fee observations from a StandardSettlement and save to DB.
 * Called after saveSettlement() succeeds.
 */
export async function extractFeeObservations(
  settlement: StandardSettlement,
  userId: string
): Promise<void> {
  const observations = extractFromStandardSettlement(settlement);
  if (observations.length === 0) return;

  // Delete any existing observations for this settlement (idempotent re-parse)
  await supabase
    .from('marketplace_fee_observations')
    .delete()
    .eq('user_id', userId)
    .eq('settlement_id', settlement.settlement_id);

  // Insert new observations
  const rows = observations.map(obs => ({
    user_id: userId,
    ...obs,
  }));

  const { error } = await supabase
    .from('marketplace_fee_observations')
    .insert(rows);

  if (error) {
    console.error('Failed to save fee observations:', error);
    return;
  }

  // Run anomaly detection
  await detectAndSaveAnomalies(userId, observations);
}

/**
 * Extract fee observations from an Amazon settlement record (already in DB).
 * Called after Amazon settlement save in AccountingDashboard.
 */
export async function extractAmazonFeeObservations(
  record: {
    settlement_id: string;
    marketplace: string;
    period_start: string;
    period_end: string;
    sales_principal: number | null;
    seller_fees: number | null;
    fba_fees: number | null;
    storage_fees: number | null;
    refunds: number | null;
  },
  userId: string
): Promise<void> {
  const observations = extractFromAmazonRecord(record);
  if (observations.length === 0) return;

  // Delete any existing observations for this settlement
  await supabase
    .from('marketplace_fee_observations')
    .delete()
    .eq('user_id', userId)
    .eq('settlement_id', record.settlement_id);

  const rows = observations.map(obs => ({
    user_id: userId,
    ...obs,
  }));

  const { error } = await supabase
    .from('marketplace_fee_observations')
    .insert(rows);

  if (error) {
    console.error('Failed to save Amazon fee observations:', error);
    return;
  }

  await detectAndSaveAnomalies(userId, observations);
}
