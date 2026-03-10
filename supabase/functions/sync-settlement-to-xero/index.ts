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
  // Create fields
  reference?: string;
  description?: string;
  date?: string;
  dueDate?: string;
  lineItems?: InvoiceLineItem[];
  country?: string;
  contactName?: string;
  netAmount?: number;
  // Rollback fields
  invoiceIds?: string[];
  settlementId?: string;
  rollbackScope?: 'all' | 'journal_1' | 'journal_2';
  // Legacy compat
  journalIds?: string[];
}

// Refresh Xero token if expired
async function refreshXeroToken(supabase: any, token: XeroToken): Promise<XeroToken> {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();

  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    console.log('Token still valid, no refresh needed');
    return token;
  }

  console.log('Token expired or expiring soon, refreshing...');

  const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
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

// Check for existing invoice with same Reference to prevent duplicates
async function checkExistingInvoice(token: XeroToken, reference: string): Promise<{ exists: boolean; invoiceId?: string; status?: string }> {
  console.log('Checking for existing invoice with reference:', reference);

  try {
    const whereClause = `Reference=="${reference}"`;
    const response = await fetch(
      `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(whereClause)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': token.tenant_id
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Xero API error when checking existing invoice:', response.status, errorText);
      return { exists: false };
    }

    const result = await response.json();

    if (!result.Invoices || result.Invoices.length === 0) {
      console.log('No existing invoice found with reference:', reference);
      return { exists: false };
    }

    const existing = result.Invoices[0];
    console.log('Found existing invoice:', existing.InvoiceID, 'Status:', existing.Status);

    // Allow re-creation if existing invoice is voided
    if (existing.Status === 'VOIDED') {
      console.log('Existing invoice is voided, allowing new creation');
      return { exists: false };
    }

    return {
      exists: true,
      invoiceId: existing.InvoiceID,
      status: existing.Status
    };
  } catch (error) {
    console.error('Error checking for existing invoice:', error);
    return { exists: false };
  }
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
    const body: InvoiceRequest = await req.json();
    const { userId, action = 'create' } = body;

    if (!userId) throw new Error('Missing userId');

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
        updatePayload.status = 'saved';
        updatePayload.xero_journal_id = null;
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
          updatePayload.status = 'saved';
          updatePayload.xero_journal_id = null;
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
          updatePayload.status = 'saved';
          updatePayload.xero_journal_id = null;
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
    const { reference, description, date, dueDate, lineItems, country, contactName, netAmount } = body;

    // Determine if this is a negative (fee-only) settlement → create a Bill (ACCPAY)
    const isNegativeSettlement = typeof netAmount === 'number' && netAmount < 0;
    const invoiceType = isNegativeSettlement ? "ACCPAY" : "ACCREC";

    console.log('Create request:', { userId, reference, date, country, contactName, lineItemCount: lineItems?.length, netAmount, invoiceType });
    if (!reference) throw new Error('Missing reference');
    if (!date) throw new Error('Missing date');
    if (!lineItems || lineItems.length === 0) throw new Error('Missing line items');

    let token = await getXeroToken(supabase, userId);
    console.log('Found Xero token for tenant:', token.tenant_name);

    token = await refreshXeroToken(supabase, token);

    // Check for duplicate
    const existing = await checkExistingInvoice(token, reference);
    if (existing.exists) {
      throw new Error(
        `An invoice with reference "${reference}" already exists in Xero (ID: ${existing.invoiceId}, Status: ${existing.status}). ` +
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
      Status: "AUTHORISED",
      LineAmountTypes: "Exclusive",
      Reference: reference,
      LineItems: isNegativeSettlement
        ? [{
            Description: `Fee-only period — ${contactName || 'Marketplace'} ${date}\nNo sales revenue. Platform fees charged.`,
            AccountCode: "405",
            TaxType: "OUTPUT",
            UnitAmount: Math.round(Math.abs(netAmount) * 100) / 100,
            Quantity: 1,
          }]
        : lineItems.map(item => ({
            Description: item.Description,
            AccountCode: item.AccountCode,
            TaxType: item.TaxType,
            UnitAmount: Math.round(item.UnitAmount * 100) / 100,
            Quantity: item.Quantity || 1,
          }))
    };

    // Add human-readable description if provided (Xettle-{id} reference format)
    if (description) {
      // Xero doesn't have a top-level Description, but we prepend it to the first line item
      invoiceData.LineItems[0].Description = `${description}\n${invoiceData.LineItems[0].Description}`;
    }

    const invoicePayload = { Invoices: [invoiceData] };

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
    console.log('Invoice created successfully:', invoiceId, 'Number:', invoiceNumber);

    return new Response(JSON.stringify({
      success: true,
      invoiceId,
      invoiceNumber,
      xeroType: isNegativeSettlement ? 'bill' : 'invoice',
      // Legacy compat — journalId maps to invoiceId
      journalId: invoiceId,
      reference,
      date,
      lineCount: lineItems.length
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
