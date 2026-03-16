/**
 * Canonical Xero Invoice Actions
 * 
 * ALL client-side calls to fetch-xero-invoice, rescan-xero-invoice-match,
 * and preview-xettle-invoice-payload MUST go through these functions.
 * No component may invoke these edge functions directly.
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

export interface PayloadDifference {
  field: string;
  xero_value: any;
  xettle_value: any;
  severity: 'info' | 'warning' | 'error';
}

export type CompareVerdict = 'PASS' | 'WARN' | 'FAIL' | 'BLOCKED';

export interface XettlePreviewPayload {
  Type: string;
  Contact: { Name: string };
  Date: string;
  DueDate: string;
  CurrencyCode: string;
  Status: string;
  LineAmountTypes: string;
  Reference: string;
  LineItems: Array<{
    Description: string;
    AccountCode: string;
    TaxType: string;
    UnitAmount: number;
    Quantity: number;
    Tracking?: any[];
  }>;
}

export interface CompareResult {
  xeroSide: {
    status: string | null;
    currency: string | null;
    total: number | null;
    sub_total: number | null;
    total_tax: number | null;
    reference: string | null;
    contact_name: string | null;
    line_items: XeroLineItem[];
    fetched_at: string | null;
  } | null;
  xettleSide: {
    payload: XettlePreviewPayload;
    total: number;
    tier: string;
    tax_mode: string;
    enforced_status: string;
    canonical_version: string;
    blockers: string[];
    warnings: string[];
    tracking: any;
  } | null;
  differences: PayloadDifference[];
  verdict: CompareVerdict;
  recommendation: string;
}

// ─── Legacy compat types (still exported for existing consumers) ──────────
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

// ─── Compare Xero vs Xettle (Server Canonical Builder) ──────────────────────

/**
 * Full orchestrator: fetch Xero invoice + generate server-side preview + deep diff.
 * Uses canonical builder (preview-xettle-invoice-payload edge function).
 */
export async function compareXeroInvoiceToSettlement({
  xeroInvoiceId,
  settlementId,
  forceRefresh = false,
}: {
  xeroInvoiceId: string;
  settlementId: string;
  forceRefresh?: boolean;
}): Promise<CompareResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return emptyCompareResult('FAIL', 'Not authenticated');
  }

  // 1) Refresh Xero invoice (respect cooldown unless forceRefresh)
  // We always call refresh — the server handles cooldown
  await refreshXeroInvoiceDetails(xeroInvoiceId);

  // 2) Fetch cached Xero invoice + call preview in parallel
  const [cacheRes, previewRes] = await Promise.all([
    supabase
      .from('xero_invoice_cache')
      .select('*')
      .eq('user_id', user.id)
      .eq('xero_invoice_id', xeroInvoiceId)
      .maybeSingle(),
    supabase.functions.invoke('preview-xettle-invoice-payload', {
      body: { settlementId },
    }),
  ]);

  const cached = cacheRes.data;
  const preview = previewRes.data;

  // Build Xero side
  const xeroSide = cached ? {
    status: cached.status,
    currency: cached.currency_code,
    total: cached.total,
    sub_total: cached.sub_total,
    total_tax: cached.total_tax,
    reference: cached.reference,
    contact_name: cached.contact_name,
    line_items: (cached.line_items as unknown as XeroLineItem[]) || [],
    fetched_at: cached.fetched_at,
  } : null;

  // Build Xettle side
  if (!preview?.success || !preview?.payload) {
    const blockerMsg = preview?.blockers?.length ? preview.blockers.join('; ') : preview?.error || 'Preview generation failed';
    return {
      xeroSide,
      xettleSide: null,
      differences: [],
      verdict: 'BLOCKED',
      recommendation: `Cannot generate preview: ${blockerMsg}`,
    };
  }

  const xettlePayload = preview.payload as XettlePreviewPayload;
  const xettleTotal = xettlePayload.LineItems.reduce((s, li) => s + (li.UnitAmount || 0), 0);

  const xettleSide = {
    payload: xettlePayload,
    total: Math.round(xettleTotal * 100) / 100,
    tier: preview.tier || 'UNKNOWN',
    tax_mode: preview.tax_mode || 'UNKNOWN',
    enforced_status: preview.enforced_status || 'DRAFT',
    canonical_version: preview.canonical_version || 'unknown',
    blockers: preview.blockers || [],
    warnings: preview.warnings || [],
    tracking: preview.tracking || null,
  };

  // Check for blockers
  if (xettleSide.blockers.length > 0) {
    return {
      xeroSide,
      xettleSide,
      differences: [],
      verdict: 'BLOCKED',
      recommendation: `Posting blocked: ${xettleSide.blockers.join('; ')}. Fix blockers before replacing.`,
    };
  }

  if (!xeroSide) {
    return {
      xeroSide: null,
      xettleSide,
      differences: [],
      verdict: 'WARN',
      recommendation: 'No cached Xero invoice — refresh first to enable comparison.',
    };
  }

  // 3) Deep diff
  const differences = computeDeepDiff(xeroSide, xettleSide);

  // 4) Verdict
  const verdict = computeVerdict(xeroSide, xettleSide, differences);

  // 5) Recommendation
  const recommendation = getRecommendation(verdict);

  // 6) Log diff event
  await supabase.from('system_events').insert({
    user_id: user.id,
    event_type: 'xero_vs_xettle_diff_generated',
    severity: 'info',
    settlement_id: settlementId,
    details: {
      xero_invoice_id: xeroInvoiceId,
      verdict,
      difference_count: differences.length,
      canonical_version: xettleSide.canonical_version,
      tier: xettleSide.tier,
      xero_total: xeroSide.total,
      xettle_total: xettleSide.total,
    },
  } as any);

  return { xeroSide, xettleSide, differences, verdict, recommendation };
}

// ─── Legacy compat: getXeroVsXettlePayloadDiff ──────────────────────────────
// Redirects to compareXeroInvoiceToSettlement for backward compatibility.

export async function getXeroVsXettlePayloadDiff(
  settlementId: string,
  xeroInvoiceId: string,
): Promise<PayloadDiffResult> {
  const result = await compareXeroInvoiceToSettlement({ xeroInvoiceId, settlementId });

  return {
    xeroSide: result.xeroSide ? {
      status: result.xeroSide.status,
      currency: result.xeroSide.currency,
      total: result.xeroSide.total,
      sub_total: result.xeroSide.sub_total,
      total_tax: result.xeroSide.total_tax,
      reference: result.xeroSide.reference,
      line_items: result.xeroSide.line_items,
    } : null,
    xettleSide: result.xettleSide ? {
      status: result.xettleSide.enforced_status,
      currency: result.xettleSide.payload.CurrencyCode,
      total: result.xettleSide.total,
      reference: result.xettleSide.payload.Reference,
      line_items: result.xettleSide.payload.LineItems.map(li => ({
        description: li.Description,
        account_code: li.AccountCode,
        tax_type: li.TaxType,
        amount: li.UnitAmount,
      })),
    } : null,
    differences: result.differences,
  };
}

// ─── Deep Diff ──────────────────────────────────────────────────────────────

function computeDeepDiff(
  xero: NonNullable<CompareResult['xeroSide']>,
  xettle: NonNullable<CompareResult['xettleSide']>,
): PayloadDifference[] {
  const diffs: PayloadDifference[] = [];
  const payload = xettle.payload;

  // Currency
  if (xero.currency && xero.currency !== payload.CurrencyCode) {
    diffs.push({ field: 'Currency', xero_value: xero.currency, xettle_value: payload.CurrencyCode, severity: 'error' });
  }

  // Total
  if (xero.total != null) {
    const totalDiff = Math.abs((xero.total || 0) - xettle.total);
    if (totalDiff > 0.01) {
      diffs.push({
        field: 'Total',
        xero_value: xero.total,
        xettle_value: xettle.total,
        severity: totalDiff > 1.0 ? 'error' : 'warning',
      });
    }
  }

  // Status
  if (xero.status && xero.status !== xettle.enforced_status) {
    diffs.push({ field: 'Status', xero_value: xero.status, xettle_value: xettle.enforced_status, severity: 'info' });
  }

  // Reference
  if (xero.reference && xero.reference !== payload.Reference) {
    diffs.push({ field: 'Reference', xero_value: xero.reference, xettle_value: payload.Reference, severity: 'info' });
  }

  // Contact
  if (xero.contact_name && xero.contact_name !== payload.Contact.Name) {
    diffs.push({ field: 'Contact', xero_value: xero.contact_name, xettle_value: payload.Contact.Name, severity: 'warning' });
  }

  // Line item count
  if (xero.line_items.length !== payload.LineItems.length) {
    diffs.push({ field: 'Line item count', xero_value: xero.line_items.length, xettle_value: payload.LineItems.length, severity: 'warning' });
  }

  // Per-line comparison (match by description)
  const xeroByDesc = new Map(xero.line_items.map(li => [li.description.toLowerCase().trim(), li]));

  for (const xettleLine of payload.LineItems) {
    const key = xettleLine.Description.toLowerCase().trim();
    const xeroLine = xeroByDesc.get(key);

    if (!xeroLine) {
      // Try partial match
      const partialMatch = [...xeroByDesc.entries()].find(([k]) => k.includes(key) || key.includes(k));
      if (!partialMatch) {
        diffs.push({ field: `Line: ${xettleLine.Description}`, xero_value: 'MISSING', xettle_value: xettleLine.UnitAmount, severity: 'warning' });
        continue;
      }
    }

    const matched = xeroLine || null;
    if (matched) {
      // Amount comparison (tolerance 0.01)
      const xeroAmt = matched.unit_amount || matched.line_amount || 0;
      if (Math.abs(xeroAmt - xettleLine.UnitAmount) > 0.01) {
        diffs.push({ field: `Amount: ${xettleLine.Description}`, xero_value: xeroAmt, xettle_value: xettleLine.UnitAmount, severity: 'warning' });
      }

      // Account code
      if (matched.account_code && xettleLine.AccountCode && matched.account_code !== xettleLine.AccountCode) {
        diffs.push({ field: `Account: ${xettleLine.Description}`, xero_value: matched.account_code, xettle_value: xettleLine.AccountCode, severity: 'warning' });
      }

      // Tax type
      if (matched.tax_type && xettleLine.TaxType && matched.tax_type !== xettleLine.TaxType) {
        diffs.push({ field: `Tax: ${xettleLine.Description}`, xero_value: matched.tax_type, xettle_value: xettleLine.TaxType, severity: 'warning' });
      }

      // Tracking
      if (xettleLine.Tracking?.length && (!matched.tracking?.length)) {
        diffs.push({ field: `Tracking: ${xettleLine.Description}`, xero_value: 'none', xettle_value: JSON.stringify(xettleLine.Tracking), severity: 'info' });
      }
    }
  }

  // Check for Xero lines not in Xettle
  const xettleDescs = new Set(payload.LineItems.map(li => li.Description.toLowerCase().trim()));
  for (const xeroLine of xero.line_items) {
    const key = xeroLine.description.toLowerCase().trim();
    if (!xettleDescs.has(key)) {
      const partialMatch = [...xettleDescs].find(k => k.includes(key) || key.includes(k));
      if (!partialMatch) {
        diffs.push({ field: `Extra Xero line: ${xeroLine.description}`, xero_value: xeroLine.line_amount, xettle_value: 'MISSING', severity: 'info' });
      }
    }
  }

  return diffs;
}

function computeVerdict(
  xero: NonNullable<CompareResult['xeroSide']>,
  xettle: NonNullable<CompareResult['xettleSide']>,
  diffs: PayloadDifference[],
): CompareVerdict {
  // BLOCKED already handled upstream
  if (xettle.blockers.length > 0) return 'BLOCKED';

  // FAIL: currency mismatch or total diff > $1
  const hasCurrencyMismatch = diffs.some(d => d.field === 'Currency');
  const totalDiff = xero.total != null ? Math.abs((xero.total || 0) - xettle.total) : 0;
  if (hasCurrencyMismatch || totalDiff > 1.0) return 'FAIL';

  // WARN: any warning/error severity diffs exist
  const hasWarningsOrErrors = diffs.some(d => d.severity === 'warning' || d.severity === 'error');
  if (hasWarningsOrErrors) return 'WARN';

  // PASS: totals match, no code/tax diffs
  return 'PASS';
}

function getRecommendation(verdict: CompareVerdict): string {
  switch (verdict) {
    case 'PASS': return 'Xettle matches the existing invoice — safe parity confirmed.';
    case 'WARN': return 'Differences detected — investigate before replacing.';
    case 'FAIL': return 'Significant mismatch — do not replace without review.';
    case 'BLOCKED': return 'Posting is blocked — fix blockers before any replacement.';
  }
}

function emptyCompareResult(verdict: CompareVerdict, recommendation: string): CompareResult {
  return { xeroSide: null, xettleSide: null, differences: [], verdict, recommendation };
}
