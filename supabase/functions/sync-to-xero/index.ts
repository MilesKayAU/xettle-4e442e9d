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

interface LineItem {
  description: string;
  quantity?: number;
  unitAmount?: number;
  unit_amount?: number;
  aud_amount?: number;
  accountCode?: string;
  account_code?: string;
  taxType?: string;
  tax_type?: string;
  costType?: string;
  cost_type?: string;
}

// Refresh Xero token if expired
async function refreshXeroToken(supabase: any, token: XeroToken): Promise<XeroToken> {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();
  
  // Add 5 minute buffer before expiry
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

  // Calculate new expiry time
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  // Update token in database
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

// Check if an invoice with this number already exists in Xero
async function checkExistingInvoice(token: XeroToken, invoiceNumber: string): Promise<{
  exists: boolean;
  status?: string;
  invoiceId?: string;
}> {
  console.log('Checking for existing invoice in Xero:', invoiceNumber);
  
  try {
    // Search for invoices with this InvoiceNumber (including voided ones)
    const response = await fetch(
      `https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=${encodeURIComponent(invoiceNumber)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED,DELETED`,
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
      // If we get an error, assume no existing invoice and try to create
      return { exists: false };
    }

    const result = await response.json();
    
    if (!result.Invoices || result.Invoices.length === 0) {
      console.log('No existing invoice found with number:', invoiceNumber);
      return { exists: false };
    }

    const existing = result.Invoices[0];
    console.log('Found existing invoice:', existing.InvoiceNumber, 'Status:', existing.Status, 'ID:', existing.InvoiceID);
    
    return {
      exists: true,
      status: existing.Status,
      invoiceId: existing.InvoiceID
    };
  } catch (error) {
    console.error('Error checking for existing invoice:', error);
    // On error, assume no existing invoice and let the create attempt handle it
    return { exists: false };
  }
}

// Find the next available invoice number with retry suffix (-R1, -R2, etc.)
async function findNextInvoiceNumber(token: XeroToken, baseNumber: string): Promise<string> {
  let retryCount = 1;
  const maxRetries = 10;
  
  while (retryCount <= maxRetries) {
    const candidateNumber = `${baseNumber}-R${retryCount}`;
    console.log('Checking if retry number is available:', candidateNumber);
    
    const check = await checkExistingInvoice(token, candidateNumber);
    
    if (!check.exists) {
      console.log('Found available invoice number:', candidateNumber);
      return candidateNumber;
    }
    
    // If this retry number exists but is also voided/deleted, try next
    if (check.status === 'VOIDED' || check.status === 'DELETED') {
      console.log('Retry number exists but is voided, trying next:', candidateNumber);
      retryCount++;
      continue;
    }
    
    // If an active -R{n} exists, it's a blocking duplicate
    throw new Error(
      `Invoice ${candidateNumber} already exists in Xero with status "${check.status}". ` +
      `Cannot create duplicate. Please check the existing Bill in Xero.`
    );
  }
  
  throw new Error(`Too many retry attempts (${maxRetries}) for invoice number ${baseNumber}. Please resolve duplicates in Xero.`);
}

// Create invoice in Xero
async function createXeroInvoice(token: XeroToken, invoicePayload: any): Promise<any> {
  console.log('Creating invoice in Xero for tenant:', token.tenant_id);
  console.log('Invoice payload:', JSON.stringify(invoicePayload, null, 2));

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
  console.log('Xero invoice created:', result.Invoices?.[0]?.InvoiceID);
  return result;
}

// Helper to determine MIME type from filename
function getContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'csv': 'text/csv',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return types[ext || ''] || 'application/octet-stream';
}

// Upload a file attachment to a Xero invoice
async function uploadAttachmentToXero(
  token: XeroToken, 
  invoiceId: string, 
  fileName: string, 
  fileData: Uint8Array,
  contentType: string
): Promise<boolean> {
  console.log('Uploading attachment to Xero:', fileName, 'Size:', fileData.length, 'bytes');
  
  const response = await fetch(
    `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}/Attachments/${encodeURIComponent(fileName)}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': contentType,
        'Xero-tenant-id': token.tenant_id
      },
      body: fileData
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to upload attachment:', fileName, response.status, errorText);
    return false;
  }
  
  console.log('Successfully uploaded attachment to Xero:', fileName);
  return true;
}

// Download from Supabase storage and upload all attachments to Xero
async function syncAttachmentsToXero(
  supabase: any,
  token: XeroToken,
  invoiceId: string,
  attachments: any[] | null,
  pdfFilePath: string | null
): Promise<{ uploaded: number; failed: number; files: string[] }> {
  const allPaths: string[] = [];
  
  // Collect unique file paths from attachments array
  if (Array.isArray(attachments)) {
    attachments.forEach((att: any) => {
      const path = typeof att === 'string' ? att : att?.path;
      if (path && !allPaths.includes(path)) allPaths.push(path);
    });
  }
  
  // Add legacy pdf_file_path if present and not already included
  if (pdfFilePath && !allPaths.includes(pdfFilePath)) {
    allPaths.push(pdfFilePath);
  }
  
  if (allPaths.length === 0) {
    console.log('No attachments to upload to Xero');
    return { uploaded: 0, failed: 0, files: [] };
  }
  
  console.log(`Processing ${allPaths.length} attachments for Xero upload:`, allPaths);
  
  let uploaded = 0;
  let failed = 0;
  const uploadedFiles: string[] = [];
  
  for (const filePath of allPaths) {
    try {
      // Download file from Supabase storage
      const { data: fileData, error } = await supabase.storage
        .from('alibaba-attachments')
        .download(filePath);
      
      if (error || !fileData) {
        console.error('Failed to download from Supabase storage:', filePath, error);
        failed++;
        continue;
      }
      
      // Get file bytes
      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      // Extract filename and determine content type
      const fileName = filePath.split('/').pop() || 'attachment';
      const contentType = getContentType(fileName);
      
      // Upload to Xero
      const success = await uploadAttachmentToXero(
        token, 
        invoiceId, 
        fileName, 
        bytes, 
        contentType
      );
      
      if (success) {
        uploaded++;
        uploadedFiles.push(fileName);
      } else {
        failed++;
      }
      
    } catch (err) {
      console.error('Error processing attachment:', filePath, err);
      failed++;
    }
  }
  
  console.log(`Attachment sync complete: ${uploaded} uploaded, ${failed} failed`);
  return { uploaded, failed, files: uploadedFiles };
}

// Format invoice number - prefix long numeric IDs with # to prevent Excel scientific notation
function formatInvoiceNumber(orderId: string | null): string {
  if (!orderId) return `INV-${Date.now()}`;
  
  // Return the order ID as-is (no # prefix - Xero handles long numbers fine)
  return orderId;
}

// Build Xero invoice payload from order data
function buildXeroPayload(invoiceData: any, invoiceNumber: string): any {
  // Parse line items if they're stored as JSON string
  let lineItems: LineItem[] = [];
  
  if (invoiceData.line_items) {
    lineItems = typeof invoiceData.line_items === 'string' 
      ? JSON.parse(invoiceData.line_items) 
      : invoiceData.line_items;
  }

  // If no line items but we have a total amount, create a single line item
  if (lineItems.length === 0 && invoiceData.total_amount) {
    // Determine account code based on invoice type
    let accountCode = '631'; // Default to Product (Inventory)
    if (invoiceData.invoice_type === 'Freight') {
      accountCode = '425'; // International Freight Costs
    } else if (invoiceData.invoice_type === 'Service Fee') {
      accountCode = '411'; // Transaction Service Fee
    }

    lineItems = [{
      description: invoiceData.description || `${invoiceData.invoice_type || 'Product'} - ${invoiceData.supplier_name || 'Alibaba Order'}`,
      quantity: 1,
      unitAmount: invoiceData.amount_aud || invoiceData.total_amount,
      accountCode: accountCode,
      taxType: 'NONE' // GST Free Expenses for international
    }];
  }

  // Use AUD amount if available, otherwise use original currency
  const useAud = invoiceData.amount_aud && invoiceData.amount_aud > 0;
  const currencyCode = useAud ? 'AUD' : (invoiceData.currency_code || 'USD');

  // Adjust line item amounts if using AUD
  if (useAud && invoiceData.total_amount && invoiceData.amount_aud) {
    const conversionRatio = invoiceData.amount_aud / invoiceData.total_amount;
    lineItems = lineItems.map(item => ({
      ...item,
      unitAmount: Math.round((item.unitAmount * conversionRatio) * 100) / 100
    }));
  }

  return {
    Invoices: [{
      Type: "ACCPAY", // Accounts Payable (Bill)
      Status: "DRAFT",
      Contact: { 
        Name: invoiceData.supplier_name || 'Alibaba Supplier'
      },
      Date: invoiceData.invoice_date || new Date().toISOString().split('T')[0],
      DueDate: invoiceData.due_date || invoiceData.invoice_date || new Date().toISOString().split('T')[0],
      CurrencyCode: currencyCode,
      InvoiceNumber: invoiceNumber,
      Reference: invoiceData.order_id || '',
      LineAmountTypes: "Exclusive",
      LineItems: lineItems.map((item: any) => {
        // Handle both camelCase and snake_case property names from database
        const baseAccountCode = item.account_code ?? item.accountCode ?? '631';
        const costType = (item.cost_type ?? item.costType ?? '').toLowerCase();
        
        // For accurate accounting totals, use quantity=1 and full AUD amount as unit price
        // This avoids rounding errors from dividing/multiplying (e.g., $1660.06/1000=$1.66 * 1000=$1660.00)
        let unitAmount: number;
        if (item.aud_amount !== undefined && item.aud_amount !== null) {
          // Use the total AUD amount directly with quantity of 1
          unitAmount = item.aud_amount;
        } else {
          // Fall back: if no aud_amount, use original values
          const originalQuantity = item.quantity ?? 1;
          const originalUnitAmount = item.unitAmount ?? item.unit_amount ?? 0;
          unitAmount = originalUnitAmount * originalQuantity; // Total amount
        }
        
        // Map GL codes: database may use 310 for Product, Xero needs 631
        let accountCode = baseAccountCode;
        if (baseAccountCode === '310') accountCode = '631'; // Product to Inventory
        
        // Also check cost_type for GL mapping
        if (costType === 'freight' || costType === 'shipping') accountCode = '425';
        else if (costType === 'service fee' || costType === 'transaction fee') accountCode = '411';
        
        return {
          Description: item.description || 'Line item',
          Quantity: 1, // Always use quantity of 1 to preserve exact AUD totals
          UnitAmount: Math.round(unitAmount * 100) / 100, // Round to 2 decimal places
          AccountCode: accountCode,
          TaxType: 'NONE' // GST Free Expenses for international purchases
        };
      })
    }]
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse request body once and store for error handling
  let requestBody: any = {};
  
  try {
    requestBody = await req.json();
    const { invoiceId, invoiceData, userId, country } = requestBody;
    
    console.log('Sync to Xero request:', { invoiceId, userId, country });

    if (!invoiceId || !invoiceData) {
      throw new Error('Missing invoice ID or data');
    }

    if (!userId) {
      throw new Error('Missing user ID');
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Xero token for the user
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

    let token: XeroToken = tokens[0];
    console.log('Found Xero token for tenant:', token.tenant_name);

    // Refresh token if needed
    token = await refreshXeroToken(supabase, token);

    // Format the base invoice number
    const originalInvoiceNumber = formatInvoiceNumber(invoiceData.order_id);
    let finalInvoiceNumber = originalInvoiceNumber;

    // Check if this invoice number already exists in Xero
    console.log('Checking for duplicate invoice number:', originalInvoiceNumber);
    const existingCheck = await checkExistingInvoice(token, originalInvoiceNumber);

    if (existingCheck.exists) {
      if (existingCheck.status === 'VOIDED' || existingCheck.status === 'DELETED') {
        // Invoice was voided - find next available number with -R suffix
        console.log(`Existing invoice is ${existingCheck.status}, finding next available number with retry suffix`);
        finalInvoiceNumber = await findNextInvoiceNumber(token, originalInvoiceNumber);
        console.log('Will use new invoice number:', finalInvoiceNumber);
      } else {
        // Active invoice exists - block with clear error
        throw new Error(
          `Invoice ${originalInvoiceNumber} already exists in Xero with status "${existingCheck.status}". ` +
          `Please check the existing Bill in Xero (ID: ${existingCheck.invoiceId}) before syncing again.`
        );
      }
    }

    // Build and send invoice to Xero with the final invoice number
    const xeroPayload = buildXeroPayload(invoiceData, finalInvoiceNumber);
    const xeroResponse = await createXeroInvoice(token, xeroPayload);

    if (!xeroResponse.Invoices || xeroResponse.Invoices.length === 0) {
      throw new Error('No invoice returned from Xero');
    }

    const createdInvoice = xeroResponse.Invoices[0];

    // Upload attachments to the newly created Xero invoice
    let attachmentResult = { uploaded: 0, failed: 0, files: [] as string[] };
    try {
      attachmentResult = await syncAttachmentsToXero(
        supabase,
        token,
        createdInvoice.InvoiceID,
        invoiceData.attachments,
        invoiceData.pdf_file_path
      );
    } catch (attachError) {
      console.error('Attachment sync failed (non-fatal):', attachError);
      // Don't throw - Bill was created successfully, attachment failure is non-blocking
    }

    // Update the database with Xero sync information
    const { error: updateError } = await supabase
      .from('alibaba_orders')
      .update({
        xero_invoice_id: createdInvoice.InvoiceID,
        xero_invoice_number: createdInvoice.InvoiceNumber,
        xero_sync_status: 'synced',
        xero_synced_at: new Date().toISOString(),
        xero_sync_error: null
      })
      .eq('id', invoiceId);

    if (updateError) {
      console.error('Database update error:', updateError);
      // Don't throw - invoice was created in Xero, just log the DB error
      console.warn('Invoice created in Xero but failed to update local database');
    }

    console.log('Successfully synced to Xero:', createdInvoice.InvoiceID, 'Number:', createdInvoice.InvoiceNumber);
    if (attachmentResult.uploaded > 0) {
      console.log('Attachments uploaded:', attachmentResult.files.join(', '));
    }

    return new Response(JSON.stringify({
      success: true,
      xeroInvoiceId: createdInvoice.InvoiceID,
      xeroInvoiceNumber: createdInvoice.InvoiceNumber,
      tenantName: token.tenant_name,
      wasRetry: finalInvoiceNumber !== originalInvoiceNumber,
      originalNumber: originalInvoiceNumber,
      attachments: {
        uploaded: attachmentResult.uploaded,
        failed: attachmentResult.failed,
        files: attachmentResult.files
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in sync-to-xero function:', error);
    
    // Try to update the order with error status using the already-parsed request body
    try {
      const invoiceId = requestBody?.invoiceId;
      if (invoiceId) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase
          .from('alibaba_orders')
          .update({
            xero_sync_status: 'error',
            xero_sync_error: error.message || 'Unknown error'
          })
          .eq('id', invoiceId);
        console.log('Updated order with error status:', invoiceId);
      }
    } catch (dbError) {
      console.error('Failed to update error status:', dbError);
    }

    return new Response(JSON.stringify({ 
      success: false,
      error: error.message || 'Failed to sync to Xero'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
