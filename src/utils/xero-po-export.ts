// Xero Purchase Order Payment Report CSV Export
// Generates CSV files for bookkeeper payment reconciliation and Xero import

import type { PurchaseOrderWithSupplier, PurchaseOrderLineItem } from '@/types/purchase-orders';

export interface XeroPOPaymentRow {
  ContactName: string;
  EmailAddress: string;
  PONumber: string;
  Reference: string;
  Date: string;
  DueDate: string;
  Description: string;
  Quantity: string;
  UnitAmount: string;
  AccountCode: string;
  TaxType: string;
  Currency: string;
  TrackingName1: string;
  TrackingOption1: string;
  TrackingName2: string;
  TrackingOption2: string;
}

// GL Account codes for PO types
const GL_ACCOUNT_CODES = {
  'Product': '310',      // Cost of Goods Sold - Inventory
  'Freight': '425',      // Freight & Courier
  'default': '310'       // Default to inventory
};

// Tax type - International purchases are GST Free
const getTaxType = (country: string, currency: string): string => {
  // Australian domestic suppliers with AUD
  if (country === 'Australia' && currency === 'AUD') {
    return 'GST on Expenses';
  }
  // International purchases
  return 'GST Free Expenses';
};

// Format date to DD/MM/YYYY for Australian Xero
const formatXeroDate = (dateString: string | null): string => {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    
    if (year < 2000 || year > 2100) return '';
    
    return `${day}/${month}/${year}`;
  } catch {
    return '';
  }
};

// Get entity/country display name
const getEntityName = (country: string): string => {
  switch (country) {
    case 'Australia': return 'MilesKay Australia';
    case 'UK': return 'MilesKay UK';
    case 'USA': return 'MilesKay USA';
    default: return 'MilesKay';
  }
};

// Convert a single PO to Xero payment rows
export const poToXeroRows = (po: PurchaseOrderWithSupplier): XeroPOPaymentRow[] => {
  const rows: XeroPOPaymentRow[] = [];
  const lineItems = (po.line_items || []) as PurchaseOrderLineItem[];
  
  const commonFields = {
    ContactName: po.supplier?.name || 'Unknown Supplier',
    EmailAddress: po.supplier?.email || '',
    PONumber: po.po_number,
    Reference: po.alibaba_order_id || po.po_number,
    Date: formatXeroDate(po.approved_at || po.created_at),
    DueDate: formatXeroDate(po.expires_at || po.approved_at || po.created_at),
    Currency: po.currency || 'USD',
    TrackingName1: 'Entity',
    TrackingOption1: getEntityName(po.country),
    TrackingName2: 'SUPPLIERS',
    TrackingOption2: po.supplier?.name || '',
  };

  // If no line items, create single row with total
  if (lineItems.length === 0) {
    rows.push({
      ...commonFields,
      Description: `Purchase Order ${po.po_number}`,
      Quantity: '1',
      UnitAmount: (po.total_amount || 0).toFixed(2),
      AccountCode: GL_ACCOUNT_CODES.default,
      TaxType: getTaxType(po.country, po.currency || 'USD'),
    });
  } else {
    // Create row for each line item
    lineItems.forEach((item) => {
      rows.push({
        ...commonFields,
        Description: item.title || 'Line item',
        Quantity: (item.quantity || 1).toString(),
        UnitAmount: (item.unit_price || 0).toFixed(2),
        AccountCode: GL_ACCOUNT_CODES.default,
        TaxType: getTaxType(po.country, po.currency || 'USD'),
      });
    });
  }

  return rows;
};

// Convert multiple POs to CSV string
export const posToXeroCSV = (purchaseOrders: PurchaseOrderWithSupplier[]): string => {
  const allRows: XeroPOPaymentRow[] = [];
  
  purchaseOrders.forEach(po => {
    allRows.push(...poToXeroRows(po));
  });

  if (allRows.length === 0) return '';

  const headers = [
    'ContactName',
    'EmailAddress',
    'PONumber',
    'Reference',
    'Date',
    'DueDate',
    'Description',
    'Quantity',
    'UnitAmount',
    'AccountCode',
    'TaxType',
    'Currency',
    'TrackingName1',
    'TrackingOption1',
    'TrackingName2',
    'TrackingOption2',
  ];

  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const csvLines: string[] = [];
  csvLines.push(headers.join(','));

  allRows.forEach(row => {
    const values = headers.map(header => escapeCSV(row[header as keyof XeroPOPaymentRow] || ''));
    csvLines.push(values.join(','));
  });

  return csvLines.join('\n');
};

// Validation result
export interface POExportValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  summary: {
    total: number;
    exported: number;
    skipped: number;
    totalAmount: number;
  };
  skippedPOs: { poNumber: string; reasons: string[] }[];
  validPOs: PurchaseOrderWithSupplier[];
}

// Check if PO is exportable
const isPOExportable = (po: PurchaseOrderWithSupplier): { valid: boolean; reasons: string[] } => {
  const reasons: string[] = [];

  if (po.status !== 'approved' && po.status !== 'completed') {
    reasons.push(`Status is ${po.status}, not approved/completed`);
  }

  if (!po.supplier?.name) {
    reasons.push('Missing supplier name');
  }

  if (!po.total_amount || po.total_amount <= 0) {
    reasons.push('No total amount');
  }

  return { valid: reasons.length === 0, reasons };
};

// Filter and validate POs for export
export const filterValidPOsForExport = (
  purchaseOrders: PurchaseOrderWithSupplier[],
  options?: { status?: string; paymentStatus?: string }
): POExportValidationResult => {
  const warnings: string[] = [];
  const validPOs: PurchaseOrderWithSupplier[] = [];
  const skippedPOs: { poNumber: string; reasons: string[] }[] = [];
  let totalAmount = 0;

  purchaseOrders.forEach((po) => {
    // Apply optional filters
    if (options?.status && po.status !== options.status) {
      return;
    }
    if (options?.paymentStatus && (po as any).payment_status !== options.paymentStatus) {
      return;
    }

    const { valid, reasons } = isPOExportable(po);

    if (!valid) {
      skippedPOs.push({ poNumber: po.po_number, reasons });
      return;
    }

    validPOs.push(po);
    totalAmount += po.total_amount || 0;

    // Check for warnings
    if (!po.alibaba_order_id) {
      warnings.push(`${po.po_number}: No Alibaba Order ID linked`);
    }
  });

  return {
    valid: validPOs.length > 0,
    warnings,
    errors: [],
    summary: {
      total: purchaseOrders.length,
      exported: validPOs.length,
      skipped: skippedPOs.length,
      totalAmount,
    },
    skippedPOs,
    validPOs,
  };
};

// Download CSV file
export const downloadPOXeroCSV = (
  purchaseOrders: PurchaseOrderWithSupplier[],
  options?: { status?: string; paymentStatus?: string; filename?: string }
): POExportValidationResult => {
  const result = filterValidPOsForExport(purchaseOrders, options);

  if (result.skippedPOs.length > 0) {
    console.warn('Skipped POs:', result.skippedPOs);
  }
  if (result.warnings.length > 0) {
    console.warn('Export warnings:', result.warnings);
  }

  if (result.validPOs.length === 0) {
    result.errors.push('No valid purchase orders to export');
    result.valid = false;
    return result;
  }

  const csv = posToXeroCSV(result.validPOs);

  if (!csv) {
    result.errors.push('Failed to generate CSV');
    result.valid = false;
    return result;
  }

  // Add BOM for UTF-8 Excel compatibility
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });

  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().split('T')[0];
  link.href = url;
  link.download = options?.filename || `xero-po-payments-${date}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return result;
};
