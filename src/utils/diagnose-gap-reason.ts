/**
 * Diagnose the likely cause of a reconciliation gap based on marketplace source and financial patterns.
 * Shared utility used by SettlementDetailDrawer and GapTriageTable.
 */
export function diagnoseGapReason(
  settlement: { source?: string; marketplace?: string; seller_fees?: number; bank_deposit?: number; sales_principal?: number; gst_on_income?: number; gst_on_expenses?: number; metadata?: any },
  gap: number
): string | null {
  const source = settlement.source || '';
  const marketplace = (settlement.marketplace || '').toLowerCase();
  const absGap = Math.abs(gap);

  // eBay API: fee double-counting (pre-fix data)
  if (source === 'api' && marketplace.includes('ebay')) {
    const feeTotal = Math.abs(settlement.seller_fees || 0);
    if (feeTotal > 0 && Math.abs(absGap - feeTotal) < 1.00) {
      return 'eBay API returned net amounts (fees already deducted) but fees were subtracted again. Re-sync eBay to fix.';
    }
    return 'eBay settlement may have stale data. Try re-syncing from Settings → Connections.';
  }

  // Kogan: PDF adjustments missing
  if (marketplace.includes('kogan')) {
    const hasPdfMerge = settlement.metadata?.pdfMerged || settlement.metadata?.hasPdf;
    if (!hasPdfMerge) {
      return 'Kogan CSV doesn\'t include returns, ad fees, or monthly seller fees. Upload the Remittance PDF to capture all deductions.';
    }
    return 'Kogan PDF adjustments (returns, ad spend, seller fees) may not have been fully captured. Try re-merging the PDF.';
  }

  // Bunnings
  if (marketplace.includes('bunnings')) {
    if ((settlement.bank_deposit || 0) < 0) {
      return 'Bunnings bank deposit is negative — this may be a monthly fee-only period with no sales. Verify in Marketplace Hub.';
    }
    return 'Bunnings PDF extraction can produce rounding errors. Check the original Remittance Advice.';
  }

  // MyDeal
  if (marketplace.includes('mydeal')) {
    if ((settlement.sales_principal || 0) === 0 && Math.abs(settlement.seller_fees || 0) > 0) {
      return 'MyDeal settlement has fees but no sales captured — the CSV column mapping may need review in Format Inspector.';
    }
  }

  // Shopify Payments
  if (marketplace.includes('shopify')) {
    const taxFields = (settlement.gst_on_income || 0) + (settlement.gst_on_expenses || 0);
    if (Math.abs(taxFields) > 0 && absGap > 0) {
      return 'Shopify payout may include GST components not broken out in individual fields. Check the payout report.';
    }
  }

  // Generic
  if (gap > 0) {
    return 'Bank deposit is higher than computed net — there may be income (e.g. reimbursements, adjustments) not captured in the settlement fields.';
  }
  return 'Bank deposit is lower than computed net — there may be deductions (e.g. ad spend, returns, platform fees) not captured in the settlement fields.';
}
