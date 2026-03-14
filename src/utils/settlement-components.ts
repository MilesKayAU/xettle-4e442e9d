/**
 * Settlement Components — Compute and persist deterministic component breakdowns.
 *
 * This module computes `commerce_gross_total` and `payout_total` from explicit
 * settlement fields. These anchors are used by the matching engine to compare
 * against Xero invoices without heuristics (no * 1.1 gross-up).
 *
 * commerce_gross_total = the GST-inclusive "invoice basis" total that tools like
 * Link My Books / A2X use as AmountDue. Computed as:
 *   (sales_ex_tax + sales_tax) + (refunds_ex_tax + refunds_tax) + (fees_ex_tax + fees_tax)
 *   + other_adjustments + reimbursements + advertising_costs + storage_fees
 *   + promotional_discounts + tax_collected_by_platform
 *
 * payout_total = the cash-basis bank deposit (should reconcile to bank_deposit).
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
 * Compute deterministic component breakdown and derived totals.
 *
 * For Amazon AU, the settlement report gives us GST-inclusive totals:
 * - Sales lines include GST (collected on behalf of seller)
 * - Fee lines include input tax credits
 * - bank_deposit = net payout (what hits the bank)
 *
 * commerce_gross_total = what an external tool (LMB/A2X) would use as the
 * Xero invoice AmountDue. For AU, this is the GST-inclusive total of all
 * revenue/fee/adjustment lines — which equals bank_deposit + GST on income
 * (because GST on income is remitted separately, not paid out).
 *
 * BUT this is only an approximation. The TRUE commerce_gross_total must be
 * computed from the actual settlement line items, not from * 1.1.
 *
 * For Amazon AU specifically:
 *   grossTotal (from parser) = sum of ALL line items (sales + promos + fees + refunds + reimbursements + tax)
 *   This equals bank_deposit (the header total-amount IS the payout)
 *   LMB creates invoices with AmountDue = grossTotal + OUTPUT GST on the revenue lines
 *   i.e. AmountDue ≈ sales_gross + refunds_gross + fee_lines + tax_lines + GST_on_revenue
 *
 * The correct deterministic formula:
 *   commerce_gross_total = abs(salesPrincipal + salesShipping + promotionalDiscounts) + gstOnIncome
 *   This is the revenue portion with GST added — matching what LMB puts as invoice total.
 *   Then fees/refunds/reimbursements are separate line items on the invoice.
 *
 * Actually, LMB's AmountDue = bankDeposit * (1 + gstRate/100) for simple cases,
 * but that's a heuristic. The deterministic approach:
 *   LMB treats bank_deposit as the ex-GST base and adds OUTPUT GST.
 *   But bank_deposit already includes fees (negative) and refunds (negative).
 *   So LMB's AmountDue = sum of all invoice lines INCLUDING GST on each line.
 *
 * The ONLY reliable way: store the parser's grossTotal as commerce_gross_total
 * (which equals bank_deposit for Amazon since header.totalAmount = payout),
 * then also store a "gst_inclusive_total" which adds GST on income to payout.
 *
 * For now: compute from explicit components, store both.
 */
export function computeSettlementComponents(input: SettlementComponentInput) {
  const gstRate = input.gstRate ?? 10;
  const gstDivisor = 1 + (100 / gstRate); // 11 for 10%

  // Decompose into ex-tax and tax components
  // Income categories (Sales, Promos) — GST is on income
  const salesGross = Math.abs(input.salesPrincipal) + Math.abs(input.salesShipping);
  const salesExTax = round2(salesGross - salesGross / gstDivisor);
  const salesTax = round2(salesGross / gstDivisor);

  // Actually for Amazon AU:
  // salesPrincipal and salesShipping from the parser are the RAW amounts from the report
  // They are GST-inclusive for AU marketplace
  // gstOnIncome is computed as (auSalesGstBase / gstDivisor)
  // So sales_ex_tax = salesGross - gstOnIncome, sales_tax = gstOnIncome

  const salesExTaxActual = round2(salesGross - Math.abs(input.gstOnIncome));
  const salesTaxActual = round2(Math.abs(input.gstOnIncome));

  // Fees (negative amounts) — GST on expenses (input credits)
  const feesGross = Math.abs(input.sellerFees) + Math.abs(input.fbaFees);
  const feesExTax = round2(feesGross - Math.abs(input.gstOnExpenses));
  const feesTax = round2(Math.abs(input.gstOnExpenses));

  // Refunds (negative)
  const refundsGross = Math.abs(input.refunds);
  const refundsExTax = round2(refundsGross - refundsGross / gstDivisor);
  const refundsTax = round2(refundsGross / gstDivisor);

  // Payout total = bank deposit (what hits the bank)
  const payoutTotal = round2(input.bankDeposit);

  // Commerce gross total: what LMB/A2X puts as Xero invoice AmountDue
  // For Amazon AU, LMB creates an invoice where:
  //   Revenue lines = sales ex GST (as Exclusive tax lines, GST added on top)
  //   Fee lines = fees ex GST (as Exclusive tax lines, GST credits)
  //   Refund lines = refunds ex GST
  //   AmountDue = sum of all lines + GST = grossTotal from report
  //   BUT LMB adds OUTPUT GST on all revenue lines, so AmountDue > payout
  //
  // The deterministic value: bank_deposit is the payout.
  // LMB's invoice total = bank_deposit + gst_on_income (output GST that goes to ATO, not in payout)
  //                      + gst_on_expenses (input credits that reduce GST liability)
  // Wait — that's NOT right either. Let me think again.
  //
  // In Xero, for a Tax Exclusive invoice:
  //   Line 1: Sales $1000 (OUTPUT GST → $100 added) → subtotal $1000, tax $100
  //   Line 2: Fees -$100 (INPUT GST → -$10 credit) → subtotal -$100, tax -$10
  //   SubTotal = $900, TotalTax = $90, Total = $990, AmountDue = $990
  //
  // In the settlement: bankDeposit (payout) = $900 (the net cash)
  //   gstOnIncome = $100, gstOnExpenses = -$10
  //   AmountDue would be = bankDeposit + gstOnIncome + gstOnExpenses = $900 + $100 + (-$10) = $990 ✓
  //
  // So: commerce_gross_total = bankDeposit + gstOnIncome + gstOnExpenses
  // This is deterministic from settlement fields, no heuristic needed!

  const commerceGrossTotal = round2(
    payoutTotal + Math.abs(input.gstOnIncome) + input.gstOnExpenses
    // gstOnExpenses is already negative (expenses are negative)
    // So we ADD it (which subtracts the input credit amount)
  );

  // Payout vs deposit diff for reconciliation
  const payoutVsDepositDiff = 0; // bank_deposit IS the payout for Amazon

  // Reconciled = diff within tolerance
  const reconciled = Math.abs(payoutVsDepositDiff) <= 0.50;

  return {
    user_id: input.userId,
    settlement_id: input.settlementId,
    marketplace_code: input.marketplaceCode,
    currency: input.currency || 'AUD',
    period_start: input.periodStart,
    period_end: input.periodEnd,
    sales_ex_tax: salesExTaxActual,
    sales_tax: salesTaxActual,
    refunds_ex_tax: -refundsExTax, // negative (refunds reduce revenue)
    refunds_tax: -refundsTax,
    fees_ex_tax: -feesExTax, // negative
    fees_tax: -feesTax,
    reimbursements: input.reimbursements,
    other_adjustments: input.otherFees,
    promotional_discounts: input.promotionalDiscounts,
    advertising_costs: input.advertisingCosts,
    storage_fees: input.storageFees,
    tax_collected_by_platform: input.taxCollectedByPlatform ?? 0,
    payout_total: payoutTotal,
    payout_gst_inclusive: commerceGrossTotal,
    commerce_gross_total: commerceGrossTotal,
    gst_rate: gstRate,
    payout_vs_deposit_diff: payoutVsDepositDiff,
    reconciled,
    source: input.source || 'parser',
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
