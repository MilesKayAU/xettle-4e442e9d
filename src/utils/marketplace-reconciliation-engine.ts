/**
 * Marketplace Reconciliation Engine — Phase 2
 * Compares Shopify order totals against marketplace settlement amounts.
 * Data layer only — no UI.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopifyOrder {
  id: string;
  order_number?: string;
  name?: string;
  total_price: number;
  created_at: string;
  marketplace_code: string | null;
}

export interface Settlement {
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  /** Net amount received (bank_deposit) */
  net_amount: number;
  /** Marketplace fees (seller_fees — typically negative) */
  fees_amount: number;
}

export interface ReconciliationResult {
  marketplace_code: string;
  period_label: string;
  period_start: Date;
  period_end: Date;
  shopify_order_total: number;
  settlement_net_received: number;
  expected_commission: number;
  actual_commission: number;
  difference: number;
  difference_percent: number;
  status: 'matched' | 'warning' | 'alert' | 'pending';
  unmatched_orders: string[];
  notes: string;
  reconciliation_confidence: number;
  reconciliation_confidence_reason: string;
}

// ─── Core Calculation ───────────────────────────────────────────────────────

/**
 * Calculate reconciliation between Shopify orders and a marketplace settlement.
 */
export async function calculateReconciliation(
  marketplaceCode: string,
  periodLabel: string,
  periodStart: Date,
  periodEnd: Date,
  shopifyOrders: ShopifyOrder[],
  settlement: Settlement
): Promise<ReconciliationResult> {
  // 1. Sum Shopify orders in period for this marketplace
  const ordersInPeriod = shopifyOrders.filter(o => {
    const orderDate = new Date(o.created_at);
    return (
      orderDate >= periodStart &&
      orderDate <= periodEnd &&
      o.marketplace_code === marketplaceCode
    );
  });

  const shopify_order_total = round2(
    ordersInPeriod.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0)
  );

  // 2. Settlement figures
  const settlement_net_received = round2(Number(settlement.net_amount) || 0);
  const actual_commission = round2(Math.abs(Number(settlement.fees_amount) || 0));

  // 3. Expected commission — try fee observations first, else derive
  let expected_commission: number;
  const observedRate = await getAverageObservedFeeRate(marketplaceCode);

  if (observedRate !== null && shopify_order_total > 0) {
    expected_commission = round2(shopify_order_total * observedRate);
  } else {
    // Derive: expected_commission = orders - net received
    expected_commission = round2(
      shopify_order_total > 0
        ? shopify_order_total - settlement_net_received
        : 0
    );
  }

  // 4. Difference
  const difference = round2(
    settlement_net_received - (shopify_order_total - expected_commission)
  );

  const difference_percent =
    shopify_order_total > 0
      ? round2((Math.abs(difference) / shopify_order_total) * 100)
      : 0;

  // 5. Status
  let status: ReconciliationResult['status'];
  if (shopify_order_total === 0) {
    status = 'pending';
  } else if (Math.abs(difference) === 0) {
    status = 'matched';
  } else if (Math.abs(difference) < 10) {
    status = 'warning';
  } else {
    status = 'alert';
  }

  // 6. Unmatched orders — orders not referenced in settlement_lines
  const unmatched_orders = await findUnmatchedOrders(
    ordersInPeriod,
    settlement.settlement_id
  );

  // 7. Reconciliation confidence
  let reconciliation_confidence = 0.5;
  let reconciliation_confidence_reason = '';

  if (shopify_order_total === 0) {
    reconciliation_confidence = 0.5;
    reconciliation_confidence_reason = 'No Shopify orders found for comparison';
  } else if (Math.abs(difference) === 0) {
    reconciliation_confidence = 1.0;
    reconciliation_confidence_reason = `Exact match — ${ordersInPeriod.length} orders fully reconciled`;
  } else if (Math.abs(difference) <= 1) {
    reconciliation_confidence = 0.9;
    reconciliation_confidence_reason = `$${Math.abs(difference).toFixed(2)} rounding difference — likely GST`;
  } else if (Math.abs(difference) < 10) {
    reconciliation_confidence = 0.8;
    reconciliation_confidence_reason = `$${Math.abs(difference).toFixed(2)} minor difference — ${ordersInPeriod.length} orders matched`;
  } else if (unmatched_orders.length > 0 && Math.abs(difference) < 50) {
    reconciliation_confidence = 0.7;
    reconciliation_confidence_reason = `$${Math.abs(difference).toFixed(2)} gap with ${unmatched_orders.length} unmatched orders`;
  } else {
    reconciliation_confidence = 0.3;
    reconciliation_confidence_reason = `$${Math.abs(difference).toFixed(2)} gap — possible returns pending`;
  }

  // Build notes
  const notesParts: string[] = [];
  if (observedRate !== null) {
    notesParts.push(`Using observed fee rate: ${(observedRate * 100).toFixed(1)}%`);
  } else {
    notesParts.push('No fee observations — commission derived from difference');
  }
  if (unmatched_orders.length > 0) {
    notesParts.push(`${unmatched_orders.length} unmatched order(s)`);
  }

  return {
    marketplace_code: marketplaceCode,
    period_label: periodLabel,
    period_start: periodStart,
    period_end: periodEnd,
    shopify_order_total,
    settlement_net_received,
    expected_commission,
    actual_commission,
    difference,
    difference_percent,
    status,
    unmatched_orders,
    notes: notesParts.join('. '),
    reconciliation_confidence,
    reconciliation_confidence_reason,
  };
}

// ─── Save to DB (Upsert) ───────────────────────────────────────────────────

/**
 * Save a ReconciliationResult to the reconciliation_checks table.
 * Uses UPSERT on (user_id, marketplace_code, period_label).
 */
export async function saveReconciliationResult(
  result: ReconciliationResult
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const row: Record<string, any> = {
      user_id: user.id,
      marketplace_code: result.marketplace_code,
      period_label: result.period_label,
      period_start: formatDate(result.period_start),
      period_end: formatDate(result.period_end),
      shopify_order_total: result.shopify_order_total,
      settlement_net_received: result.settlement_net_received,
      expected_commission: result.expected_commission,
      actual_commission: result.actual_commission,
      difference: result.difference,
      status: result.status,
      notes: result.notes,
      unmatched_orders: result.unmatched_orders,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('reconciliation_checks')
      .upsert(row as any, {
        onConflict: 'user_id,marketplace_code,period_label',
      });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Auto-trigger helper (called from settlement-engine) ────────────────────

/**
 * Automatically run reconciliation for a settlement if Shopify is connected.
 * Fire-and-forget — errors are logged, not thrown.
 */
export async function autoReconcileSettlement(
  marketplace: string,
  settlementId: string,
  periodStart: string,
  periodEnd: string,
  netPayout: number,
  feesAmount: number
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check if Shopify is connected
    const { data: tokens } = await supabase
      .from('shopify_tokens')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    if (!tokens || tokens.length === 0) return; // No Shopify — skip

    // Load Shopify orders for this period from settlements table
    // (orders are stored as settlements with marketplace like shopify_orders_*)
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const { data: orderSettlements } = await supabase
      .from('settlement_lines')
      .select('order_id, amount, posted_date, marketplace_name')
      .eq('user_id', user.id)
      .gte('posted_date', periodStart)
      .lte('posted_date', periodEnd);

    // Build ShopifyOrder-compatible objects from settlement lines
    // Group by order_id to get order totals
    const orderMap = new Map<string, ShopifyOrder>();
    for (const line of orderSettlements || []) {
      if (!line.order_id) continue;
      const existing = orderMap.get(line.order_id);
      if (existing) {
        existing.total_price += Number(line.amount) || 0;
      } else {
        orderMap.set(line.order_id, {
          id: line.order_id,
          total_price: Number(line.amount) || 0,
          created_at: line.posted_date || periodStart,
          marketplace_code: marketplace,
        });
      }
    }

    const orders = Array.from(orderMap.values());
    if (orders.length === 0) return; // No order data to reconcile

    const periodLabel = `${periodStart} to ${periodEnd}`;
    const settlement: Settlement = {
      settlement_id: settlementId,
      marketplace,
      period_start: periodStart,
      period_end: periodEnd,
      net_amount: netPayout,
      fees_amount: feesAmount,
    };

    const result = await calculateReconciliation(
      marketplace,
      periodLabel,
      start,
      end,
      orders,
      settlement
    );

    await saveReconciliationResult(result);

    // Fire-and-forget: update marketplace_validation with reconciliation result
    supabase.from('marketplace_validation' as any).upsert({
      user_id: user.id,
      marketplace_code: marketplace,
      period_label: periodLabel,
      period_start: periodStart,
      period_end: periodEnd,
      reconciliation_status: result.status,
      reconciliation_difference: result.difference,
      reconciliation_confidence: result.reconciliation_confidence,
      reconciliation_confidence_reason: result.reconciliation_confidence_reason,
    } as any, { onConflict: 'user_id,marketplace_code,period_label' }).then(({ error: valErr }) => {
      if (valErr) console.error('[marketplace_validation] recon upsert error:', valErr);
    });
  } catch (err) {
    console.error('[autoReconcileSettlement] Error:', err);
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function getAverageObservedFeeRate(
  marketplaceCode: string
): Promise<number | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from('marketplace_fee_observations')
      .select('observed_rate')
      .eq('user_id', user.id)
      .eq('marketplace_code', marketplaceCode)
      .eq('fee_type', 'commission')
      .not('observed_rate', 'is', null);

    if (!data || data.length === 0) return null;

    const rates = data.map(d => Number(d.observed_rate)).filter(r => r > 0);
    if (rates.length === 0) return null;

    return rates.reduce((a, b) => a + b, 0) / rates.length;
  } catch {
    return null;
  }
}

async function findUnmatchedOrders(
  orders: ShopifyOrder[],
  settlementId: string
): Promise<string[]> {
  if (orders.length === 0) return [];

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: lines } = await supabase
      .from('settlement_lines')
      .select('order_id, amount_description')
      .eq('user_id', user.id)
      .eq('settlement_id', settlementId);

    // Build a set of all identifiers found in settlement lines
    const matchedIds = new Set<string>();
    for (const line of lines || []) {
      if (line.order_id) {
        matchedIds.add(line.order_id.toLowerCase());
        // Also add without # prefix
        matchedIds.add(line.order_id.replace(/^#/, '').toLowerCase());
      }
      // Check description for order references
      if (line.amount_description) {
        const desc = line.amount_description.toLowerCase();
        matchedIds.add(desc);
      }
    }

    return orders
      .filter(o => {
        const id = (o.id || '').toLowerCase();
        const name = (o.name || '').toLowerCase();
        const nameNoHash = name.replace(/^#/, '');
        const orderNum = (o.order_number || '').toLowerCase();
        // Check if any identifier appears in the matched set or in any description
        return (
          !matchedIds.has(id) &&
          !matchedIds.has(name) &&
          !matchedIds.has(nameNoHash) &&
          !matchedIds.has(orderNum) &&
          // Also check if order number appears within any description text
          ![...matchedIds].some(mid => mid.includes(nameNoHash) || mid.includes(orderNum))
        );
      })
      .map(o => o.name || o.order_number || o.id);
  } catch {
    return [];
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}
