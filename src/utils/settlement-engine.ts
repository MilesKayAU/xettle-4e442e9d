/**
 * Settlement Engine — Shared types and helpers for all marketplace settlements.
 * 
 * Flow: Marketplace File → Marketplace Parser → StandardSettlement → Engine → Xero
 * 
 * Every marketplace parser converts its native format into a StandardSettlement.
 * The engine handles saving to the database and syncing to Xero.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Standard Settlement Type ────────────────────────────────────────────────

export interface StandardSettlement {
  marketplace: string;       // 'amazon_au' | 'bunnings' | 'catch' | 'mydeal' | 'kogan'
  settlement_id: string;     // Unique ID from the marketplace
  period_start: string;      // YYYY-MM-DD
  period_end: string;        // YYYY-MM-DD
  sales_ex_gst: number;      // Gross sales excluding GST (positive)
  gst_on_sales: number;      // GST collected on sales (positive)
  fees_ex_gst: number;       // Marketplace fees excluding GST (negative)
  gst_on_fees: number;       // GST on fees (positive absolute value)
  net_payout: number;        // Amount deposited to bank
  source: 'csv_upload' | 'api' | 'manual';  // How this settlement was ingested
  reconciles: boolean;       // Whether calculated total ≈ net_payout
  // Optional marketplace-specific metadata
  metadata?: Record<string, any>;
}

// ─── Marketplace Contact Names (for Xero invoices) ──────────────────────────

export const MARKETPLACE_CONTACTS: Record<string, string> = {
  amazon_au: 'Amazon.com.au',
  bunnings: 'Bunnings Marketplace',
  bigw: 'Big W Marketplace',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify', // Dynamic per-gateway contact name in metadata
  catch: 'Catch Marketplace',
  mydeal: 'MyDeal Marketplace',
  kogan: 'Kogan Marketplace',
  woolworths: 'Woolworths Marketplace',
  woolworths_marketplus: 'Woolworths MarketPlus',
};

export const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  AU: 'Amazon AU',
  bunnings: 'Bunnings',
  bigw: 'Big W',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify Orders',
  catch: 'Catch',
  mydeal: 'MyDeal',
  kogan: 'Kogan',
  woolworths: 'Everyday Market',
  woolworths_marketplus: 'Woolworths MarketPlus',
  everyday_market: 'Everyday Market',
  ebay_au: 'eBay AU',
  ebay: 'eBay AU',           // Alias — canonical code is ebay_au
  etsy: 'Etsy',
  paypal: 'PayPal',
  manual_orders: 'Manual Orders',
  theiconic: 'The Iconic',
  tiktok_shop: 'TikTok Shop',
  temu: 'Temu',
  shein: 'Shein',
  // Composite codes from parsers
  woolworths_marketplus_bigw: 'Big W',
  woolworths_marketplus_woolworths: 'Everyday Market',
  woolworths_marketplus_mydeal: 'MyDeal',
  woolworths_marketplus_everyday_market: 'Everyday Market',
};

/**
 * Get a display label for any marketplace code.
 * Falls back to title-casing the code if not in the hardcoded registry.
 * e.g. 'shopify_temu' → 'Shopify Temu'
 */
export function getMarketplaceLabel(code: string): string {
  if (MARKETPLACE_LABELS[code]) return MARKETPLACE_LABELS[code];
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Marketplace codes that are payment gateways, not settlement sources.
 * These should NOT appear in the settlement timeline or validation table.
 * Keep in sync with PAYMENT_PROCESSORS in marketplace-token-map.ts
 */
export const GATEWAY_CODES = new Set([
  'paypal', 'stripe', 'afterpay', 'zip', 'zippay', 'klarna',
  'laybuy', 'humm', 'openpay', 'latitude', 'commbank', 'anz',
  'westpac', 'nab', 'square', 'tyro', 'braintree', 'stripe_gateway', 'zip_pay',
]);

/**
 * Normalise duplicate marketplace codes to their canonical version.
 * e.g. 'ebay' → 'ebay_au'
 */
export const MARKETPLACE_ALIASES: Record<string, string> = {
  ebay: 'ebay_au',
};

// ─── Xero Invoice Line Builder ──────────────────────────────────────────────

export interface XeroLineItem {
  Description: string;
  AccountCode: string;
  TaxType: string;
  UnitAmount: number;
  Quantity: number;
}

// ─── Default Account Codes ──────────────────────────────────────────────────

const DEFAULT_ACCOUNT_CODES: Record<string, string> = {
  'Sales': '200',
  'Shipping': '206',
  'Refunds': '205',
  'Reimbursements': '271',
  'Seller Fees': '407',
  'FBA Fees': '408',
  'Storage Fees': '409',
  'Promotional Discounts': '200',
  'Other Fees': '405',
  'Advertising Costs': '410',
};

/**
 * Fetch the user's custom account code overrides from app_settings.
 * Returns a getCode(category, marketplace?) helper that resolves:
 *   1. userCodes["category:marketplace"] (if marketplace provided)
 *   2. userCodes["category"]
 *   3. DEFAULT_ACCOUNT_CODES["category"]
 *   4. '400' (catch-all)
 */
async function loadUserAccountCodes(): Promise<(category: string, marketplace?: string) => string> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return (cat) => DEFAULT_ACCOUNT_CODES[cat] || '400';

    const { data: acSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'accounting_xero_account_codes')
      .maybeSingle();

    if (acSetting?.value) {
      const userCodes = JSON.parse(acSetting.value);
      return (cat: string, marketplace?: string) => {
        if (marketplace) {
          const mpKey = `${cat}:${marketplace}`;
          if (userCodes[mpKey]) return userCodes[mpKey];
        }
        return userCodes[cat] || DEFAULT_ACCOUNT_CODES[cat] || '400';
      };
    }
  } catch (e) {
    console.error('Failed to load user account codes, using defaults:', e);
  }
  return (cat) => DEFAULT_ACCOUNT_CODES[cat] || '400';
}

/**
 * Build standard 2-line Xero invoice from a StandardSettlement.
 * Line 1: Marketplace Sales (Account 200, GST on Income)
 * Line 2: Marketplace Fees (Account 407, GST on Expenses)
 * 
 * For Amazon, the AccountingDashboard builds its own multi-line invoices
 * due to the complexity of FBA fees, storage, refunds, etc.
 */
export async function buildSimpleInvoiceLines(settlement: StandardSettlement): Promise<XeroLineItem[]> {
  const getCode = await loadUserAccountCodes();
  // Derive marketplace label for per-channel account resolution
  const mpLabel = MARKETPLACE_LABELS[settlement.marketplace] || settlement.marketplace;

  const lines: XeroLineItem[] = [
    {
      Description: 'Marketplace Sales',
      AccountCode: getCode('Sales', mpLabel),
      TaxType: 'OUTPUT',
      UnitAmount: Math.round(settlement.sales_ex_gst * 100) / 100,
      Quantity: 1,
    },
    {
      Description: 'Marketplace Commission',
      AccountCode: getCode('Seller Fees', mpLabel),
      TaxType: 'INPUT',
      UnitAmount: -Math.abs(Math.round(settlement.fees_ex_gst * 100) / 100),
      Quantity: 1,
    },
  ];

  const meta = settlement.metadata || {};

  // Add refunds line if present (negative amount — reduces invoice)
  if (meta.refundsExGst && meta.refundsExGst !== 0) {
    lines.push({
      Description: 'Customer Refunds',
      AccountCode: getCode('Refunds', mpLabel),
      TaxType: 'OUTPUT',
      UnitAmount: Math.round((meta.refundsExGst < 0 ? meta.refundsExGst : -meta.refundsExGst) * 100) / 100,
      Quantity: 1,
    });
  }

  // Add refund on commission (positive — marketplace returns commission on refunded orders)
  if (meta.refundCommissionExGst && meta.refundCommissionExGst !== 0) {
    lines.push({
      Description: 'Commission Refund (on refunded orders)',
      AccountCode: getCode('Seller Fees', mpLabel),
      TaxType: 'INPUT',
      UnitAmount: Math.round(Math.abs(meta.refundCommissionExGst) * 100) / 100,
      Quantity: 1,
    });
  }

  // Add shipping revenue if present
  if (meta.shippingExGst && meta.shippingExGst !== 0) {
    lines.push({
      Description: 'Shipping Revenue',
      AccountCode: getCode('Shipping', mpLabel),
      TaxType: 'OUTPUT',
      UnitAmount: Math.round(meta.shippingExGst * 100) / 100,
      Quantity: 1,
    });
  }

  // Add subscription fee if present
  if (meta.subscriptionAmount && meta.subscriptionAmount !== 0) {
    lines.push({
      Description: 'Marketplace Subscription',
      AccountCode: getCode('Seller Fees', mpLabel),
      TaxType: 'INPUT',
      UnitAmount: Math.round(meta.subscriptionAmount * 100) / 100,
      Quantity: 1,
    });
  }

  // Zero-amount guard: filter out any line with UnitAmount === 0
  return lines.filter(line => Math.round(line.UnitAmount * 100) !== 0);
}

/**
 * Build Xero invoice reference string
 */
export function buildInvoiceReference(settlement: StandardSettlement): string {
  return `Xettle-${settlement.settlement_id}`;
}

export function buildInvoiceDescription(settlement: StandardSettlement): string {
  const label = MARKETPLACE_LABELS[settlement.marketplace] || settlement.marketplace;
  const periodLabel = `${formatSettlementDate(settlement.period_start)} – ${formatSettlementDate(settlement.period_end)}`;
  return `${label} Settlement ${periodLabel}`;
}

// ─── Universal Duplicate Prevention ─────────────────────────────────────────

/**
 * ⚠️ UNIVERSAL RULE — NO EXCEPTIONS:
 * Every insert or upsert into the settlements table MUST call checkForDuplicate() first.
 * This applies to:
 * - Every marketplace (Amazon, Shopify, BigW, MyDeal, Kogan, Bunnings, any future marketplace)
 * - Every source (CSV upload, API sync, manual entry, auto-sync, public demo)
 * - Every function name (saveSettlement, saveAmazonSettlement, or any future variant)
 *
 * If you are adding a new settlement save function, you MUST:
 * 1. Call checkForDuplicate() before insert
 * 2. Register aliases after successful insert via registerAliases()
 * 3. Return { success: false, reason: 'duplicate' } if duplicate detected
 * 4. Never use delete + re-insert to 'update' a settlement
 *
 * Bypassing this check will cause duplicate Xero invoices for paying customers.
 *
 * Post-insert safety: after every insert, postInsertDuplicateCheck() verifies
 * no duplicate was created (catches race conditions or future code that bypasses this).
 */
export async function checkForDuplicate(params: {
  settlementId: string;
  marketplace: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  bankDeposit: number;
}): Promise<{ isDuplicate: boolean; canonicalId?: string; matchMethod?: string }> {
  const { settlementId, marketplace, userId, periodStart, periodEnd, bankDeposit } = params;

  // 1. Exact settlement_id match
  const { data: exactMatch } = await supabase
    .from('settlements')
    .select('settlement_id')
    .eq('settlement_id', settlementId)
    .eq('user_id', userId)
    .eq('marketplace', marketplace)
    .maybeSingle();

  if (exactMatch) {
    return { isDuplicate: true, canonicalId: exactMatch.settlement_id, matchMethod: 'exact_id' };
  }

  // 2. Alias registry match
  const { data: aliasMatch } = await supabase
    .from('settlement_id_aliases' as any)
    .select('canonical_settlement_id')
    .eq('alias_id', settlementId)
    .eq('user_id', userId)
    .maybeSingle();

  if (aliasMatch) {
    const canonical = (aliasMatch as any).canonical_settlement_id;
    // Verify the canonical settlement still exists
    const { data: canonicalExists } = await supabase
      .from('settlements')
      .select('settlement_id')
      .eq('settlement_id', canonical)
      .eq('user_id', userId)
      .eq('marketplace', marketplace)
      .maybeSingle();

    if (canonicalExists) {
      return { isDuplicate: true, canonicalId: canonical, matchMethod: 'alias_registry' };
    }
  }

  // 3. Fingerprint match (marketplace + dates + amount ±$0.05 + settlement_id)
  const { data: fingerprints } = await supabase
    .from('settlements')
    .select('settlement_id, bank_deposit')
    .eq('user_id', userId)
    .eq('marketplace', marketplace)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd);

  if (fingerprints) {
    for (const fp of fingerprints) {
      const existingAmount = parseFloat(String(fp.bank_deposit)) || 0;
      if (Math.abs(existingAmount - bankDeposit) <= 0.05) {
        // Only block if settlement_id matches or is a substring match
        const idsMatch = fp.settlement_id === settlementId
          || fp.settlement_id.includes(settlementId)
          || settlementId.includes(fp.settlement_id);

        if (idsMatch) {
          return { isDuplicate: true, canonicalId: fp.settlement_id, matchMethod: 'fingerprint_amount_date' };
        }

        // Different settlement_id with similar fingerprint — warn but allow
        console.warn(
          `[dedup] Similar fingerprint but different settlement_id: existing=${fp.settlement_id} new=${settlementId} ` +
          `amount_diff=$${Math.abs(existingAmount - bankDeposit).toFixed(2)}`
        );
        try {
          await supabase.from('system_events').insert({
            user_id: userId,
            event_type: 'possible_duplicate_different_id',
            severity: 'warning',
            marketplace_code: marketplace,
            settlement_id: settlementId,
            details: {
              existing_settlement_id: fp.settlement_id,
              new_settlement_id: settlementId,
              existing_amount: existingAmount,
              new_amount: bankDeposit,
              amount_diff: Math.abs(existingAmount - bankDeposit),
              period: `${periodStart} → ${periodEnd}`,
            },
          });
        } catch (_) { /* non-blocking */ }
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Register settlement ID aliases for cross-source dedup.
 * Exported so any settlement save function (including legacy ones) can register aliases.
 */
export async function registerAliases(
  settlementId: string,
  userId: string,
  source: string,
  sourceReference?: string,
): Promise<void> {
  const aliases: Array<{ canonical_settlement_id: string; alias_id: string; user_id: string; source: string }> = [];

  // Always register the settlement_id itself
  aliases.push({
    canonical_settlement_id: settlementId,
    alias_id: settlementId,
    user_id: userId,
    source,
  });

  // Register source_reference as alias if different from settlement_id
  if (sourceReference && sourceReference !== settlementId) {
    aliases.push({
      canonical_settlement_id: settlementId,
      alias_id: sourceReference,
      user_id: userId,
      source,
    });
  }

  for (const alias of aliases) {
    await supabase.from('settlement_id_aliases' as any)
      .upsert(alias as any, { onConflict: 'alias_id,user_id' })
      .then(({ error }) => {
        if (error) console.error('[alias-registry] upsert error:', error);
      });
  }
}

/**
 * Post-insert safety check — catches duplicates created by race conditions
 * or future code that bypasses checkForDuplicate().
 * Fire-and-forget: logs critical alert to system_events if duplicate found.
 */
export async function postInsertDuplicateCheck(
  settlementId: string,
  marketplace: string,
  userId: string,
): Promise<void> {
  try {
    const { data: duplicates } = await supabase
      .from('settlements')
      .select('id, created_at, status')
      .eq('settlement_id', settlementId)
      .eq('user_id', userId)
      .eq('marketplace', marketplace)
      .order('created_at', { ascending: true });

    if (duplicates && duplicates.length > 1) {
      console.error(`[CRITICAL] Duplicate settlement detected post-insert: ${settlementId} (${marketplace}), count=${duplicates.length}`);

      // Keep the oldest record, suppress all newer duplicates
      const toSuppress = duplicates
        .slice(1)
        .filter((d) => d.status !== 'duplicate_suppressed');

      for (const dup of toSuppress) {
        await supabase
          .from('settlements')
          .update({ status: 'duplicate_suppressed' } as any)
          .eq('id', dup.id);
      }

      await supabase.from('system_events' as any).insert({
        user_id: userId,
        event_type: 'critical_duplicate_created',
        marketplace_code: marketplace,
        settlement_id: settlementId,
        details: {
          count: duplicates.length,
          detected_at: new Date().toISOString(),
          suppressed_ids: toSuppress.map((d) => d.id),
        },
        severity: 'critical',
      } as any);
    }
  } catch (err) {
    console.error('[postInsertDuplicateCheck] error:', err);
  }
}

// ─── Save to Database ───────────────────────────────────────────────────────

export interface SaveResult {
  success: boolean;
  error?: string;
  duplicate?: boolean;
}

/**
 * Save a StandardSettlement to the settlements table.
 * Uses universal checkForDuplicate() before insert.
 */
export async function saveSettlement(settlement: StandardSettlement): Promise<SaveResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    // ─── Accounting Boundary Check ──────────────────────────────────
    const { data: boundarySetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'accounting_boundary_date')
      .eq('user_id', user.id)
      .maybeSingle();

    if (boundarySetting?.value && settlement.period_end < boundarySetting.value) {
      // ─── Dedup check applies even for boundary settlements ─────────
      const boundaryDupCheck = await checkForDuplicate({
        settlementId: settlement.settlement_id,
        marketplace: settlement.marketplace,
        userId: user.id,
        periodStart: settlement.period_start,
        periodEnd: settlement.period_end,
        bankDeposit: settlement.net_payout,
      });

      if (boundaryDupCheck.isDuplicate) {
        return { success: false, error: `This settlement already exists (matched by ${boundaryDupCheck.matchMethod}).`, duplicate: true };
      }

      // Save with special status — no Xero entry will be created
      const meta = settlement.metadata || {};
      const { error } = await supabase.from('settlements').insert({
        user_id: user.id,
        settlement_id: settlement.settlement_id,
        marketplace: settlement.marketplace,
        period_start: settlement.period_start,
        period_end: settlement.period_end,
        sales_principal: settlement.sales_ex_gst,
        sales_shipping: meta.shippingExGst || 0,
        seller_fees: Math.abs(settlement.fees_ex_gst),
        refunds: meta.refundsExGst || 0,
        reimbursements: (meta.refundCommissionExGst || 0) + (meta.manualCreditInclGst || 0),
        other_fees: (meta.subscriptionAmount || 0) + (meta.manualDebitInclGst || 0) + (meta.otherChargesInclGst || 0),
        gst_on_income: settlement.gst_on_sales,
        gst_on_expenses: settlement.gst_on_fees,
        bank_deposit: settlement.net_payout,
        source: settlement.source,
        source_reference: meta.sourceReference || null,
        status: 'already_recorded',
        reconciliation_status: 'reconciled',
      } as any);

      if (error) return { success: false, error: error.message };

      // Register aliases + post-insert safety check
      registerAliases(settlement.settlement_id, user.id, settlement.source, meta.sourceReference);
      postInsertDuplicateCheck(settlement.settlement_id, settlement.marketplace, user.id);

      return {
        success: true,
        error: `This period is before your accounting boundary (set: ${boundarySetting.value}). Settlement saved as 'Already Recorded' — no Xero entry will be created.`,
      };
    }

    // ─── Universal Duplicate Check ──────────────────────────────────
    const dupCheck = await checkForDuplicate({
      settlementId: settlement.settlement_id,
      marketplace: settlement.marketplace,
      userId: user.id,
      periodStart: settlement.period_start,
      periodEnd: settlement.period_end,
      bankDeposit: settlement.net_payout,
    });

    if (dupCheck.isDuplicate) {
      // Log duplicate detection to system_events
      supabase.from('system_events' as any).insert({
        user_id: user.id,
        event_type: 'duplicate_blocked',
        marketplace_code: settlement.marketplace,
        settlement_id: settlement.settlement_id,
        details: { canonical_id: dupCheck.canonicalId, match_method: dupCheck.matchMethod, source: settlement.source },
        severity: 'warning',
      } as any).then(({ error: evErr }) => {
        if (evErr) console.error('[system_events] duplicate log error:', evErr);
      });

      return { success: false, error: `This settlement has already been saved (matched by ${dupCheck.matchMethod}).`, duplicate: true };
    }

    const meta = settlement.metadata || {};
    const { error } = await supabase.from('settlements').insert({
      user_id: user.id,
      settlement_id: settlement.settlement_id,
      marketplace: settlement.marketplace,
      period_start: settlement.period_start,
      period_end: settlement.period_end,
      sales_principal: settlement.sales_ex_gst,
      sales_shipping: meta.shippingExGst || 0,
      seller_fees: Math.abs(settlement.fees_ex_gst),
      refunds: meta.refundsExGst || 0,
      reimbursements: (meta.refundCommissionExGst || 0) + (meta.manualCreditInclGst || 0),
      other_fees: (meta.subscriptionAmount || 0) + (meta.manualDebitInclGst || 0) + (meta.otherChargesInclGst || 0),
      gst_on_income: settlement.gst_on_sales,
      gst_on_expenses: settlement.gst_on_fees,
      bank_deposit: settlement.net_payout,
      source: settlement.source,
      source_reference: meta.sourceReference || null,
      status: 'saved',
      reconciliation_status: settlement.reconciles ? 'reconciled' : 'warning',
    } as any);

    // Register aliases + post-insert safety check after successful insert
    if (!error) {
      registerAliases(settlement.settlement_id, user.id, settlement.source, meta.sourceReference);
      postInsertDuplicateCheck(settlement.settlement_id, settlement.marketplace, user.id);
    }

    if (error) return { success: false, error: error.message };

    // Background writes: collect errors into system_events rather than silently dropping
    const bgErrors: string[] = [];

    // Background: upsert marketplace_validation
    const periodLabel = `${settlement.period_start} → ${settlement.period_end}`;
    supabase.from('marketplace_validation' as any).upsert({
      user_id: user.id,
      marketplace_code: settlement.marketplace,
      period_label: periodLabel,
      period_start: settlement.period_start,
      period_end: settlement.period_end,
      settlement_uploaded: true,
      settlement_id: settlement.settlement_id,
      settlement_net: settlement.net_payout,
      settlement_uploaded_at: new Date().toISOString(),
    } as any, { onConflict: 'user_id,marketplace_code,period_label' }).then(({ error: valErr }) => {
      if (valErr) {
        console.error('[marketplace_validation] upsert error:', valErr);
        bgErrors.push(`marketplace_validation: ${valErr.message}`);
      }
    });

    // Background: log system event
    supabase.from('system_events' as any).insert({
      user_id: user.id,
      event_type: 'settlement_saved',
      marketplace_code: settlement.marketplace,
      settlement_id: settlement.settlement_id,
      period_label: periodLabel,
      details: { net_payout: settlement.net_payout, source: settlement.source },
      severity: 'info',
    } as any).then(({ error: evErr }) => {
      if (evErr) console.error('[system_events] insert error:', evErr);
    });

    // Background: extract fee observations for intelligence engine
    import('./fee-observation-engine').then(({ extractFeeObservations }) => {
      extractFeeObservations(settlement, user.id).catch((e) => {
        console.error('[fee-observation-engine] failed:', e);
        bgErrors.push(`fee_observations: ${e.message || e}`);
      });
    });

    // Background: auto-reconcile if Shopify is connected
    import('./marketplace-reconciliation-engine').then(({ autoReconcileSettlement }) => {
      autoReconcileSettlement(
        settlement.marketplace,
        settlement.settlement_id,
        settlement.period_start,
        settlement.period_end,
        settlement.net_payout,
        settlement.fees_ex_gst
      ).catch((e) => {
        console.error('[auto-reconcile] failed:', e);
        bgErrors.push(`auto_reconcile: ${e.message || e}`);
      });
    });

    // Log any accumulated background errors after a short delay
    setTimeout(() => {
      if (bgErrors.length > 0) {
        supabase.from('system_events' as any).insert({
          user_id: user.id,
          event_type: 'background_write_failures',
          marketplace_code: settlement.marketplace,
          settlement_id: settlement.settlement_id,
          details: { errors: bgErrors },
          severity: 'warning',
        } as any).then(({ error: logErr }) => {
          if (logErr) console.error('[background_write_failures] log error:', logErr);
        });
      }
    }, 5000);

    // Fire-and-forget: calculate and persist profit data
    (async () => {
      try {
        const { calculateMarketplaceProfit } = await import('./profit-engine');
        const [linesRes, costsRes] = await Promise.all([
          supabase
            .from('settlement_lines')
            .select('settlement_id, sku, amount, order_id, transaction_type')
            .eq('user_id', user.id)
            .eq('settlement_id', settlement.settlement_id),
          supabase
            .from('product_costs')
            .select('sku, cost, currency, label')
            .eq('user_id', user.id),
        ]);

        const profitInput = {
          settlement_id: settlement.settlement_id,
          marketplace: settlement.marketplace,
          gross_amount: Math.abs(settlement.sales_ex_gst || 0),
          fees_amount: Math.abs(settlement.fees_ex_gst || 0),
          period_start: settlement.period_start,
          period_end: settlement.period_end,
        };

        const periodLabel = `${settlement.period_start} → ${settlement.period_end}`;
        const profit = calculateMarketplaceProfit(
          settlement.marketplace,
          periodLabel,
          profitInput,
          (linesRes.data || []) as any,
          (costsRes.data || []) as any,
        );

        await supabase.from('settlement_profit').upsert({
          user_id: user.id,
          settlement_id: settlement.settlement_id,
          marketplace_code: profit.marketplace_code,
          period_label: profit.period_label,
          gross_revenue: profit.gross_revenue,
          total_cogs: profit.total_cogs,
          marketplace_fees: profit.marketplace_fees,
          gross_profit: profit.gross_profit,
          margin_percent: profit.margin_percent,
          orders_count: profit.orders_count,
          units_sold: profit.units_sold,
          uncosted_sku_count: profit.uncosted_sku_count,
          uncosted_revenue: profit.uncosted_revenue,
          calculated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,marketplace_code,settlement_id' });
      } catch (e) {
        console.error('[profit-engine] fire-and-forget failed:', e);
      }
    })();

    // Fire-and-forget: trigger validation sweep
    triggerValidationSweep();

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── Sync to Xero ───────────────────────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  error?: string;
}

/**
 * Push a settlement to Xero as an invoice using the sync-settlement-to-xero edge function.
 * For simple marketplaces (Bunnings, Catch, etc.) uses the 2-line invoice model.
 * Amazon uses its own multi-line logic in AccountingDashboard.
 */
export async function syncSettlementToXero(
  settlementId: string,
  marketplace: string,
  options?: {
    lineItems?: XeroLineItem[];
    reference?: string;
    contactName?: string;
  }
): Promise<SyncResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    // Get settlement from DB
    const { data: settlement, error: fetchErr } = await supabase
      .from('settlements')
      .select('*')
      .eq('settlement_id', settlementId)
      .eq('user_id', user.id)
      .eq('marketplace', marketplace)
      .single();

    if (fetchErr || !settlement) return { success: false, error: 'Settlement not found' };

    const s = settlement as any;
    const contactName = options?.contactName || MARKETPLACE_CONTACTS[marketplace] || `${marketplace} Marketplace`;
    
    // Reference is now generated server-side from settlementId
    const reference = `Xettle-${s.settlement_id}`; // For local display/logging only
    const periodLabel = `${formatSettlementDate(s.period_start)} – ${formatSettlementDate(s.period_end)}`;
    const label = MARKETPLACE_LABELS[marketplace] || marketplace;
    const description = `${label} Settlement ${periodLabel}`;

    // Build line items (use provided or default 2-line with user account code overrides)
    let lineItems = options?.lineItems;
    if (!lineItems) {
      const getCode = await loadUserAccountCodes();
      lineItems = [
        {
          Description: 'Marketplace Sales',
          AccountCode: getCode('Sales'),
          TaxType: 'OUTPUT',
          UnitAmount: Math.round(s.sales_principal * 100) / 100,
          Quantity: 1,
        },
        {
          Description: 'Marketplace Commission',
          AccountCode: getCode('Seller Fees'),
          TaxType: 'INPUT',
          UnitAmount: -Math.abs(Math.round(s.seller_fees * 100) / 100),
          Quantity: 1,
        },
      ];
    }

    // Zero-amount guard: filter out lines with UnitAmount === 0
    lineItems = lineItems.filter((li: XeroLineItem) => Math.round(li.UnitAmount * 100) !== 0);

    // If all lines are zero, skip the push and log event
    if (lineItems.length === 0) {
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'push_skipped_zero_amount',
        marketplace_code: marketplace,
        settlement_id: settlementId,
        severity: 'warning',
        details: { reason: 'All line items had zero amounts after filtering' },
      } as any);
      return { success: false, error: 'All line items are zero — nothing to push to Xero' };
    }

    // Calculate net amount for negative settlement detection (ACCPAY vs ACCREC)
    const netAmount = (s.bank_deposit || 0);

    const { data: result, error: fnErr } = await supabase.functions.invoke('sync-settlement-to-xero', {
      body: {
        userId: user.id,
        action: 'create',
        reference,
        description,
        date: s.period_end,
        dueDate: s.period_end,
        lineItems,
        contactName,
        netAmount,
      },
    });

    if (fnErr) return { success: false, error: fnErr.message };
    if (!result?.success) return { success: false, error: result?.error || 'Xero push failed' };

    // Update settlement status with invoice number and xero_type
    await supabase
      .from('settlements')
      .update({
        status: 'pushed_to_xero',
        xero_journal_id: result.invoiceId,
        xero_invoice_number: result.invoiceNumber || null,
        xero_status: 'AUTHORISED',
        xero_type: result.xeroType || 'invoice',
      } as any)
      .eq('settlement_id', settlementId)
      .eq('user_id', user.id);

    // Fire-and-forget: update marketplace_validation with Xero push
    const { data: settlementRow } = await supabase
      .from('settlements')
      .select('period_start, period_end, marketplace')
      .eq('settlement_id', settlementId)
      .eq('user_id', user.id)
      .single();

    if (settlementRow) {
      const s2 = settlementRow as any;
      const periodLabel = `${s2.period_start} → ${s2.period_end}`;
      supabase.from('marketplace_validation' as any).upsert({
        user_id: user.id,
        marketplace_code: marketplace,
        period_label: periodLabel,
        period_start: s2.period_start,
        period_end: s2.period_end,
        xero_pushed: true,
        xero_invoice_id: result.invoiceId,
        xero_pushed_at: new Date().toISOString(),
      } as any, { onConflict: 'user_id,marketplace_code,period_label' }).then(({ error: valErr }) => {
        if (valErr) console.error('[marketplace_validation] xero upsert error:', valErr);
      });
    }

    // Fire-and-forget: trigger validation sweep after Xero push
    triggerValidationSweep();

    // Fire-and-forget: trigger bank deposit matching after Xero push
    triggerBankMatch(settlementId);

    // Fire-and-forget: log Xero push event
    supabase.from('system_events' as any).insert({
      user_id: user.id,
      event_type: 'xero_push_success',
      marketplace_code: marketplace,
      settlement_id: settlementId,
      details: { invoice_id: result.invoiceId, invoice_number: result.invoiceNumber },
      severity: 'info',
    } as any).then(({ error: evErr }) => {
      if (evErr) console.error('[system_events] xero push log error:', evErr);
    });

    return { success: true, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber };
  } catch (err: any) {
    // Mark push_failed in DB
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('settlements')
          .update({ status: 'push_failed' } as any)
          .eq('settlement_id', settlementId)
          .eq('user_id', user.id);
      }
    } catch { /* ignore */ }
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── Rollback (Void) Xero Invoice ───────────────────────────────────────────

export interface RollbackResult {
  success: boolean;
  error?: string;
}

export async function rollbackSettlementFromXero(
  settlementId: string,
  marketplace: string,
  invoiceIds: string[],
  rollbackScope: 'all' | 'journal_1' | 'journal_2' = 'all'
): Promise<RollbackResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data: result, error: fnErr } = await supabase.functions.invoke('sync-settlement-to-xero', {
      body: {
        userId: user.id,
        action: 'rollback',
        invoiceIds,
        settlementId,
        rollbackScope,
      },
    });

    if (fnErr) return { success: false, error: fnErr.message };
    if (!result?.success) return { success: false, error: result?.error || 'Rollback failed' };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── Delete Settlement ──────────────────────────────────────────────────────

export async function deleteSettlement(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Look up the settlement_id (text) so we can clean related tables
    const { data: row } = await supabase.from('settlements').select('settlement_id, user_id').eq('id', id).single();
    if (row) {
      await supabase.from('settlement_lines').delete().eq('settlement_id', row.settlement_id).eq('user_id', row.user_id);
      await supabase.from('settlement_unmapped').delete().eq('settlement_id', row.settlement_id).eq('user_id', row.user_id);
    }
    const { error } = await supabase.from('settlements').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Xero Sync Back ─────────────────────────────────────────────────────────

export async function syncXeroStatus(): Promise<{ success: boolean; updated?: number; fuzzy_matched?: number; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await supabase.functions.invoke('sync-xero-status', {
      body: { userId: user.id },
    });

    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'Sync failed' };
    return { success: true, updated: data.updated || 0, fuzzy_matched: data.fuzzy_matched || 0 };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── Validation Sweep Trigger ────────────────────────────────────────────────

/**
 * Fire-and-forget trigger for the validation sweep edge function.
 * Called after settlement save, Xero push, Shopify connect, or boundary confirmation.
 */
export async function triggerValidationSweep(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    fetch(
      `https://${projectId}.supabase.co/functions/v1/run-validation-sweep`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      }
    ).catch(console.error);
  } catch {
    // fire-and-forget
  }
}

// ─── Bank Match Trigger ─────────────────────────────────────────────────────

/**
 * Fire-and-forget trigger for bank deposit matching after Xero push.
 */
export async function triggerBankMatch(settlementId?: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    fetch(
      `https://${projectId}.supabase.co/functions/v1/match-bank-deposits`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(settlementId ? { settlementId } : {}),
      }
    ).catch(console.error);
  } catch {
    // fire-and-forget
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function formatSettlementDate(d: string): string {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatAUD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}
