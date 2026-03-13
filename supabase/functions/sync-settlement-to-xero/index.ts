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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  // Settlement data for CSV attachment
  settlementData?: Record<string, any>;
  // Rollback fields
  invoiceIds?: string[];
  rollbackScope?: 'all' | 'journal_1' | 'journal_2';
  // Legacy compat
  journalIds?: string[];
}

// ─── Audit CSV Attachment Helper ──────────────────────────────────────
function buildSettlementCsv(data: Record<string, any>): string {
  const headers = [
    'settlement_id', 'period_start', 'period_end', 'marketplace',
    'net_amount', 'sales', 'refunds', 'reimbursements', 'seller_fees',
    'fba_fees', 'storage_fees', 'advertising_costs', 'other_fees',
    'promotional_discounts', 'bank_deposit', 'status'
  ];

  const row = [
    data.settlement_id || '',
    data.period_start || '',
    data.period_end || '',
    data.marketplace || '',
    data.net_ex_gst ?? data.net_amount ?? '',
    (data.sales_principal || 0) + (data.sales_shipping || 0),
    data.refunds || 0,
    data.reimbursements || 0,
    data.seller_fees || 0,
    data.fba_fees || 0,
    data.storage_fees || 0,
    data.advertising_costs || 0,
    data.other_fees || 0,
    data.promotional_discounts || 0,
    data.bank_deposit || 0,
    data.status || 'pushed',
  ];

  return headers.join(',') + '\n' + row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
}

async function attachSettlementToXero(
  token: XeroToken,
  xeroInvoiceId: string,
  settlementData: Record<string, any>,
  filename: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const csvContent = buildSettlementCsv(settlementData);
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
    return { success: true };
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

  // Optimistic locking: re-read token to detect concurrent refresh
  const { data: freshTokens, error: rereadError } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('id', token.id)
    .single();

  if (!rereadError && freshTokens && freshTokens.expires_at !== token.expires_at) {
    console.log('Token already refreshed by another instance, using updated token');
    return { ...token, ...freshTokens } as XeroToken;
  }

  const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
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
    `LMB-`,  // We'll use StartsWith for LMB since country code varies
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
    // Filter out voided
    return invoices.find((inv: any) => inv.Status !== 'VOIDED') || null;
  } catch {
    return null;
  }
}

// Check for existing invoice with same Reference OR legacy formats to prevent duplicates
async function checkExistingInvoice(token: XeroToken, reference: string): Promise<{ exists: boolean; invoiceId?: string; status?: string; matchedReference?: string }> {
  console.log('Checking for existing invoice with reference:', reference);

  // 1. Check exact reference (Xettle-{id})
  const exact = await querySingleReference(token, `Reference=="${reference}"`);
  if (exact) {
    console.log('Found existing invoice with exact reference:', exact.InvoiceID);
    return { exists: true, invoiceId: exact.InvoiceID, status: exact.Status, matchedReference: exact.Reference };
  }

  // 2. Extract settlement ID and check legacy formats
  const settlementId = extractSettlementIdFromReference(reference);
  if (settlementId && /^\d+$/.test(settlementId)) {
    // Check AMZN-{settlement_id}
    const amzn = await querySingleReference(token, `Reference=="AMZN-${settlementId}"`);
    if (amzn) {
      console.log('Found existing LEGACY invoice (AMZN format):', amzn.InvoiceID, amzn.Reference);
      return { exists: true, invoiceId: amzn.InvoiceID, status: amzn.Status, matchedReference: amzn.Reference };
    }

    // Check LMB-*-{settlement_id}-* (query all LMB- invoices and filter)
    const lmbInvoices = await querySingleReference(token, `Reference.StartsWith("LMB-")`);
    // querySingleReference returns first non-voided, but we need to check all
    // Re-query properly for LMB
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
    // First, get the invoice to check its current status
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

    // Void the invoice
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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
    // Use the authenticated user's ID, ignore any userId in body
    const userId = authenticatedUserId;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ─── ROLLBACK ACTION ─────────────────────────────────────────────
    if (action === 'rollback') {
      // Support both 'invoiceIds' and legacy 'journalIds'
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

      // Build update payload based on rollback scope
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
        // Legacy compat
        journalId: results[0]?.invoiceId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ─── CREATE ACTION (default) ─────────────────────────────────────
    const { description, date, dueDate, lineItems, country, contactName, netAmount } = body;

    // ─── SERVER-SIDE REFERENCE GENERATION ─────────────────────────────
    // Rule: Reference MUST be generated server-side from settlementId.
    // Client-provided reference is ignored when settlementId is present.
    const settlementId = body.settlementId || body.settlementData?.settlement_id;
    if (!settlementId) {
      throw new Error('Missing settlementId — reference is generated server-side and requires a settlement identifier');
    }
    const splitSuffix = body.splitPart ? `-P${body.splitPart}` : '';
    const reference = `Xettle-${settlementId}${splitSuffix}`;

    // Determine if this is a negative (fee-only) settlement → create a Bill (ACCPAY)
    const isNegativeSettlement = typeof netAmount === 'number' && netAmount < 0;
    const invoiceType = isNegativeSettlement ? "ACCPAY" : "ACCREC";

    console.log('Create request:', { userId, settlementId, reference, date, country, contactName, lineItemCount: lineItems?.length, netAmount, invoiceType });
    if (!date) throw new Error('Missing date');
    if (!lineItems || lineItems.length === 0) throw new Error('Missing line items');

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

    const getCode = (category: string, marketplace?: string): string => {
      if (marketplace) {
        const mpKey = `${category}:${marketplace}`;
        if (userAccountCodes[mpKey]) return userAccountCodes[mpKey];
      }
      return userAccountCodes[category] || DEFAULT_ACCOUNT_CODES[category] || '400';
    };

    // ─── CoA VALIDATION: verify mapped codes exist and are correct type ──
    // Revenue categories must map to REVENUE accounts; expense categories to EXPENSE
    const REVENUE_CATEGORIES = ['Sales', 'Shipping', 'Refunds', 'Reimbursements', 'Promotional Discounts'];
    const EXPENSE_CATEGORIES = ['Seller Fees', 'FBA Fees', 'Storage Fees', 'Other Fees', 'Advertising Costs'];
    const REVENUE_ACCOUNT_TYPES = ['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS'];
    const EXPENSE_ACCOUNT_TYPES = ['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS', 'CURRLIAB', 'LIABILITY'];

    // Load user's cached Chart of Accounts
    const { data: coaAccounts } = await supabase
      .from('xero_chart_of_accounts')
      .select('account_code, account_name, account_type, is_active')
      .eq('user_id', userId);

    const coaMap = new Map<string, { name: string; type: string; active: boolean }>();
    for (const acc of (coaAccounts || [])) {
      if (acc.account_code) {
        coaMap.set(acc.account_code, {
          name: acc.account_name,
          type: (acc.account_type || '').toUpperCase(),
          active: acc.is_active !== false,
        });
      }
    }

    // Only validate if we have CoA data cached (skip if no CoA yet — backwards compat)
    if (coaMap.size > 0) {
      const validationErrors: string[] = [];

      // Collect all account codes actually used in this push's line items
      const usedCodes = new Set<string>();
      if (!isNegativeSettlement && lineItems) {
        for (const item of lineItems) {
          usedCodes.add(item.AccountCode);
        }
      } else {
        usedCodes.add(getCode('Other Fees'));
      }

      for (const code of usedCodes) {
        const coaEntry = coaMap.get(code);
        if (!coaEntry) {
          validationErrors.push(`Account code "${code}" does not exist in your Xero Chart of Accounts`);
          continue;
        }
        if (!coaEntry.active) {
          validationErrors.push(`Account code "${code}" (${coaEntry.name}) is inactive in Xero`);
        }
      }

      // Validate account type correctness for mapped categories
      const allCategories = [...REVENUE_CATEGORIES, ...EXPENSE_CATEGORIES];
      for (const cat of allCategories) {
        const code = getCode(cat);
        if (!code || code === '400') continue; // Skip unmapped defaults
        const coaEntry = coaMap.get(code);
        if (!coaEntry) continue; // Already caught above

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

        // Update settlement status to mapping_error
        if (body.settlementData?.settlement_id) {
          await supabase
            .from('settlements')
            .update({ status: 'mapping_error' })
            .eq('settlement_id', body.settlementData.settlement_id)
            .eq('user_id', userId);
        }

        // Log to system_events
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
        // Resolve the marketplace display name for tracking
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
          // Call xero-auth get_or_create_tracking via internal fetch
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

    // ─── CACHE-FIRST DUPLICATE CHECK ─────────────────────────────────
    // Check local reference index before hitting the Xero API
    const settlementIdFromRef = extractSettlementIdFromReference(reference);
    if (settlementIdFromRef) {
      const { data: cachedMatch } = await supabase
        .from('xero_accounting_matches')
        .select('xero_invoice_id, xero_invoice_number, xero_status, matched_reference')
        .eq('user_id', userId)
        .eq('settlement_id', settlementIdFromRef)
        .maybeSingle();

      if (cachedMatch?.xero_invoice_id) {
        const cachedRef = cachedMatch.matched_reference || '';
        const refInfo = cachedRef && cachedRef !== reference
          ? ` (matched reference: "${cachedRef}")`
          : '';
        console.log(`[duplicate-guard] Cache hit: settlement ${settlementIdFromRef} already in Xero as ${cachedMatch.xero_invoice_id}`);
        throw new Error(
          `An invoice for this settlement already exists in Xero${refInfo} (ID: ${cachedMatch.xero_invoice_id}, Status: ${cachedMatch.xero_status}). ` +
          `Void it in Xero first if you need to re-push.`
        );
      }
    }

    // Fallback: Check Xero API directly (covers cases where cache is empty)
    const existing = await checkExistingInvoice(token, reference);
    if (existing.exists) {
      const refInfo = existing.matchedReference && existing.matchedReference !== reference
        ? ` (matched legacy reference: "${existing.matchedReference}")`
        : '';
      throw new Error(
        `An invoice for this settlement already exists in Xero${refInfo} (ID: ${existing.invoiceId}, Status: ${existing.status}). ` +
        `Void it in Xero first if you need to re-push.`
      );
    }

    // Build the payload — ACCPAY (Bill) for negative, ACCREC (Invoice) for positive
    const invoiceData: Record<string, any> = {
      Type: invoiceType,
      Contact: { Name: contactName || "Amazon.com.au" },
      Date: date,
      DueDate: dueDate || date,
      CurrencyCode: "AUD",
      Status: "DRAFT",
      LineAmountTypes: "Exclusive",
      Reference: reference,
      LineItems: isNegativeSettlement
        ? [{
            Description: `Fee-only period — ${contactName || 'Marketplace'} ${date}\nNo sales revenue. Platform fees charged.`,
            AccountCode: getCode('Other Fees'),
            TaxType: "INPUT", // Fee-only negative settlements assumed domestic; intl/reimbursements not expected here
            UnitAmount: Math.round(Math.abs(netAmount) * 100) / 100,
            Quantity: 1,
            ...(trackingArray ? { Tracking: trackingArray } : {}),
          }]
        : lineItems.map(item => ({
            Description: item.Description,
            AccountCode: item.AccountCode,
            TaxType: item.TaxType,
            UnitAmount: Math.round(item.UnitAmount * 100) / 100,
            Quantity: item.Quantity || 1,
            ...(trackingArray ? { Tracking: trackingArray } : {}),
          }))
    };

    // Add human-readable description if provided (Xettle-{id} reference format)
    if (description) {
      // Xero doesn't have a top-level Description, but we prepend it to the first line item
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
    if (invoiceId && settlementIdFromRef) {
      const sd = body.settlementData || {};
      await supabase.from('xero_accounting_matches').upsert({
        user_id: userId,
        settlement_id: settlementIdFromRef,
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
      }, { onConflict: 'user_id,settlement_id' });
      console.log(`[cache-write] Indexed ${settlementIdFromRef} → ${invoiceId}`);
    }

    // ─── Balance check: settlement vs Xero invoice total ──────────
    const settlementTotal = typeof netAmount === 'number' ? Math.round(netAmount * 100) / 100 : null;
    const xeroTotal = typeof xeroInvoiceTotal === 'number' ? Math.round(xeroInvoiceTotal * 100) / 100 : null;
    // For bills (ACCPAY), Xero returns positive Total for what we sent as abs(negative)
    const comparableXeroTotal = isNegativeSettlement && xeroTotal !== null ? -xeroTotal : xeroTotal;
    const balanceDifference = settlementTotal !== null && comparableXeroTotal !== null
      ? Math.round((settlementTotal - comparableXeroTotal) * 100) / 100
      : null;

    console.log(`[balance-check] settlement_total=${settlementTotal}, xero_invoice_total=${xeroTotal} (comparable=${comparableXeroTotal}), difference=${balanceDifference}`);

    // Log to system_events for audit trail
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

    // ─── Attach audit CSV (non-blocking) ──────────────────────────
    let attachmentResult: { success: boolean; error?: string } | null = null;
    if (invoiceId && body.settlementData) {
      try {
        const sd = body.settlementData;
        const mp = (sd.marketplace || 'unknown').replace(/_/g, '-');
        const periodLabel = `${(sd.period_start || '').slice(0, 7)}`;
        const sid = sd.settlement_id || reference?.replace('Xettle-', '') || 'unknown';
        const filename = `xettle-${mp}-${periodLabel}-${sid}.csv`;
        attachmentResult = await attachSettlementToXero(token, invoiceId, sd, filename);

        // Log attachment result to system_events
        await supabase.from('system_events').insert({
          user_id: userId,
          event_type: 'xero_csv_attachment',
          severity: attachmentResult.success ? 'info' : 'warning',
          settlement_id: sd.settlement_id || null,
          marketplace_code: sd.marketplace || null,
          details: {
            xero_invoice_id: invoiceId,
            filename,
            success: attachmentResult.success,
            error: attachmentResult.error || null,
          },
        });
      } catch (attachErr: any) {
        console.error('Attachment logging failed (non-fatal):', attachErr.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      invoiceId,
      invoiceNumber,
      xeroType: isNegativeSettlement ? 'bill' : 'invoice',
      // Legacy compat — journalId maps to invoiceId
      journalId: invoiceId,
      reference,
      date,
      lineCount: lineItems.length,
      attachmentSuccess: attachmentResult?.success ?? null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

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
