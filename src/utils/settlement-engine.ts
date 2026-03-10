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
  ebay: 'eBay',
  etsy: 'Etsy',
  paypal: 'PayPal',
  manual_orders: 'Manual Orders',
  theiconic: 'The Iconic',
  // Composite codes from parsers
  woolworths_marketplus_bigw: 'Big W',
  woolworths_marketplus_woolworths: 'Everyday Market',
  woolworths_marketplus_mydeal: 'MyDeal',
  woolworths_marketplus_everyday_market: 'Everyday Market',
};

// ─── Xero Invoice Line Builder ──────────────────────────────────────────────

export interface XeroLineItem {
  Description: string;
  AccountCode: string;
  TaxType: string;
  UnitAmount: number;
  Quantity: number;
}

/**
 * Build standard 2-line Xero invoice from a StandardSettlement.
 * Line 1: Marketplace Sales (Account 200, GST on Income)
 * Line 2: Marketplace Fees (Account 407, GST on Expenses)
 * 
 * For Amazon, the AccountingDashboard builds its own multi-line invoices
 * due to the complexity of FBA fees, storage, refunds, etc.
 */
export function buildSimpleInvoiceLines(settlement: StandardSettlement): XeroLineItem[] {
  const lines: XeroLineItem[] = [
    {
      Description: 'Marketplace Sales',
      AccountCode: '200',
      TaxType: 'OUTPUT',
      UnitAmount: Math.round(settlement.sales_ex_gst * 100) / 100,
      Quantity: 1,
    },
    {
      Description: 'Marketplace Commission',
      AccountCode: '407',
      TaxType: 'INPUT',
      UnitAmount: Math.round(settlement.fees_ex_gst * 100) / 100,
      Quantity: 1,
    },
  ];

  const meta = settlement.metadata || {};

  // Add refunds line if present (negative amount — reduces invoice)
  if (meta.refundsExGst && meta.refundsExGst !== 0) {
    lines.push({
      Description: 'Customer Refunds',
      AccountCode: '200',
      TaxType: 'OUTPUT',
      UnitAmount: Math.round((meta.refundsExGst < 0 ? meta.refundsExGst : -meta.refundsExGst) * 100) / 100,
      Quantity: 1,
    });
  }

  // Add refund on commission (positive — marketplace returns commission on refunded orders)
  if (meta.refundCommissionExGst && meta.refundCommissionExGst !== 0) {
    lines.push({
      Description: 'Commission Refund (on refunded orders)',
      AccountCode: '407',
      TaxType: 'INPUT',
      UnitAmount: Math.round(Math.abs(meta.refundCommissionExGst) * 100) / 100,
      Quantity: 1,
    });
  }

  // Add shipping revenue if present
  if (meta.shippingExGst && meta.shippingExGst !== 0) {
    lines.push({
      Description: 'Shipping Revenue',
      AccountCode: '200',
      TaxType: 'OUTPUT',
      UnitAmount: Math.round(meta.shippingExGst * 100) / 100,
      Quantity: 1,
    });
  }

  // Add subscription fee if present
  if (meta.subscriptionAmount && meta.subscriptionAmount !== 0) {
    lines.push({
      Description: 'Marketplace Subscription',
      AccountCode: '407',
      TaxType: 'INPUT',
      UnitAmount: Math.round(meta.subscriptionAmount * 100) / 100,
      Quantity: 1,
    });
  }

  return lines;
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

// ─── Save to Database ───────────────────────────────────────────────────────

export interface SaveResult {
  success: boolean;
  error?: string;
  duplicate?: boolean;
}

/**
 * Save a StandardSettlement to the settlements table.
 * Checks for duplicates first.
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
        seller_fees: settlement.fees_ex_gst,
        refunds: meta.refundsExGst || 0,
        reimbursements: (meta.refundCommissionExGst || 0) + (meta.manualCreditInclGst || 0),
        other_fees: (meta.subscriptionAmount || 0) + (meta.manualDebitInclGst || 0) + (meta.otherChargesInclGst || 0),
        gst_on_income: settlement.gst_on_sales,
        gst_on_expenses: settlement.gst_on_fees,
        bank_deposit: settlement.net_payout,
        source: settlement.source,
        status: 'already_recorded',
        reconciliation_status: 'reconciled',
      } as any);

      if (error) return { success: false, error: error.message };
      return {
        success: true,
        error: `This period is before your accounting boundary (set: ${boundarySetting.value}). Settlement saved as 'Already Recorded' — no Xero entry will be created.`,
      };
    }

    // Check for duplicate
    const { data: existing } = await supabase
      .from('settlements')
      .select('id')
      .eq('settlement_id', settlement.settlement_id)
      .eq('user_id', user.id)
      .eq('marketplace', settlement.marketplace)
      .maybeSingle();

    if (existing) {
      return { success: false, error: 'This settlement has already been saved.', duplicate: true };
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
      seller_fees: settlement.fees_ex_gst,
      refunds: meta.refundsExGst || 0,
      reimbursements: (meta.refundCommissionExGst || 0) + (meta.manualCreditInclGst || 0),
      other_fees: (meta.subscriptionAmount || 0) + (meta.manualDebitInclGst || 0) + (meta.otherChargesInclGst || 0),
      gst_on_income: settlement.gst_on_sales,
      gst_on_expenses: settlement.gst_on_fees,
      bank_deposit: settlement.net_payout,
      source: settlement.source,
      status: 'saved',
      reconciliation_status: settlement.reconciles ? 'reconciled' : 'warning',
    } as any);

    if (error) return { success: false, error: error.message };

    // Fire-and-forget: upsert marketplace_validation
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
      if (valErr) console.error('[marketplace_validation] upsert error:', valErr);
    });

    // Fire-and-forget: log system event
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

    // Fire-and-forget: extract fee observations for intelligence engine
    import('./fee-observation-engine').then(({ extractFeeObservations }) => {
      extractFeeObservations(settlement, user.id).catch(console.error);
    });

    // Fire-and-forget: auto-reconcile if Shopify is connected
    import('./marketplace-reconciliation-engine').then(({ autoReconcileSettlement }) => {
      autoReconcileSettlement(
        settlement.marketplace,
        settlement.settlement_id,
        settlement.period_start,
        settlement.period_end,
        settlement.net_payout,
        settlement.fees_ex_gst
      ).catch(console.error);
    });

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
    
    // Build reference — new format: Xettle-{settlement_id}
    const reference = options?.reference || `Xettle-${s.settlement_id}`;
    const periodLabel = `${formatSettlementDate(s.period_start)} – ${formatSettlementDate(s.period_end)}`;
    const label = MARKETPLACE_LABELS[marketplace] || marketplace;
    const description = `${label} Settlement ${periodLabel}`;

    // Build line items (use provided or default 2-line)
    const lineItems = options?.lineItems || [
      {
        Description: 'Marketplace Sales',
        AccountCode: '200',
        TaxType: 'OUTPUT',
        UnitAmount: Math.round(s.sales_principal * 100) / 100,
        Quantity: 1,
      },
      {
        Description: 'Marketplace Commission',
        AccountCode: '407',
        TaxType: 'INPUT',
        UnitAmount: Math.round(s.seller_fees * 100) / 100,
        Quantity: 1,
      },
    ];

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
        status: 'synced',
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
    const { error } = await supabase.from('settlements').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Xero Sync Back ─────────────────────────────────────────────────────────

export async function syncXeroStatus(): Promise<{ success: boolean; updated?: number; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { data, error } = await supabase.functions.invoke('sync-xero-status', {
      body: { userId: user.id },
    });

    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error || 'Sync failed' };
    return { success: true, updated: data.updated || 0 };
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
