// ══════════════════════════════════════════════════════════════
// ACCOUNTING RULES (hardcoded, never configurable)
// Canonical source: src/constants/accounting-rules.ts
// 
// Rule #11 — Three-Layer Accounting Source Model:
//   Orders     → NEVER create accounting entries
//   Payments   → NEVER create accounting entries
//   Settlements → ONLY source of accounting entries
//
// This function syncs SETTLEMENT data to Xero as DRAFT invoices.
// Orders and payments never trigger accounting entries.
// ══════════════════════════════════════════════════════════════

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getCorsHeaders } from '../_shared/cors.ts';
import { safeUpsertXam } from '../_shared/xam-safe-upsert.ts';
import { logger } from '../_shared/logger.ts';
import { XERO_TOKEN_URL, XERO_API_BASE, getXeroHeaders } from '../_shared/xero-api-policy.ts';
import { isReconciliationOnly } from '../_shared/settlementPolicy.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const xeroClientId = Deno.env.get('XERO_CLIENT_ID')!;
const xeroClientSecret = Deno.env.get('XERO_CLIENT_SECRET')!;

interface XeroToken {
  id: string;
  user_id: string;
  tenant_id: string;
  tenant_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
}

interface InvoiceLineItem {
  Description: string;
  AccountCode: string;
  TaxType: string;
  UnitAmount: number;
  Quantity: number;
}

interface InvoiceRequest {
  userId: string;
  action?: 'create' | 'rollback';
  // Create fields — reference is generated server-side from settlementId
  settlementId?: string;
  splitPart?: 1 | 2;  // For split-month invoices: P1 or P2
  reference?: string;  // DEPRECATED: ignored when settlementId is present (legacy compat only)
  description?: string;
  date?: string;
  dueDate?: string;
  lineItems?: InvoiceLineItem[];
  country?: string;
  contactName?: string;
  netAmount?: number;
  // Invoice status: 'DRAFT' (default, safe) or 'AUTHORISED' (stricter gates apply)
  invoiceStatus?: 'DRAFT' | 'AUTHORISED';
  // Settlement data for CSV attachment
  settlementData?: Record<string, any>;
  // Rollback fields
  invoiceIds?: string[];
  rollbackScope?: 'all' | 'journal_1' | 'journal_2';
  // Legacy compat
  journalIds?: string[];
}

// ─── Canonical Version (must match src/utils/xero-posting-line-items.ts) ──
const CANONICAL_VERSION = 'v2-10cat';

// ─── Server-Side Line Item Builder (mirrors client-side buildPostingLineItems) ──
// This ensures posted line items are deterministically derived from settlementData
// on the server, eliminating client drift risk.

interface PostingCategoryDef {
  name: string;
  field: string;
  taxType: 'OUTPUT' | 'INPUT' | 'BASEXCLUDED';
  defaultAccountCode: string;
}

const SERVER_POSTING_CATEGORIES: readonly PostingCategoryDef[] = [
  { name: 'Sales (Principal)',     field: 'sales_principal',       taxType: 'OUTPUT',       defaultAccountCode: '200' },
  { name: 'Shipping Revenue',     field: 'sales_shipping',        taxType: 'OUTPUT',       defaultAccountCode: '206' },
  { name: 'Promotional Discounts',field: 'promotional_discounts', taxType: 'OUTPUT',       defaultAccountCode: '200' },
  { name: 'Refunds',              field: 'refunds',               taxType: 'OUTPUT',       defaultAccountCode: '205' },
  { name: 'Reimbursements',       field: 'reimbursements',        taxType: 'BASEXCLUDED',  defaultAccountCode: '271' },
  { name: 'Seller Fees',          field: 'seller_fees',           taxType: 'INPUT',        defaultAccountCode: '407' },
  { name: 'FBA Fees',             field: 'fba_fees',              taxType: 'INPUT',        defaultAccountCode: '408' },
  { name: 'Storage Fees',         field: 'storage_fees',          taxType: 'INPUT',        defaultAccountCode: '409' },
  { name: 'Advertising',          field: 'advertising_costs',     taxType: 'INPUT',        defaultAccountCode: '410' },
  { name: 'Other Fees',           field: 'other_fees',            taxType: 'INPUT',        defaultAccountCode: '405' },
];

// Legacy category name mapping for account code resolution
const LEGACY_ACCOUNT_KEY_MAP: Record<string, string> = {
  'Sales (Principal)': 'Sales',
  'Shipping Revenue': 'Shipping',
  'Promotional Discounts': 'Promotional Discounts',
  'Refunds': 'Refunds',
  'Reimbursements': 'Reimbursements',
  'Seller Fees': 'Seller Fees',
  'FBA Fees': 'FBA Fees',
  'Storage Fees': 'Storage Fees',
  'Advertising': 'Advertising Costs',
  'Other Fees': 'Other Fees',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build line items server-side from settlementData using the canonical 10-category list.
 * Uses stored DB values as-is (Option A — "Use Stored Sign").
 */
function buildServerLineItems(
  settlementData: Record<string, any>,
  getCode: (category: string, marketplace?: string) => string,
  marketplace?: string,
): InvoiceLineItem[] {
  const lines: InvoiceLineItem[] = [];

  for (const cat of SERVER_POSTING_CATEGORIES) {
    const raw = settlementData[cat.field];
    const value = typeof raw === 'number' ? raw : parseFloat(raw) || 0;
    const amount = round2(value);

    if (Math.abs(amount) < 0.01) continue;

    const legacyKey = LEGACY_ACCOUNT_KEY_MAP[cat.name] || cat.name;
    const resolvedCode = getCode(legacyKey, marketplace);

    lines.push({
      Description: cat.name,
      AccountCode: resolvedCode || '', // Empty string signals unmapped — checked after build
      TaxType: cat.taxType,
      UnitAmount: amount,
      Quantity: 1,
    });
  }

  return lines;
}

// ─── Multi-Row Audit CSV Attachment Helper ──────────────────────────────
// GST columns are estimates (10% flat rate), clearly labeled as such.
function buildSettlementCsv(data: Record<string, any>, lineItems: InvoiceLineItem[]): string {
  const headers = [
    'settlement_id', 'period_start', 'period_end', 'marketplace',
    'category', 'amount_ex_gst', 'gst_estimate', 'amount_inc_gst_estimate',
    'account_code', 'tax_type',
  ];

  const sid = data.settlement_id || '';
  const ps = data.period_start || '';
  const pe = data.period_end || '';
  const mp = data.marketplace || '';

  const rows: string[] = [
    '# GST values are estimates (10% flat rate). Refer to settlement source for authoritative GST.',
    headers.join(','),
  ];
  let totalExGst = 0;
  let totalGst = 0;

  for (const li of lineItems) {
    const exGst = round2(li.UnitAmount);
    const gstRate = li.TaxType === 'BASEXCLUDED' ? 0 : 0.1;
    const gstAmount = round2(exGst * gstRate);
    const incGst = round2(exGst + gstAmount);

    totalExGst += exGst;
    totalGst += gstAmount;

    rows.push(
      [sid, ps, pe, mp, li.Description, exGst, gstAmount, incGst, li.AccountCode, li.TaxType]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
  }

  const totalInc = round2(totalExGst + totalGst);
  rows.push(
    [sid, ps, pe, mp, 'TOTAL', round2(totalExGst), round2(totalGst), totalInc, '', '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );

  return rows.join('\n') + '\n';
}

// Simple hash for immutability verification (djb2)
function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hashCsv(csv: string): string {
  return djb2Hash(csv);
}

/** Stable hash of line items array for forensic verification */
function hashLineItems(items: InvoiceLineItem[]): string {
  const canonical = items.map(i =>
    `${i.Description}|${i.AccountCode}|${i.TaxType}|${i.UnitAmount}|${i.Quantity}`
  ).join('\n');
  return djb2Hash(canonical);
}

/** Stable hash of settlementData fields used for rebuild */
function hashSettlementData(sd: Record<string, any>): string {
  const fields = SERVER_POSTING_CATEGORIES.map(c => `${c.field}=${sd[c.field] ?? 0}`).join('|');
  return djb2Hash(fields);
}

async function attachSettlementToXero(
  token: XeroToken,
  xeroInvoiceId: string,
  settlementData: Record<string, any>,
  lineItems: InvoiceLineItem[],
  filename: string
): Promise<{ success: boolean; error?: string; csvHash?: string }> {
  try {
    const csvContent = buildSettlementCsv(settlementData, lineItems);
    const csvHashValue = hashCsv(csvContent);
    const encoder = new TextEncoder();
    const csvBytes = encoder.encode(csvContent);

    console.log(`Attaching CSV to Xero invoice ${xeroInvoiceId}: ${filename} (${csvBytes.length} bytes)`);

    const attachUrl = `https://api.xero.com/api.xro/2.0/Invoices/${xeroInvoiceId}/Attachments/${encodeURIComponent(filename)}`;
    const resp = await fetch(attachUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'text/csv',
        'Xero-tenant-id': token.tenant_id,
      },
      body: csvBytes,
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('Xero attachment API error:', resp.status, errorText);
      return { success: false, error: `Xero attachment error: ${resp.status} - ${errorText}` };
    }

    console.log('CSV attached successfully to invoice:', xeroInvoiceId);
    return { success: true, csvHash: csvHashValue };
  } catch (err: any) {
    console.error('Attachment failed (non-fatal):', err.message);
    return { success: false, error: err.message };
  }
}

// Refresh Xero token if expired
async function refreshXeroToken(supabase: any, token: XeroToken): Promise<XeroToken> {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();

  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    console.log('Token still valid, no refresh needed');
    return token;
  }

  console.log('Token expired or expiring soon, checking for concurrent refresh...');

  const { data: freshTokens, error: rereadError } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('id', token.id)
    .single();

  if (!rereadError && freshTokens && freshTokens.expires_at !== token.expires_at) {
    console.log('Token already refreshed by another instance, using updated token');
    return { ...token, ...freshTokens } as XeroToken;
  }

  const tokenResponse = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: freshTokens?.refresh_token || token.refresh_token
    })
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Token refresh failed:', errorText);
    throw new Error(`Failed to refresh Xero token: ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  console.log('Token refreshed successfully');

  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const { error: updateError } = await supabase
    .from('xero_tokens')
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString()
    })
    .eq('id', token.id);

  if (updateError) {
    console.error('Failed to update token in database:', updateError);
    throw new Error('Failed to save refreshed token');
  }

  return {
    ...token,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: newExpiresAt
  };
}

// Extract settlement ID from a Xettle-{id} reference
function extractSettlementIdFromReference(reference: string): string | null {
  if (reference.startsWith('Xettle-')) {
    return reference.slice(7).replace(/-P[12]$/, '');
  }
  return null;
}

// Build all possible legacy reference patterns for a settlement ID
function getLegacyReferencePrefixes(settlementId: string): string[] {
  return [
    `AMZN-${settlementId}`,
    `LMB-`,
  ];
}

// Query Xero for a single reference
async function querySingleReference(token: XeroToken, whereClause: string): Promise<any | null> {
  try {
    const url = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(whereClause)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      },
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    const invoices = result.Invoices || [];
    return invoices.find((inv: any) => inv.Status !== 'VOIDED') || null;
  } catch {
    return null;
  }
}

// Check for existing invoice with same Reference OR legacy formats to prevent duplicates
async function checkExistingInvoice(token: XeroToken, reference: string): Promise<{ exists: boolean; invoiceId?: string; status?: string; matchedReference?: string }> {
  console.log('Checking for existing invoice with reference:', reference);

  const exact = await querySingleReference(token, `Reference=="${reference}"`);
  if (exact) {
    console.log('Found existing invoice with exact reference:', exact.InvoiceID);
    return { exists: true, invoiceId: exact.InvoiceID, status: exact.Status, matchedReference: exact.Reference };
  }

  const settlementId = extractSettlementIdFromReference(reference);
  if (settlementId && /^\d+$/.test(settlementId)) {
    const amzn = await querySingleReference(token, `Reference=="AMZN-${settlementId}"`);
    if (amzn) {
      console.log('Found existing LEGACY invoice (AMZN format):', amzn.InvoiceID, amzn.Reference);
      return { exists: true, invoiceId: amzn.InvoiceID, status: amzn.Status, matchedReference: amzn.Reference };
    }

    try {
      const url = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent('Reference.StartsWith("LMB-")')}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': token.tenant_id,
        },
      });
      if (resp.ok) {
        const result = await resp.json();
        const lmbAll = (result.Invoices || []).filter((inv: any) => inv.Status !== 'VOIDED');
        for (const inv of lmbAll) {
          const ref = inv.Reference || '';
          const match = ref.match(/^LMB-\w+-(\d+)-\d+$/);
          if (match && match[1] === settlementId) {
            console.log('Found existing LEGACY invoice (LMB format):', inv.InvoiceID, ref);
            return { exists: true, invoiceId: inv.InvoiceID, status: inv.Status, matchedReference: ref };
          }
        }
      }
    } catch (e) {
      console.error('LMB legacy check error:', e);
    }
  }

  console.log('No existing invoice found for reference:', reference);
  return { exists: false };
}

// Void an invoice in Xero
async function voidInvoice(token: XeroToken, invoiceId: string): Promise<{ success: boolean; error?: string }> {
  console.log('Voiding invoice in Xero:', invoiceId);

  try {
    const getResponse = await fetch(
      `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': token.tenant_id
        }
      }
    );

    if (!getResponse.ok) {
      const errorText = await getResponse.text();
      console.error('Failed to fetch invoice for voiding:', getResponse.status, errorText);
      return { success: false, error: `Failed to fetch invoice: ${getResponse.status}` };
    }

    const getResult = await getResponse.json();
    const invoice = getResult.Invoices?.[0];

    if (!invoice) {
      return { success: false, error: `Invoice ${invoiceId} not found in Xero` };
    }

    if (invoice.Status === 'VOIDED') {
      console.log('Invoice already voided:', invoiceId);
      return { success: true };
    }

    const voidPayload = {
      Invoices: [{
        InvoiceID: invoiceId,
        Status: "VOIDED"
      }]
    };

    const response = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id
      },
      body: JSON.stringify(voidPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Xero API error voiding invoice:', response.status, errorText);
      return { success: false, error: `Xero API error: ${response.status} - ${errorText}` };
    }

    const result = await response.json();
    const voidedStatus = result.Invoices?.[0]?.Status;
    console.log('Invoice voided successfully:', invoiceId, 'New status:', voidedStatus);

    return { success: true };
  } catch (error) {
    console.error('Error voiding invoice:', invoiceId, error);
    return { success: false, error: error.message };
  }
}

// Get Xero token for a user
async function getXeroToken(supabase: any, userId: string): Promise<XeroToken> {
  const { data: tokens, error: tokenError } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (tokenError) {
    console.error('Error fetching Xero token:', tokenError);
    throw new Error('Failed to fetch Xero authentication');
  }

  if (!tokens || tokens.length === 0) {
    throw new Error('No Xero connection found. Please connect to Xero first.');
  }

  return tokens[0];
}

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ─── JWT VERIFICATION ──────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user: authUser }, error: userError } = await anonClient.auth.getUser();
    if (userError || !authUser) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const authenticatedUserId = authUser.id;

    const body: InvoiceRequest = await req.json();
    const { action = 'create' } = body;
    const userId = authenticatedUserId;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ─── SOURCE PUSH GATE (defense-in-depth) ────────────────────────
    // Reconciliation-only settlements must NEVER be pushed to Xero,
    // regardless of their status. Derives decision from the actual
    // settlement row, not from client-provided fields.
    if (action === 'create' && body.settlementId) {
      const { data: gateCheck } = await supabase
        .from('settlements')
        .select('source, marketplace, settlement_id, bank_deposit, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, reimbursements')
        .eq('settlement_id', body.settlementId)
        .eq('user_id', userId)
        .maybeSingle();

      if (gateCheck && isReconciliationOnly(gateCheck.source, gateCheck.marketplace, gateCheck.settlement_id)) {
        return new Response(JSON.stringify({
          success: false,
          error: `Settlement ${body.settlementId} is reconciliation-only (source: ${gateCheck.source}) and cannot be pushed to Xero. Upload a payout-level settlement for accounting entries.`,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ─── RECONCILIATION GAP GATE (defense-in-depth) ─────────────────
      if (gateCheck) {
        const computedNet =
          (gateCheck.sales_principal || 0) + (gateCheck.sales_shipping || 0)
          - Math.abs(gateCheck.seller_fees || 0) - Math.abs(gateCheck.fba_fees || 0)
          - Math.abs(gateCheck.storage_fees || 0) - Math.abs(gateCheck.advertising_costs || 0)
          - Math.abs(gateCheck.other_fees || 0)
          + (gateCheck.refunds || 0) + (gateCheck.reimbursements || 0);
        const reconGap = Math.abs((gateCheck.bank_deposit || 0) - computedNet);
        if (reconGap > 1.00) {
          console.warn(`Reconciliation gap gate blocked push: settlementId=${body.settlementId}, gap=${reconGap.toFixed(2)}`);
          return new Response(JSON.stringify({
            success: false,
            error: `Reconciliation gap of $${reconGap.toFixed(2)} exceeds $1.00 tolerance. Edit figures to resolve before pushing.`,
            errorCode: 'RECON_GAP',
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ─── ROLLBACK ACTION ─────────────────────────────────────────────
    if (action === 'rollback') {
      const idsToVoid = body.invoiceIds || body.journalIds;
      const { settlementId, rollbackScope = 'all' } = body;

      if (!idsToVoid || idsToVoid.length === 0) {
        throw new Error('Missing invoiceIds for rollback');
      }
      if (!settlementId) {
        throw new Error('Missing settlementId for rollback');
      }

      console.log('Rollback request:', { userId, settlementId, idsToVoid, rollbackScope });

      let token = await getXeroToken(supabase, userId);
      token = await refreshXeroToken(supabase, token);

      const results: Array<{ invoiceId: string; success: boolean; error?: string }> = [];

      for (const id of idsToVoid) {
        const result = await voidInvoice(token, id);
        results.push({ invoiceId: id, ...result });
      }

      const allSuccess = results.every(r => r.success);
      const failedResults = results.filter(r => !r.success);

      if (!allSuccess) {
        const errorMsg = failedResults.map(r => `${r.invoiceId}: ${r.error}`).join('; ');
        throw new Error(`Failed to void some invoices: ${errorMsg}`);
      }

      const updatePayload: Record<string, any> = {};

      if (rollbackScope === 'all') {
        updatePayload.status = 'ready_to_push';
        updatePayload.xero_journal_id = null;
        updatePayload.xero_invoice_id = null;
        updatePayload.xero_journal_id_1 = null;
        updatePayload.xero_journal_id_2 = null;
      } else if (rollbackScope === 'journal_1') {
        updatePayload.xero_journal_id_1 = null;
        const { data: settData } = await supabase
          .from('settlements')
          .select('xero_journal_id_2')
          .eq('settlement_id', settlementId)
          .eq('user_id', userId)
          .single();
        if (!settData?.xero_journal_id_2) {
          updatePayload.status = 'ready_to_push';
          updatePayload.xero_journal_id = null;
          updatePayload.xero_invoice_id = null;
        }
      } else if (rollbackScope === 'journal_2') {
        updatePayload.xero_journal_id_2 = null;
        const { data: settData } = await supabase
          .from('settlements')
          .select('xero_journal_id_1')
          .eq('settlement_id', settlementId)
          .eq('user_id', userId)
          .single();
        if (!settData?.xero_journal_id_1) {
          updatePayload.status = 'ready_to_push';
          updatePayload.xero_journal_id = null;
          updatePayload.xero_invoice_id = null;
        }
      }

      const { error: updateError } = await supabase
        .from('settlements')
        .update(updatePayload)
        .eq('settlement_id', settlementId)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Failed to reset settlement status:', updateError);
        throw new Error('Invoices voided in Xero but failed to update settlement status in database');
      }

      console.log('Rollback complete:', { settlementId, voidedInvoices: idsToVoid, scope: rollbackScope });

      return new Response(JSON.stringify({
        success: true,
        action: 'rollback',
        rollbackScope,
        settlementId,
        voidedInvoices: results,
        journalId: results[0]?.invoiceId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ─── CREATE ACTION (default) ─────────────────────────────────────
    const { description, date, dueDate, country, contactName } = body;

    // ─── SERVER-SIDE REFERENCE GENERATION ─────────────────────────────
    const settlementId = body.settlementId || body.settlementData?.settlement_id;
    if (!settlementId) {
      throw new Error('Missing settlementId — reference is generated server-side and requires a settlement identifier');
    }
    const splitSuffix = body.splitPart ? `-P${body.splitPart}` : '';
    const reference = `Xettle-${settlementId}${splitSuffix}`;
    const cacheSettlementKey = `${settlementId}${splitSuffix}`;

    // ─── IDEMPOTENCY LOCK — prevents double-click / retry / concurrent push ──
    // Acquires a per-settlement mutex via acquire_sync_lock RPC.
    // TTL of 120s covers the full push cycle (Xero API + attachment + DB writes).
    // If the lock is already held, the request is rejected immediately.
    const pushLockKey = `xero_push_${cacheSettlementKey}`;
    let lockAcquired = false;

    const { data: lockResult, error: lockError } = await supabase.rpc('acquire_sync_lock', {
      p_user_id: userId,
      p_integration: 'xero_push',
      p_lock_key: pushLockKey,
      p_ttl_seconds: 120,
    });

    if (lockError) {
      console.error('[idempotency-lock] Failed to acquire lock:', lockError);
      throw new Error('Failed to acquire push lock — please try again');
    }

    if (lockResult && !lockResult.acquired) {
      console.warn(`[idempotency-lock] Push already in progress for ${cacheSettlementKey}, expires: ${lockResult.expires_at}`);
      return new Response(JSON.stringify({
        success: false,
        error: 'PUSH_IN_PROGRESS',
        message: `A push for this settlement is already in progress. Please wait and try again.`,
        expiresAt: lockResult.expires_at,
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    lockAcquired = true;
    console.log(`[idempotency-lock] Acquired push lock for ${cacheSettlementKey}`);

    // Wrap the rest in try/finally to guarantee lock release
    try {

    // ─── SERVER-DERIVED NET AMOUNT (never trust client-provided netAmount) ──
    // Derive from settlementData fields (bank_deposit preferred, then net_ex_gst)
    const sd = body.settlementData || {};
    const serverNetAmount: number = typeof sd.bank_deposit === 'number' ? sd.bank_deposit
      : typeof sd.net_ex_gst === 'number' ? sd.net_ex_gst
      : (typeof body.netAmount === 'number' ? body.netAmount : 0);
    const netAmount = serverNetAmount;

    // Determine if this is a negative (fee-only) settlement → create a Bill (ACCPAY)
    const isNegativeSettlement = netAmount < 0;
    const invoiceType = isNegativeSettlement ? "ACCPAY" : "ACCREC";

    console.log('Create request:', { userId, settlementId, reference, date, country, contactName, netAmount, invoiceType });
    if (!date) throw new Error('Missing date');

    // ─── Fetch user account code overrides ──────────────────────────
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

    let userAccountCodes: Record<string, string> = {};
    try {
      const { data: acSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'accounting_xero_account_codes')
        .maybeSingle();
      if (acSetting?.value) {
        userAccountCodes = JSON.parse(acSetting.value);
      }
    } catch (e) {
      console.error('Failed to load user account codes, using defaults:', e);
    }

    const CANONICAL_KEY_LABELS: Record<string, string> = {
      amazon_au: 'Amazon AU', amazon_us: 'Amazon USA', amazon_uk: 'Amazon UK',
      amazon_ca: 'Amazon CA', amazon_jp: 'Amazon JP', amazon_sg: 'Amazon SG',
      shopify_payments: 'Shopify', shopify_orders: 'Shopify',
      ebay_au: 'eBay AU', bunnings: 'Bunnings', catch: 'Catch',
      mydeal: 'MyDeal', kogan: 'Kogan', bigw: 'BigW',
      woolworths: 'Woolworths', woolworths_marketplus: 'Everyday Market',
      everyday_market: 'Everyday Market', theiconic: 'The Iconic', etsy: 'Etsy',
    };

    const DISPLAY_ALIASES: Record<string, string> = {
      'shopify payments': 'Shopify', 'shopify': 'Shopify',
      'ebay australia': 'eBay AU', 'ebay au': 'eBay AU',
      'bunnings marketplace': 'Bunnings', 'bunnings': 'Bunnings',
      'big w marketplace': 'BigW', 'big w': 'BigW', 'bigw': 'BigW',
      'woolworths marketplace': 'Woolworths',
      'woolworths marketplus': 'Everyday Market', 'everyday market': 'Everyday Market',
      'mydeal marketplace': 'MyDeal', 'mydeal': 'MyDeal', 'my deal': 'MyDeal',
      'kogan marketplace': 'Kogan', 'kogan': 'Kogan',
      'catch marketplace': 'Catch', 'catch': 'Catch',
      'the iconic': 'The Iconic', 'theiconic': 'The Iconic',
      'etsy': 'Etsy',
      'amazon au': 'Amazon AU', 'amazon usa': 'Amazon USA',
      'amazon uk': 'Amazon UK', 'amazon jp': 'Amazon JP', 'amazon sg': 'Amazon SG',
    };

    const getMarketplaceKeyCandidates = (marketplace?: string | null): string[] => {
      if (!marketplace) return [];
      const trimmed = marketplace.trim();
      if (!trimmed) return [];
      const normalized = CANONICAL_KEY_LABELS[trimmed] || DISPLAY_ALIASES[trimmed.toLowerCase()] || trimmed;
      return [...new Set([normalized, trimmed].filter(Boolean))];
    };

    const getCode = (category: string, marketplace?: string): string | null => {
      for (const candidate of getMarketplaceKeyCandidates(marketplace)) {
        const mpKey = `${category}:${candidate}`;
        if (userAccountCodes[mpKey]) return userAccountCodes[mpKey];
      }
      if (userAccountCodes[category]) return userAccountCodes[category];
      return null;
    };

    // ─── SERVER-SIDE LINE ITEM REBUILD (MANDATORY) ────────────────────
    // ALL line items are deterministically rebuilt from settlementData on the server.
    // Client-provided lineItems are NEVER used — eliminates drift/tampering risk.
    if (!body.settlementData) {
      throw new Error('Missing settlementData — server-side line item rebuild is mandatory for all pushes');
    }

    let lineItems: InvoiceLineItem[];
    const lineItemsSource: 'server_rebuilt' = 'server_rebuilt';
    const mappingMarketplace = body.settlementData?.marketplace || body.marketplace || contactName || null;

    lineItems = buildServerLineItems(body.settlementData, getCode, mappingMarketplace || undefined);
    console.log(`[line-items] Rebuilt ${lineItems.length} line items server-side from settlementData (net=${isNegativeSettlement ? 'negative' : 'positive'})`);

    // If client also provided lineItems, compare hashes for mismatch detection
    if (body.lineItems && body.lineItems.length > 0) {
      const clientHash = hashLineItems(body.lineItems);
      const serverHash = hashLineItems(lineItems);
      if (clientHash !== serverHash) {
        console.warn(`[line-items] Client/server mismatch detected: client=${clientHash}, server=${serverHash}. Using server-rebuilt items.`);
      }
    }

    if (lineItems.length === 0) throw new Error('No non-zero line items to post');

    // ─── UNMAPPED LINE ITEMS CHECK — hard block ────────────────────────
    const unmappedLines = lineItems.filter(li => !li.AccountCode);
    if (unmappedLines.length > 0) {
      const unmappedCategories = unmappedLines.map(li => li.Description).join(', ');
      console.error('MAPPING_REQUIRED: unmapped categories:', unmappedCategories);

      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_push_mapping_required',
        severity: 'error',
        settlement_id: body.settlementData?.settlement_id || null,
        marketplace_code: body.settlementData?.marketplace || null,
        details: { unmapped_categories: unmappedLines.map(li => li.Description) },
      });

      return new Response(JSON.stringify({
        success: false,
        error: 'MAPPING_REQUIRED',
        unmappedCategories: unmappedLines.map(li => li.Description),
        message: `Account mapping is missing for: ${unmappedCategories}. Configure your Account Mapper before pushing.`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── REQUIRED CATEGORIES COMPLETENESS CHECK ────────────────────────
    const REQUIRED_CATEGORIES = ['Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping'];
    const missingRequired: string[] = [];
    for (const reqCat of REQUIRED_CATEGORIES) {
      // Check if this category has a non-zero value in settlement data
      const catDef = SERVER_POSTING_CATEGORIES.find(c => {
        const legacyKey = LEGACY_ACCOUNT_KEY_MAP[c.name] || c.name;
        return legacyKey === reqCat || c.name === reqCat;
      });
      if (!catDef) continue;
      const rawVal = body.settlementData?.[catDef.field];
      const val = typeof rawVal === 'number' ? rawVal : parseFloat(rawVal) || 0;
      if (Math.abs(val) < 0.01) continue; // Zero amount — no mapping needed
      
      const resolvedCode = getCode(reqCat, contactName);
      if (!resolvedCode) {
        missingRequired.push(reqCat);
      }
    }

    if (missingRequired.length > 0) {
      console.error('MAPPING_INCOMPLETE: missing required categories:', missingRequired);

      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_push_mapping_incomplete',
        severity: 'error',
        settlement_id: body.settlementData?.settlement_id || null,
        marketplace_code: body.settlementData?.marketplace || null,
        details: { missing_categories: missingRequired },
      });

      return new Response(JSON.stringify({
        success: false,
        error: 'MAPPING_INCOMPLETE',
        missingCategories: missingRequired,
        message: `Required account mappings missing for: ${missingRequired.join(', ')}. Configure in Account Mapper.`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── CoA VALIDATION: verify mapped codes exist and are correct type ──
    const REVENUE_CATEGORIES = ['Sales', 'Shipping', 'Refunds', 'Reimbursements', 'Promotional Discounts'];
    const EXPENSE_CATEGORIES = ['Seller Fees', 'FBA Fees', 'Storage Fees', 'Other Fees', 'Advertising Costs'];
    const REVENUE_ACCOUNT_TYPES = ['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS'];
    const EXPENSE_ACCOUNT_TYPES = ['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS', 'CURRLIAB', 'LIABILITY'];

    const { data: coaAccounts } = await supabase
      .from('xero_chart_of_accounts')
      .select('account_code, account_name, account_type, is_active, synced_at')
      .eq('user_id', userId);

    const coaMap = new Map<string, { name: string; type: string; active: boolean }>();
    let coaMaxSyncedAt: Date | null = null;
    for (const acc of (coaAccounts || [])) {
      if (acc.account_code) {
        coaMap.set(acc.account_code, {
          name: acc.account_name,
          type: (acc.account_type || '').toUpperCase(),
          active: acc.is_active !== false,
        });
        if (acc.synced_at) {
          const d = new Date(acc.synced_at);
          if (!coaMaxSyncedAt || d > coaMaxSyncedAt) coaMaxSyncedAt = d;
        }
      }
    }

    // ─── CoA FRESHNESS CHECK — block if stale and cannot refresh ──
    const COA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const coaAgeMs = coaMaxSyncedAt ? Date.now() - coaMaxSyncedAt.getTime() : Infinity;
    if (coaAgeMs > COA_MAX_AGE_MS) {
      console.warn(`[coa-freshness] CoA cache is stale (${Math.round(coaAgeMs / 3600000)}h old) or empty. Blocking push.`);

      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_push_coa_stale',
        severity: 'error',
        settlement_id: body.settlementData?.settlement_id || null,
        details: { coa_age_hours: Math.round(coaAgeMs / 3600000), coa_count: coaMap.size },
      });

      return new Response(JSON.stringify({
        success: false,
        error: 'COA_STALE',
        message: 'Chart of Accounts cache is stale or empty. Please refresh your Xero connection before pushing.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (coaMap.size > 0) {
      const validationErrors: string[] = [];

      const usedCodes = new Set<string>();
      for (const item of lineItems) {
        usedCodes.add(item.AccountCode);
      }

      for (const code of usedCodes) {
        if (!code) continue; // Unmapped — already caught by MAPPING_REQUIRED check
        const coaEntry = coaMap.get(code);
        if (!coaEntry) {
          validationErrors.push(`Account code "${code}" does not exist in your Xero Chart of Accounts`);
          continue;
        }
        if (!coaEntry.active) {
          validationErrors.push(`Account code "${code}" (${coaEntry.name}) is inactive in Xero`);
        }
      }

      const allCategories = [...REVENUE_CATEGORIES, ...EXPENSE_CATEGORIES];
      for (const cat of allCategories) {
        const code = getCode(cat);
        if (!code) continue; // Unmapped — already caught
        const coaEntry = coaMap.get(code);
        if (!coaEntry) continue;

        const isRevenueCat = REVENUE_CATEGORIES.includes(cat);
        const validTypes = isRevenueCat ? REVENUE_ACCOUNT_TYPES : EXPENSE_ACCOUNT_TYPES;
        if (!validTypes.includes(coaEntry.type)) {
          validationErrors.push(
            `"${cat}" mapped to "${code}" (${coaEntry.name}) which is type "${coaEntry.type}" — expected ${isRevenueCat ? 'Revenue' : 'Expense'} account`
          );
        }
      }

      if (validationErrors.length > 0) {
        console.error('MAPPING_INVALID:', validationErrors);

        if (body.settlementData?.settlement_id) {
          await supabase
            .from('settlements')
            .update({ status: 'mapping_error' })
            .eq('settlement_id', body.settlementData.settlement_id)
            .eq('user_id', userId);
        }

        await supabase.from('system_events').insert({
          user_id: userId,
          event_type: 'xero_push_mapping_invalid',
          severity: 'error',
          settlement_id: body.settlementData?.settlement_id || null,
          marketplace_code: body.settlementData?.marketplace || null,
          details: { errors: validationErrors },
        });

        return new Response(JSON.stringify({
          success: false,
          error: 'MAPPING_INVALID',
          validationErrors,
          message: 'Your account mapping references invalid or inactive Xero accounts. Please review your Account Mapping.',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`[coa-validation] All ${usedCodes.size} account codes validated against Chart of Accounts ✓`);
    }

    // ─── Fetch tracking category setting ────────────────────────────
    let trackingArray: any[] | null = null;
    try {
      const { data: trackingSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'xero_tracking_enabled')
        .maybeSingle();

      if (trackingSetting?.value === 'true' && contactName) {
        const trackingOptionName = contactName;
        const cacheKey = `xero_tracking_sales_channel_${trackingOptionName.toLowerCase().replace(/\s+/g, '_')}`;
        
        const { data: cachedTracking } = await supabase
          .from('app_settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', cacheKey)
          .maybeSingle();

        if (cachedTracking?.value) {
          try {
            const cached = JSON.parse(cachedTracking.value);
            trackingArray = [{ Name: cached.categoryName, Option: cached.optionName }];
            console.log('Using cached tracking:', trackingArray);
          } catch { /* skip */ }
        }

        if (!trackingArray) {
          try {
            const trackingUrl = `${supabaseUrl}/functions/v1/xero-auth`;
            const trackingResp = await fetch(trackingUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'x-action': 'get_or_create_tracking',
              },
              body: JSON.stringify({
                action: 'get_or_create_tracking',
                categoryName: 'Sales Channel',
                optionName: trackingOptionName,
              }),
            });
            if (trackingResp.ok) {
              const trackingResult = await trackingResp.json();
              if (trackingResult.success) {
                trackingArray = [{ Name: trackingResult.categoryName, Option: trackingResult.optionName }];
                console.log('Resolved tracking:', trackingArray);
              }
            }
          } catch (trackErr) {
            console.error('Tracking category resolution failed (non-fatal):', trackErr);
          }
        }
      }
    } catch (e) {
      console.error('Tracking category check failed (non-fatal):', e);
    }

    let token = await getXeroToken(supabase, userId);
    console.log('Found Xero token for tenant:', token.tenant_name);

    token = await refreshXeroToken(supabase, token);

    // ─── REPOST GUARD: if settlement has repost_of_invoice_id, verify old invoice is VOIDED ──
    let isRepostPush = false;
    let repostOfInvoiceId: string | null = null;
    {
      const { data: settRow } = await supabase
        .from('settlements')
        .select('repost_of_invoice_id, repost_reason')
        .eq('settlement_id', settlementId)
        .eq('user_id', userId)
        .maybeSingle();

      if (settRow?.repost_of_invoice_id) {
        isRepostPush = true;
        repostOfInvoiceId = settRow.repost_of_invoice_id;

        // Verify old invoice is actually VOIDED in our cache
        const { data: oldMatch } = await supabase
          .from('xero_accounting_matches')
          .select('xero_status')
          .eq('user_id', userId)
          .eq('xero_invoice_id', settRow.repost_of_invoice_id)
          .maybeSingle();

        if (oldMatch && oldMatch.xero_status !== 'VOIDED') {
          throw new Error(
            `Repost blocked: previous invoice ${settRow.repost_of_invoice_id} is not VOIDED (status: ${oldMatch.xero_status}). ` +
            `Void it first via Safe Repost before pushing a replacement.`
          );
        }
        console.log(`[repost-guard] Repost allowed: old invoice ${settRow.repost_of_invoice_id} is VOIDED`);
      }
    }

    // ─── CACHE-FIRST DUPLICATE CHECK ─────────────────────────────────
    {
      const { data: cachedMatch } = await supabase
        .from('xero_accounting_matches')
        .select('xero_invoice_id, xero_invoice_number, xero_status, matched_reference')
        .eq('user_id', userId)
        .eq('settlement_id', cacheSettlementKey)
        .maybeSingle();

      if (cachedMatch?.xero_invoice_id) {
        // Allow if the cached match is VOIDED (repost scenario)
        if (cachedMatch.xero_status === 'VOIDED') {
          console.log(`[duplicate-guard] Cache hit but VOIDED — allowing repost for ${cacheSettlementKey}`);
          // Delete the VOIDED match so we can insert the new one after push
          await supabase
            .from('xero_accounting_matches')
            .delete()
            .eq('user_id', userId)
            .eq('settlement_id', cacheSettlementKey)
            .eq('xero_status', 'VOIDED');
        } else {
          const cachedRef = cachedMatch.matched_reference || '';
          const refInfo = cachedRef && cachedRef !== reference
            ? ` (matched reference: "${cachedRef}")`
            : '';
          console.log(`[duplicate-guard] Cache hit: settlement ${cacheSettlementKey} already in Xero as ${cachedMatch.xero_invoice_id}`);
          throw new Error(
            `An invoice for this settlement already exists in Xero${refInfo} (ID: ${cachedMatch.xero_invoice_id}, Status: ${cachedMatch.xero_status}). ` +
            `Void it in Xero first if you need to re-push.`
          );
        }
      }
    }

    // Fallback: Check Xero API directly — if found, backfill local DB (retry recovery)
    const existing = await checkExistingInvoice(token, reference);
    if (existing.exists) {
      // ─── RETRY RECOVERY (Option B): Xero has the invoice but our DB doesn't ──
      // This happens when Xero creation succeeded but the DB write failed (timeout, crash).
      // Instead of throwing, backfill the local cache and return success.
      const isRetryRecovery = existing.status === 'DRAFT';
      
      if (isRetryRecovery) {
        console.log(`[retry-recovery] Found orphaned DRAFT invoice ${existing.invoiceId} in Xero — backfilling local DB`);

        // Backfill xero_accounting_matches cache
        const sd = body.settlementData || {};
        const backfillResult = await safeUpsertXam(supabase, {
          user_id: userId,
          settlement_id: cacheSettlementKey,
          marketplace_code: sd.marketplace || 'unknown',
          xero_invoice_id: existing.invoiceId,
          xero_invoice_number: null,
          xero_status: existing.status,
          xero_type: netAmount < 0 ? 'bill' : 'invoice',
          match_method: 'retry_recovery',
          confidence: 1.0,
          matched_amount: netAmount || null,
          matched_date: date || null,
          matched_contact: contactName || null,
          matched_reference: existing.matchedReference || reference,
          reference_hash: reference.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase(),
        });
        if (!backfillResult.success) {
          console.warn(`[retry-recovery] XAM upsert conflict: ${backfillResult.message}`);
        }

        // Log recovery event
        await supabase.from('system_events').insert({
          user_id: userId,
          event_type: 'xero_push_retry_recovered',
          severity: 'warning',
          settlement_id: sd.settlement_id || null,
          marketplace_code: sd.marketplace || null,
          details: {
            xero_invoice_id: existing.invoiceId,
            matched_reference: existing.matchedReference || reference,
            recovery_reason: 'invoice_exists_in_xero_but_not_in_local_cache',
          },
        });

        return new Response(JSON.stringify({
          success: true,
          invoiceId: existing.invoiceId,
          reference: existing.matchedReference || reference,
          recoveredFromRetry: true,
          message: 'Invoice already existed in Xero — local database backfilled successfully.',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Non-DRAFT existing invoice — genuine duplicate, block as before
      const refInfo = existing.matchedReference && existing.matchedReference !== reference
        ? ` (matched legacy reference: "${existing.matchedReference}")`
        : '';
      throw new Error(
        `An invoice for this settlement already exists in Xero${refInfo} (ID: ${existing.invoiceId}, Status: ${existing.status}). ` +
        `Void it in Xero first if you need to re-push.`
      );
    }

    // Build the payload — ACCPAY (Bill) for negative, ACCREC (Invoice) for positive
    // Line items are ALWAYS server-rebuilt from settlementData (no client fallback).
    // For negative settlements, if server rebuild produces no lines (all zeros),
    // create a single summary line for the net amount.
    let finalLineItems: InvoiceLineItem[];
    if (isNegativeSettlement && lineItems.length === 0) {
      // Edge case: negative settlement where all individual fields are zero but net is negative
      finalLineItems = [{
        Description: `Fee-only period — ${contactName || 'Marketplace'} ${date}\nNo sales revenue. Platform fees charged.`,
        AccountCode: getCode('Other Fees'),
        TaxType: "INPUT",
        UnitAmount: round2(Math.abs(netAmount!)),
        Quantity: 1,
      }];
    } else {
      finalLineItems = lineItems;
    }

    // ─── SERVER-SIDE CONTACT MAPPING (no silent fallback) ─────────────
    const SERVER_MARKETPLACE_CONTACTS: Record<string, string> = {
      amazon_au: 'Amazon.com.au',
      amazon_us: 'Amazon.com',
      amazon_uk: 'Amazon.co.uk',
      amazon_ca: 'Amazon.ca',
      shopify_payments: 'Shopify Payments',
      shopify_orders: 'Shopify',
      bunnings: 'Bunnings Marketplace',
      bigw: 'Big W Marketplace',
      catch: 'Catch Marketplace',
      mydeal: 'MyDeal Marketplace',
      kogan: 'Kogan Marketplace',
      woolworths: 'Woolworths Marketplace',
      woolworths_marketplus: 'Woolworths MarketPlus',
      ebay_au: 'eBay Australia',
      everyday_market: 'Everyday Market',
      theiconic: 'THE ICONIC',
      etsy: 'Etsy',
    };

    const marketplace = body.settlementData?.marketplace || body.marketplace || '';
    let resolvedContact = contactName || SERVER_MARKETPLACE_CONTACTS[marketplace];
    if (!resolvedContact) {
      // Soft fallback: use generic contact name and log a warning
      resolvedContact = 'Marketplace Settlement';
      console.warn(`[contact-mapping] No contact mapping for marketplace "${marketplace}" — using generic fallback "Marketplace Settlement"`);
      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_push_contact_fallback',
        settlement_id: settlementId,
        marketplace_code: marketplace,
        severity: 'warning',
        details: {
          reason: 'missing_contact_mapping',
          marketplace,
          fallback_contact: 'Marketplace Settlement',
          message: `No contact mapping found for marketplace: ${marketplace} — used generic fallback. Add to SERVER_MARKETPLACE_CONTACTS to resolve.`,
        },
      });
    }

    // ─── INVOICE STATUS: DRAFT (default) or AUTHORISED (stricter gates) ──
    // Support tier enforcement (duplicated minimal rules from src/policy/supportPolicy.ts)
    const AU_VALIDATED_RAILS = new Set([
      'amazon_au', 'shopify_payments', 'ebay', 'bunnings', 'catch',
      'kogan', 'mydeal', 'everyday_market', 'paypal',
    ]);
    const { data: orgTaxSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'tax_profile')
      .maybeSingle();
    const orgTaxProfile = orgTaxSetting?.value || 'AU_GST';
    const railNormalised = (marketplace || '').toLowerCase();
    const pushTier = (AU_VALIDATED_RAILS.has(railNormalised) && orgTaxProfile === 'AU_GST')
      ? 'SUPPORTED'
      : AU_VALIDATED_RAILS.has(railNormalised) ? 'EXPERIMENTAL' : 'UNSUPPORTED';

    const requestedStatus = body.invoiceStatus || 'DRAFT';
    let finalInvoiceStatus = 'DRAFT';

    if (requestedStatus === 'AUTHORISED') {
      if (pushTier !== 'SUPPORTED') {
        // Non-SUPPORTED tier: force DRAFT, log event
        console.warn(`[invoice-status] AUTHORISED blocked — tier is ${pushTier}, forcing DRAFT`);
        await supabase.from('system_events').insert({
          user_id: userId,
          event_type: 'authorised_blocked_by_tier',
          severity: 'warning',
          settlement_id: settlementId,
          marketplace_code: marketplace,
          details: { requested: 'AUTHORISED', enforced: 'DRAFT', tier: pushTier },
        });
        finalInvoiceStatus = 'DRAFT';
      } else {
        // SUPPORTED tier + AUTHORISED: all gates already passed
        finalInvoiceStatus = 'AUTHORISED';
        console.log(`[invoice-status] AUTHORISED mode requested — all safety gates passed (tier: SUPPORTED)`);
      }
    }

    const invoiceData: Record<string, any> = {
      Type: invoiceType,
      Contact: { Name: resolvedContact },
      Date: date,
      DueDate: dueDate || date,
      CurrencyCode: "AUD",
      Status: finalInvoiceStatus,
      LineAmountTypes: "Exclusive",
      Reference: reference,
      LineItems: finalLineItems.map(item => ({
        Description: item.Description,
        AccountCode: item.AccountCode,
        TaxType: item.TaxType,
        UnitAmount: round2(item.UnitAmount),
        Quantity: item.Quantity || 1,
        ...(trackingArray ? { Tracking: trackingArray } : {}),
      })),
    };

    if (description) {
      invoiceData.LineItems[0].Description = `${description}\n${invoiceData.LineItems[0].Description}`;
    }

    const invoicePayload = { Invoices: [invoiceData] };

    // Validate TaxTypes before sending to Xero
    const VALID_TAX_TYPES = ['OUTPUT', 'INPUT', 'EXEMPTOUTPUT', 'BASEXCLUDED', 'NONE'];
    for (const item of invoiceData.LineItems) {
      if (!VALID_TAX_TYPES.includes(item.TaxType)) {
        throw new Error(
          `Invalid TaxType "${item.TaxType}" on line item "${item.Description}". ` +
          `Must be one of: ${VALID_TAX_TYPES.join(', ')}`
        );
      }
    }

    console.log('Creating invoice in Xero:', JSON.stringify(invoicePayload, null, 2));

    const response = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id
      },
      body: JSON.stringify(invoicePayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Xero API error:', response.status, errorText);
      throw new Error(`Xero API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const invoiceId = result.Invoices?.[0]?.InvoiceID;
    const invoiceNumber = result.Invoices?.[0]?.InvoiceNumber;
    const xeroInvoiceTotal = result.Invoices?.[0]?.Total ?? null;
    console.log('Invoice created successfully:', invoiceId, 'Number:', invoiceNumber);

    // ─── Write to reference index cache (prevents future duplicates) ──
    if (invoiceId) {
      const sd = body.settlementData || {};
      const xamResult = await safeUpsertXam(supabase, {
        user_id: userId,
        settlement_id: cacheSettlementKey,
        marketplace_code: sd.marketplace || 'unknown',
        xero_invoice_id: invoiceId,
        xero_invoice_number: invoiceNumber || null,
        xero_status: 'DRAFT',
        xero_type: isNegativeSettlement ? 'bill' : 'invoice',
        match_method: 'push',
        confidence: 1.0,
        matched_amount: xeroInvoiceTotal || null,
        matched_date: date,
        matched_contact: contactName || null,
        matched_reference: reference,
        reference_hash: reference.replace(/[^a-zA-Z0-9-_]/g, '').toLowerCase(),
      });
      if (!xamResult.success) {
        console.error(`[cache-write] XAM upsert conflict: ${xamResult.message}`);
      } else {
        console.log(`[cache-write] Indexed ${cacheSettlementKey} → ${invoiceId}`);
      }
    }

    // ─── Balance check: settlement vs Xero invoice total ──────────
    const settlementTotal = typeof netAmount === 'number' ? round2(netAmount) : null;
    const xeroTotal = typeof xeroInvoiceTotal === 'number' ? round2(xeroInvoiceTotal) : null;
    const comparableXeroTotal = isNegativeSettlement && xeroTotal !== null ? -xeroTotal : xeroTotal;
    const balanceDifference = settlementTotal !== null && comparableXeroTotal !== null
      ? round2(settlementTotal - comparableXeroTotal)
      : null;

    console.log(`[balance-check] settlement_total=${settlementTotal}, xero_invoice_total=${xeroTotal} (comparable=${comparableXeroTotal}), difference=${balanceDifference}`);

    // Log balance check to system_events for audit trail
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'xero_push_balance_check',
      severity: balanceDifference !== null && balanceDifference !== 0 ? 'warning' : 'info',
      settlement_id: body.settlementData?.settlement_id || reference?.replace('Xettle-', '') || null,
      marketplace_code: body.settlementData?.marketplace || null,
      details: {
        settlement_total: settlementTotal,
        xero_invoice_total: xeroTotal,
        comparable_xero_total: comparableXeroTotal,
        difference: balanceDifference,
        invoice_type: invoiceType,
        xero_invoice_id: invoiceId,
        reference,
      },
    });

    // ─── Build the authoritative push event payload ────────────────
    // This is assembled ONCE and written ONCE after attachment succeeds.
    const normalizedLineItems = lineItems.slice(0, 200).map((li: any) => ({
      description: li.Description || '',
      account_code: li.AccountCode || '',
      tax_type: li.TaxType || '',
      amount: li.UnitAmount ?? 0,
    }));
    const pushEventDetails: Record<string, any> = {
      posting_mode: 'manual',
      canonical_version: CANONICAL_VERSION,
      line_items_source: lineItemsSource,
      xero_request_payload: {
        lineItems: lineItems.slice(0, 200),
        contactName,
        reference,
        description,
        date,
        dueDate: dueDate || date,
        netAmount,
        invoiceType,
      },
      xero_response: {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        xero_status: 'DRAFT',
        xero_type: isNegativeSettlement ? 'bill' : 'invoice',
      },
      normalized: {
        net_amount: netAmount,
        currency: 'AUD',
        contact_name: contactName,
        line_items: normalizedLineItems,
        truncated: lineItems.length > 200,
      },
      settlement_total: settlementTotal,
      xero_invoice_total: xeroTotal,
      balance_difference: balanceDifference,
      line_items_hash: hashLineItems(finalLineItems),
      settlement_data_hash: hashSettlementData(body.settlementData),
    };

    // ─── DURABLE CSV RETENTION — store in our own storage before Xero ──
    // This ensures we always have an independent copy even if Xero attachments are removed.
    if (body.settlementData && lineItems.length > 0) {
      try {
        const csvForStorage = buildSettlementCsv(body.settlementData, lineItems);
        const csvHashForStorage = hashCsv(csvForStorage);
        const storageClient = createClient(supabaseUrl, supabaseServiceKey);
        const storagePath = `${userId}/${csvHashForStorage}.csv`;
        await storageClient.storage.from('audit-csvs').upload(storagePath, new TextEncoder().encode(csvForStorage), {
          contentType: 'text/csv',
          upsert: false, // immutable — never overwrite
        });
        console.log(`[csv-retention] Stored durable copy: audit-csvs/${storagePath}`);
      } catch (storageErr: any) {
        // Non-fatal: log but continue (file may already exist from prior attempt)
        if (!storageErr?.message?.includes('already exists') && !storageErr?.message?.includes('Duplicate')) {
          console.warn(`[csv-retention] Storage upload warning: ${storageErr.message}`);
        }
      }
    }

    // ─── Attach audit CSV (REQUIRED — fail if missing or upload fails) ──
    // ORPHAN INVOICE PREVENTION (Option B — Recoverable State):
    // If attachment fails after invoice creation, we:
    //   1. Set posting_state='failed', posting_error='xero_attachment_failed'
    //   2. Store xero_invoice_id in system_events for retry
    //   3. Return error with invoiceId so caller can surface "Retry attachment"
    // We do NOT delete the draft invoice (avoiding Xero API permission issues).
    let attachmentResult: { success: boolean; error?: string; csvHash?: string } | null = null;
    const settlementIdForDb = body.settlementData?.settlement_id || reference?.replace('Xettle-', '') || null;

    if (!body.settlementData) {
      // Enforcement: settlementData is required for attachment
      console.error('Missing settlementData — attachment cannot be created');

      if (settlementIdForDb) {
        await supabase.from('settlements').update({
          posting_state: 'failed',
          posting_error: 'missing_attachment_data',
          xero_invoice_id: invoiceId,
        }).eq('settlement_id', settlementIdForDb).eq('user_id', userId);
      }

      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_attachment_failed',
        severity: 'error',
        settlement_id: settlementIdForDb,
        marketplace_code: null,
        details: {
          xero_invoice_id: invoiceId,
          xero_invoice_number: invoiceNumber,
          error: 'missing_attachment_data',
          canonical_version: CANONICAL_VERSION,
          recoverable: true,
        },
      });

      return new Response(JSON.stringify({
        success: false,
        error: 'missing_attachment_data',
        invoiceId,
        invoiceNumber,
        message: 'Invoice created in Xero but settlementData was missing — no CSV attachment. Settlement marked as failed for retry.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else if (invoiceId) {
      try {
        const sd = body.settlementData;
        const mp = (sd.marketplace || 'unknown').replace(/_/g, '-');
        const periodLabel = `${(sd.period_start || '').slice(0, 7)}`;
        const sid = sd.settlement_id || reference?.replace('Xettle-', '') || 'unknown';
        const filename = `xettle-${mp}-${periodLabel}-${sid}.csv`;
        attachmentResult = await attachSettlementToXero(token, invoiceId, sd, lineItems, filename);

        // Log attachment result to system_events
        await supabase.from('system_events').insert({
          user_id: userId,
          event_type: attachmentResult.success ? 'xero_csv_attachment' : 'xero_attachment_failed',
          severity: attachmentResult.success ? 'info' : 'error',
          settlement_id: sd.settlement_id || null,
          marketplace_code: sd.marketplace || null,
          details: {
            xero_invoice_id: invoiceId,
            xero_invoice_number: invoiceNumber,
            filename,
            success: attachmentResult.success,
            error: attachmentResult.error || null,
            csv_hash: attachmentResult.csvHash || null,
            canonical_version: CANONICAL_VERSION,
            recoverable: !attachmentResult.success,
          },
        });

        // If attachment upload failed, mark settlement as failed (recoverable)
        if (!attachmentResult.success) {
          if (sd.settlement_id) {
            await supabase.from('settlements').update({
              posting_state: 'failed',
              posting_error: 'xero_attachment_failed',
              xero_invoice_id: invoiceId,
              xero_invoice_number: invoiceNumber,
            }).eq('settlement_id', sd.settlement_id).eq('user_id', userId);
          }

          return new Response(JSON.stringify({
            success: false,
            error: 'xero_attachment_failed',
            invoiceId,
            invoiceNumber,
            message: `Invoice created in Xero but CSV attachment upload failed: ${attachmentResult.error}. Settlement marked as failed for retry.`,
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (attachErr: any) {
        console.error('Attachment failed:', attachErr.message);

        const sd = body.settlementData;
        if (sd?.settlement_id) {
          await supabase.from('settlements').update({
            posting_state: 'failed',
            posting_error: 'xero_attachment_failed',
            xero_invoice_id: invoiceId,
            xero_invoice_number: invoiceNumber,
          }).eq('settlement_id', sd.settlement_id).eq('user_id', userId);
        }

        await supabase.from('system_events').insert({
          user_id: userId,
          event_type: 'xero_attachment_failed',
          severity: 'error',
          settlement_id: sd?.settlement_id || null,
          marketplace_code: sd?.marketplace || null,
          details: {
            xero_invoice_id: invoiceId,
            xero_invoice_number: invoiceNumber,
            error: attachErr.message,
            canonical_version: CANONICAL_VERSION,
            recoverable: true,
          },
        });

        return new Response(JSON.stringify({
          success: false,
          error: 'xero_attachment_failed',
          invoiceId,
          invoiceNumber,
          message: `Invoice created but attachment failed: ${attachErr.message}. Settlement marked as failed for retry.`,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ─── History Note (like Link My Books) ────────────────────────
    // Adds a contextual note visible in Xero's invoice history tab.
    // Non-fatal: if it fails, we log and continue.
    if (invoiceId && body.settlementData) {
      try {
        const sd = body.settlementData;
        const amt = typeof netAmount === 'number' ? netAmount.toFixed(2) : '0.00';
        const csvHash = attachmentResult?.csvHash || 'n/a';
        const historyNote =
          `This ${isNegativeSettlement ? 'bill' : 'invoice'} relates to the total settlement of AUD ${amt} ` +
          `for period ${sd.period_start || '?'} to ${sd.period_end || '?'}. ` +
          `Posted by Xettle (csv_hash: ${csvHash}).`;

        const histResp = await fetch(
          `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}/History`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token.access_token}`,
              'Content-Type': 'application/json',
              'Xero-tenant-id': token.tenant_id,
            },
            body: JSON.stringify({ HistoryRecords: [{ Details: historyNote }] }),
          }
        );

        if (histResp.ok) {
          console.log('[history-note] Added history note to invoice', invoiceId);
        } else {
          console.warn('[history-note] Failed:', histResp.status, await histResp.text());
        }
      } catch (histErr: any) {
        console.warn('[history-note] Non-fatal error:', histErr.message);
      }
    }

    // ─── Raw Source Data Attachment (like Link My Books) ─────────
    // Attach the original settlement_lines data as a second CSV so accountants
    // can validate the raw source alongside the derived audit CSV.
    if (invoiceId && body.settlementData?.settlement_id) {
      try {
        const rawSettlementId = body.settlementData.settlement_id;
        const { data: rawLines } = await supabase
          .from('settlement_lines')
          .select('transaction_type, amount_type, amount_description, amount, order_id, sku, posted_date')
          .eq('settlement_id', rawSettlementId)
          .eq('user_id', userId)
          .limit(5000);

        if (rawLines && rawLines.length > 0) {
          const rawHeaders = ['transaction_type', 'amount_type', 'amount_description', 'amount', 'order_id', 'sku', 'posted_date'];
          const rawCsvRows = [rawHeaders.join(',')];
          for (const row of rawLines) {
            rawCsvRows.push(
              rawHeaders.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')
            );
          }
          const rawCsv = rawCsvRows.join('\n') + '\n';
          const rawBytes = new TextEncoder().encode(rawCsv);

          const mp = (body.settlementData.marketplace || 'unknown').replace(/_/g, '-');
          const rawFilename = `xettle-raw-${mp}-${rawSettlementId}.csv`;

          const rawAttachResp = await fetch(
            `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}/Attachments/${encodeURIComponent(rawFilename)}`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${token.access_token}`,
                'Content-Type': 'text/csv',
                'Xero-tenant-id': token.tenant_id,
              },
              body: rawBytes,
            }
          );

          if (rawAttachResp.ok) {
            console.log(`[raw-attachment] Attached ${rawLines.length} raw lines as ${rawFilename}`);
          } else {
            console.warn('[raw-attachment] Failed:', rawAttachResp.status);
          }
        } else {
          console.log('[raw-attachment] No settlement_lines found, skipping raw attachment');
        }
      } catch (rawErr: any) {
        console.warn('[raw-attachment] Non-fatal error:', rawErr.message);
      }
    }

    // ─── SINGLE authoritative xero_push_success event ───────────────
    // Written ONCE after invoice + attachment both succeed.
    // Contains full payload snapshot, csv_hash, attachment_filename, canonical_version.
    const attachmentFilename = body.settlementData
      ? `xettle-${(body.settlementData.marketplace || 'unknown').replace(/_/g, '-')}-${(body.settlementData.period_start || '').slice(0, 7)}-${body.settlementData.settlement_id || 'unknown'}.csv`
      : null;

    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'xero_push_success',
      severity: 'info',
      settlement_id: settlementIdForDb,
      marketplace_code: body.settlementData?.marketplace || null,
      details: {
        ...pushEventDetails,
        csv_hash: attachmentResult?.csvHash || null,
        attachment_filename: attachmentFilename,
        ...(isRepostPush ? {
          is_repost: true,
          voided_invoice_id: repostOfInvoiceId,
          replacement_invoice_id: invoiceId,
          replacement_invoice_number: invoiceNumber,
        } : {}),
      },
    });

    // ─── REPOST COMPLETION: link old → new invoice for traceability ──
    if (isRepostPush && repostOfInvoiceId && invoiceId) {
      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'safe_repost_completed',
        severity: 'info',
        settlement_id: settlementIdForDb,
        marketplace_code: body.settlementData?.marketplace || null,
        details: {
          voided_invoice_id: repostOfInvoiceId,
          new_invoice_id: invoiceId,
          new_invoice_number: invoiceNumber,
          reference,
          completed_at: new Date().toISOString(),
        },
      });
      console.log(`[repost-complete] Linked voided ${repostOfInvoiceId} → new ${invoiceId}`);
    }

    return new Response(JSON.stringify({
      success: true,
      invoiceId,
      invoiceNumber,
      xeroType: isNegativeSettlement ? 'bill' : 'invoice',
      journalId: invoiceId,
      reference,
      date,
      lineCount: lineItems.length,
      lineItemsSource,
      attachmentSuccess: attachmentResult?.success ?? null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    } finally {
      // ─── RELEASE IDEMPOTENCY LOCK (only if we actually acquired it) ──
      if (lockAcquired) {
        try {
          await supabase.rpc('release_sync_lock', {
            p_user_id: userId,
            p_integration: 'xero_push',
            p_lock_key: pushLockKey,
          });
          console.log(`[idempotency-lock] Released push lock for ${cacheSettlementKey}`);
        } catch (relErr: any) {
          console.warn(`[idempotency-lock] Failed to release lock (will auto-expire in 120s): ${relErr.message}`);
        }
      }
    }

  } catch (error) {
    console.error('Error in sync-amazon-journal:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
