/**
 * Canonical Xero Invoice Actions
 * 
 * ALL client-side calls to fetch-xero-invoice and rescan-xero-invoice-match
 * MUST go through these functions. No component may invoke these edge functions directly.
 * 
 * Tables written: xero_invoice_cache, xero_accounting_matches, system_events (via edge fns)
 * Idempotency: upsert (user_id, xero_invoice_id) for cache; upsert for matches
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface XeroInvoiceDetail {
  xero_invoice_id: string;
  xero_invoice_number: string | null;
  status: string | null;
  date: string | null;
  due_date: string | null;
  contact_name: string | null;
  currency_code: string | null;
  total: number | null;
  sub_total: number | null;
  total_tax: number | null;
  reference: string | null;
  line_items: XeroLineItem[];
  fetched_at: string;
}

export interface XeroLineItem {
  description: string;
  account_code: string;
  tax_type: string;
  unit_amount: number;
  quantity: number;
  line_amount: number;
  tax_amount: number;
  tracking: any[];
}

export interface RefreshResult {
  success: boolean;
  cached?: boolean;
  invoice?: XeroInvoiceDetail;
  error?: string;
}

export interface RescanResult {
  success: boolean;
  matched: boolean;
  settlement_id: string | null;
  match_method: string | null;
  confidence: number | null;
  evidence: string | null;
  error?: string;
}

export interface PayloadDiffResult {
  xeroSide: {
    status: string | null;
    currency: string | null;
    total: number | null;
    sub_total: number | null;
    total_tax: number | null;
    reference: string | null;
    line_items: XeroLineItem[];
  } | null;
  xettleSide: {
    status: string;
    currency: string;
    total: number;
    reference: string;
    line_items: Array<{
      description: string;
      account_code: string;
      tax_type: string;
      amount: number;
    }>;
  } | null;
  differences: PayloadDifference[];
}

export interface PayloadDifference {
  field: string;
  xero_value: any;
  xettle_value: any;
  severity: 'info' | 'warning' | 'error';
}

// ─── Refresh Invoice Details ─────────────────────────────────────────────────

/**
 * Fetch a single invoice from Xero and cache it.
 * Respects 30s cooldown (server-enforced).
 */
export async function refreshXeroInvoiceDetails(xeroInvoiceId: string): Promise<RefreshResult> {
  const { data, error } = await supabase.functions.invoke('fetch-xero-invoice', {
    body: { xeroInvoiceId },
  });

  if (error) return { success: false, error: error.message };
  if (data?.error) return { success: false, error: data.error };

  return {
    success: true,
    cached: data?.cached || false,
    invoice: data?.invoice || undefined,
  };
}

// ─── Rescan Match ────────────────────────────────────────────────────────────

/**
 * Re-scan settlement match for a single Xero invoice.
 * Uses deterministic reference matching first, then heuristic fallback.
 */
export async function rescanMatchForInvoice(xeroInvoiceId: string): Promise<RescanResult> {
  const { data, error } = await supabase.functions.invoke('rescan-xero-invoice-match', {
    body: { xeroInvoiceId },
  });

  if (error) return { success: false, matched: false, settlement_id: null, match_method: null, confidence: null, evidence: null, error: error.message };
  if (data?.error) return { success: false, matched: false, settlement_id: null, match_method: null, confidence: null, evidence: null, error: data.error };

  return {
    success: true,
    matched: data?.matched || false,
    settlement_id: data?.settlement_id || null,
    match_method: data?.match_method || null,
    confidence: data?.confidence || null,
    evidence: data?.evidence || null,
  };
}

// ─── Compare Xero vs Xettle Payload ──────────────────────────────────────────

/**
 * Build a diff between cached Xero invoice and what Xettle would post for the settlement.
 * This is a client-side comparison using cached data — no Xero API calls.
 */
export async function getXeroVsXettlePayloadDiff(
  settlementId: string,
  xeroInvoiceId: string,
): Promise<PayloadDiffResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { xeroSide: null, xettleSide: null, differences: [] };

  // Fetch both in parallel
  const [cacheRes, settlementRes] = await Promise.all([
    supabase
      .from('xero_invoice_cache')
      .select('*')
      .eq('user_id', user.id)
      .eq('xero_invoice_id', xeroInvoiceId)
      .maybeSingle(),
    supabase
      .from('settlements')
      .select('*')
      .eq('user_id', user.id)
      .eq('settlement_id', settlementId)
      .maybeSingle(),
  ]);

  const cached = cacheRes.data;
  const settlement = settlementRes.data;

  // Build Xero side
  const xeroSide = cached ? {
    status: cached.status,
    currency: cached.currency_code,
    total: cached.total,
    sub_total: cached.sub_total,
    total_tax: cached.total_tax,
    reference: cached.reference,
    line_items: (cached.line_items as XeroLineItem[]) || [],
  } : null;

  // Build Xettle side (what we would send)
  const xettleSide = settlement ? buildXettlePreviewPayload(settlement) : null;

  // Compute differences
  const differences: PayloadDifference[] = [];

  if (xeroSide && xettleSide) {
    // Total comparison
    if (xeroSide.total != null && Math.abs((xeroSide.total || 0) - xettleSide.total) > 0.01) {
      differences.push({
        field: 'Total',
        xero_value: xeroSide.total,
        xettle_value: xettleSide.total,
        severity: Math.abs((xeroSide.total || 0) - xettleSide.total) > 1 ? 'error' : 'warning',
      });
    }

    // Currency
    if (xeroSide.currency && xeroSide.currency !== xettleSide.currency) {
      differences.push({ field: 'Currency', xero_value: xeroSide.currency, xettle_value: xettleSide.currency, severity: 'error' });
    }

    // Status
    if (xeroSide.status && xeroSide.status !== xettleSide.status) {
      differences.push({ field: 'Status', xero_value: xeroSide.status, xettle_value: xettleSide.status, severity: 'info' });
    }

    // Reference
    if (xeroSide.reference && xeroSide.reference !== xettleSide.reference) {
      differences.push({ field: 'Reference', xero_value: xeroSide.reference, xettle_value: xettleSide.reference, severity: 'info' });
    }

    // Line item count
    if (xeroSide.line_items.length !== xettleSide.line_items.length) {
      differences.push({ field: 'Line item count', xero_value: xeroSide.line_items.length, xettle_value: xettleSide.line_items.length, severity: 'warning' });
    }

    // Tax type comparison (aggregate)
    const xeroTaxTypes = new Set(xeroSide.line_items.map(l => l.tax_type));
    const xettleTaxTypes = new Set(xettleSide.line_items.map(l => l.tax_type));
    const missingTax = [...xettleTaxTypes].filter(t => !xeroTaxTypes.has(t));
    const extraTax = [...xeroTaxTypes].filter(t => !xettleTaxTypes.has(t));
    if (missingTax.length || extraTax.length) {
      differences.push({
        field: 'Tax types',
        xero_value: [...xeroTaxTypes].join(', '),
        xettle_value: [...xettleTaxTypes].join(', '),
        severity: 'warning',
      });
    }

    // Account code comparison
    const xeroAccounts = new Set(xeroSide.line_items.map(l => l.account_code).filter(Boolean));
    const xettleAccounts = new Set(xettleSide.line_items.map(l => l.account_code).filter(Boolean));
    const missingAccounts = [...xettleAccounts].filter(a => !xeroAccounts.has(a));
    if (missingAccounts.length) {
      differences.push({
        field: 'Account codes',
        xero_value: [...xeroAccounts].join(', '),
        xettle_value: [...xettleAccounts].join(', '),
        severity: 'warning',
      });
    }
  }

  return { xeroSide, xettleSide, differences };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildXettlePreviewPayload(settlement: any) {
  const categories = [
    { name: 'Sales (Principal)', field: 'sales_principal', taxType: 'OUTPUT', code: '200' },
    { name: 'Shipping Revenue', field: 'sales_shipping', taxType: 'OUTPUT', code: '206' },
    { name: 'Promotional Discounts', field: 'promotional_discounts', taxType: 'OUTPUT', code: '200' },
    { name: 'Refunds', field: 'refunds', taxType: 'OUTPUT', code: '205' },
    { name: 'Reimbursements', field: 'reimbursements', taxType: 'BASEXCLUDED', code: '271' },
    { name: 'Seller Fees', field: 'seller_fees', taxType: 'INPUT', code: '407' },
    { name: 'FBA Fees', field: 'fba_fees', taxType: 'INPUT', code: '408' },
    { name: 'Storage Fees', field: 'storage_fees', taxType: 'INPUT', code: '409' },
    { name: 'Advertising', field: 'advertising_costs', taxType: 'INPUT', code: '410' },
    { name: 'Other Fees', field: 'other_fees', taxType: 'INPUT', code: '405' },
  ];

  const lineItems = categories
    .map(c => ({
      description: c.name,
      account_code: c.code,
      tax_type: c.taxType,
      amount: Math.round((settlement[c.field] || 0) * 100) / 100,
    }))
    .filter(l => Math.abs(l.amount) > 0.01);

  const total = lineItems.reduce((s, l) => s + l.amount, 0);

  return {
    status: 'DRAFT',
    currency: 'AUD',
    total: Math.round(total * 100) / 100,
    reference: `Xettle-${settlement.settlement_id}`,
    line_items: lineItems,
  };
}
