/**
 * Settlement Components — Compute and persist deterministic component breakdowns.
 *
 * This module stores per-settlement audit data. The `commerce_gross_total` field
 * is a DIAGNOSTIC estimate from header fields — it is NOT used for matching.
 *
 * Matching uses Xero's SubTotal (ex-GST invoice total from the API) compared
 * against bank_deposit. This is deterministic: no formula, no *1.1.
 *
 * The settlement_components table serves three purposes:
 * 1. Audit trail: shows how each settlement breaks down
 * 2. Diagnostics: explains the gap between AmountDue and bank_deposit
 * 3. Future: enables per-line GST classification when settlement_lines are categorised
 */

import { supabase } from '@/integrations/supabase/client';

interface SettlementComponentInput {
  userId: string;
  settlementId: string;
  marketplaceCode: string;
  periodStart: string;
  periodEnd: string;
  currency?: string;
  /** GST rate as percentage, e.g. 10 for AU */
  gstRate?: number;
  // From parser summary or settlement record:
  salesPrincipal: number;
  salesShipping: number;
  promotionalDiscounts: number;
  sellerFees: number;
  fbaFees: number;
  storageFees: number;
  refunds: number;
  reimbursements: number;
  advertisingCosts: number;
  otherFees: number;
  gstOnIncome: number;
  gstOnExpenses: number;
  bankDeposit: number;
  taxCollectedByPlatform?: number;
  source?: string;
}

/**
 * Compute deterministic component breakdown from settlement header fields.
 *
 * IMPORTANT: `commerce_gross_total` here is a DIAGNOSTIC value only.
 * The matching engine does NOT use this value. It uses Xero's SubTotal
 * (from the API) compared to bank_deposit for deterministic matching.
 *
 * The diagnostic commerce_gross_total = bank_deposit + |gst_on_income| + gst_on_expenses
 * This is an approximation that works when all lines have consistent GST treatment.
 * It may not exactly match external invoice AmountDue when mixed GST categories exist.
 */
export function computeSettlementComponents(input: SettlementComponentInput) {
  const gstRate = input.gstRate ?? 10;

  const salesGross = Math.abs(input.salesPrincipal) + Math.abs(input.salesShipping);
  const gstOnIncome = Math.abs(input.gstOnIncome);
  const gstOnExpenses = input.gstOnExpenses; // Already negative

  const salesExTax = round2(salesGross - gstOnIncome);
  const feesGross = Math.abs(input.sellerFees) + Math.abs(input.fbaFees);
  const feesExTax = round2(feesGross - Math.abs(gstOnExpenses));

  const payoutTotal = round2(input.bankDeposit);

  // Diagnostic estimate only — NOT used for matching.
  // For Tax Exclusive invoices: AmountDue = SubTotal + TotalTax
  // SubTotal ≈ bank_deposit, so this is informational.
  const commerceGrossEstimate = round2(
    payoutTotal + gstOnIncome + gstOnExpenses
  );

  const componentsUsed = [
    'bank_deposit', 'gst_on_income', 'gst_on_expenses',
    'sales_principal', 'sales_shipping', 'seller_fees', 'fba_fees',
  ];

  return {
    user_id: input.userId,
    settlement_id: input.settlementId,
    marketplace_code: input.marketplaceCode,
    currency: input.currency || 'AUD',
    period_start: input.periodStart,
    period_end: input.periodEnd,
    sales_ex_tax: salesExTax,
    sales_tax: gstOnIncome,
    refunds_ex_tax: -Math.abs(input.refunds),
    refunds_tax: 0, // Cannot reliably decompose without per-line data
    fees_ex_tax: -feesExTax,
    fees_tax: gstOnExpenses,
    reimbursements: input.reimbursements,
    other_adjustments: input.otherFees,
    promotional_discounts: input.promotionalDiscounts,
    advertising_costs: input.advertisingCosts,
    storage_fees: input.storageFees,
    tax_collected_by_platform: input.taxCollectedByPlatform ?? 0,
    payout_total: payoutTotal,
    payout_gst_inclusive: commerceGrossEstimate,
    commerce_gross_total: commerceGrossEstimate, // Diagnostic only
    gst_rate: gstRate,
    payout_vs_deposit_diff: 0,
    reconciled: true,
    source: input.source || 'parser',
    formula_version: 'v2_subtotal',
    components_used: JSON.stringify(componentsUsed),
  };
}

/**
 * Upsert settlement components for a parsed settlement.
 * Called from all ingestion paths (CSV upload, API, generic engine).
 */
export async function upsertSettlementComponents(input: SettlementComponentInput): Promise<void> {
  const components = computeSettlementComponents(input);

  const { error } = await supabase
    .from('settlement_components')
    .upsert(components as any, {
      onConflict: 'user_id,settlement_id,marketplace_code',
    });

  if (error) {
    console.error('[settlement-components] upsert error:', error);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
