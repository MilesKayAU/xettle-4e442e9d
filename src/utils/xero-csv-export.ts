// Xero Bill Import CSV Export Utility
// Generates CSV files compatible with Xero's Bill Template format

export interface XeroBillRow {
  ContactName: string;
  EmailAddress: string;
  POAddressLine1: string;
  POAddressLine2: string;
  POAddressLine3: string;
  POAddressLine4: string;
  POCity: string;
  PORegion: string;
  POPostalCode: string;
  POCountry: string;
  InvoiceNumber: string;
  Reference: string;
  InvoiceDate: string;
  DueDate: string;
  InventoryItemCode: string;
  Description: string;
  Quantity: string;
  UnitAmount: string;
  Discount: string;
  AccountCode: string;
  TaxType: string;
  TaxAmount: string;
  TrackingName1: string;
  TrackingOption1: string;
  TrackingName2: string;
  TrackingOption2: string;
  Currency: string;
}

// GL Account codes based on cost type
const GL_ACCOUNT_CODES: Record<string, string> = {
  'Product': '631',      // 631 - Inventory Account
  'Freight': '425',      // 425 - International Freight Costs
  'Service Fee': '411',  // 411 - Transaction Service Fee - Alibaba
  'default': '631'       // Default to inventory
};

// Reverse mapping: derive cost type from account code (for legacy data without cost_type)
const COST_TYPE_FROM_ACCOUNT: Record<string, string> = {
  '631': 'Product',
  '310': 'Product',
  '425': 'Freight',
  '411': 'Service Fee',
  '404': 'Service Fee'
};

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : 0;
};

// Parse line_items that may be double-stringified (stored as JSON string in JSONB column)
const parseLineItems = (lineItems: unknown): any[] => {
  // Already an array? Return it.
  if (Array.isArray(lineItems)) return lineItems;
  
  // It's a string? Try to parse it (handles double-stringify issue).
  if (typeof lineItems === 'string') {
    try {
      const parsed = JSON.parse(lineItems);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      console.warn('Failed to parse line_items string:', e);
    }
  }
  
  // Fallback to empty array
  return [];
};

const normalizeAccountCode = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // handle values like 310, "310", "310.0", "310.00", "310 "
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) return String(Math.trunc(asNumber));
  return raw;
};

const normalizeCostType = (value: unknown): 'Product' | 'Freight' | 'Service Fee' | '' => {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower.includes('service')) return 'Service Fee';
  if (lower.includes('freight') || lower.includes('shipping')) return 'Freight';
  if (lower.includes('product') || lower.includes('inventory')) return 'Product';
  // if it already matches expected casing
  if (v === 'Product' || v === 'Freight' || v === 'Service Fee') return v;
  return '';
};

const getItemQuantity = (item: any): number => {
  const q = toNumber(item?.quantity ?? item?.qty ?? 1);
  return q > 0 ? q : 1;
};

const getItemUnitPrice = (item: any): number => {
  return toNumber(item?.unit_price ?? item?.unitPrice ?? item?.unit_amount ?? item?.unitAmount ?? 0);
};

// Helper function to robustly determine cost type from line item
const getCostTypeFromItem = (item: any, orderInvoiceType: string | null): string => {
  // Priority 1: Explicit cost_type field
  const explicit = normalizeCostType(item?.cost_type ?? item?.costType);
  if (explicit) return explicit;
  
  // Priority 2: Derive from account code
  const accountCode = normalizeAccountCode(item?.accountCode ?? item?.account_code);
  if (accountCode && COST_TYPE_FROM_ACCOUNT[accountCode]) return COST_TYPE_FROM_ACCOUNT[accountCode];
  
  // Priority 3: Fall back to order-level invoice type
  return normalizeCostType(orderInvoiceType) || 'Product';
};

// Tax type mapping for Australian Xero - aligned with actual Xero AU default tax rates
// GST Free Expenses: For international purchases where no GST is paid (imports from Alibaba)
// GST on Expenses: For domestic Australian purchases with 10% GST
// NOTE: Alibaba purchases are ALWAYS international (GST Free) regardless of currency
const TAX_TYPE_MAP: Record<string, string> = {
  // International purchases - No GST paid to supplier (GST paid at customs)
  'USD_Product': 'GST Free Expenses',
  'USD_Freight': 'GST Free Expenses',
  'USD_Service Fee': 'GST Free Expenses',
  
  // Domestic purchases (AUD from Australian suppliers) - 10% GST applies
  // NOTE: This only applies to truly domestic suppliers, not Alibaba invoicing in AUD
  'AUD_Product': 'GST on Expenses',
  'AUD_Freight': 'GST on Expenses',
  'AUD_Service Fee': 'GST on Expenses',
  
  // Default for Alibaba (international supplier)
  'default': 'GST Free Expenses'
};

// Known international suppliers that should always use GST Free Expenses
const INTERNATIONAL_SUPPLIERS = [
  'alibaba',
  'aliexpress',
  '1688',
  'taobao'
];

// Check if supplier is international (should use GST Free)
const isInternationalSupplier = (supplierName: string | null): boolean => {
  if (!supplierName) return true; // Default to international for Alibaba orders
  const lowerName = supplierName.toLowerCase();
  return INTERNATIONAL_SUPPLIERS.some(s => lowerName.includes(s));
};

// Get tax type - prioritize existing valid value, then map based on currency/type
const getTaxType = (
  existingTaxType: string | null | undefined,
  currencyCode: string | null,
  invoiceType: string | null,
  supplierName?: string | null
): string => {
  // Priority 1: Use existing tax type from line item if valid
  // Skip "NONE", empty strings, and case-insensitive "none"
  if (existingTaxType && 
      existingTaxType.toUpperCase() !== 'NONE' && 
      existingTaxType.trim() !== '') {
    return existingTaxType;
  }
  
  // Priority 2: If international supplier, always use GST Free Expenses
  if (isInternationalSupplier(supplierName)) {
    return 'GST Free Expenses';
  }
  
  // Priority 3: Map based on currency and invoice type (for domestic suppliers)
  const currency = currencyCode || 'USD';
  const type = invoiceType || 'Product';
  const key = `${currency}_${type}`;
  
  return TAX_TYPE_MAP[key] || TAX_TYPE_MAP.default;
};

// Format date to DD/MM/YYYY for Australian Xero
const formatXeroDate = (dateString: string | null): string => {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    
    // Validate date is valid
    if (isNaN(date.getTime())) {
      console.warn(`Invalid date: ${dateString}`);
      return '';
    }
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    
    // Validate year is reasonable (between 2000 and 2100)
    if (year < 2000 || year > 2100) {
      console.warn(`Date year out of range: ${year}`);
      return '';
    }
    
    return `${day}/${month}/${year}`;
  } catch (error) {
    console.warn(`Error formatting date: ${dateString}`, error);
    return '';
  }
};

// Get account code based on invoice type
const getAccountCode = (invoiceType: string | null): string => {
  return GL_ACCOUNT_CODES[invoiceType || ''] || GL_ACCOUNT_CODES.default;
};

// Validate and get unit amount - handle zero/null values
const getValidUnitAmount = (
  item: any,
  orderTotalAmount: number | null,
  lineItemCount: number
): { amount: string; isValid: boolean } => {
  // Handle all field name variants - camelCase and snake_case
  const unitPrice = item.unitPrice || item.unitAmount || item.unit_price || item.unit_amount || 0;
  
  if (unitPrice > 0) {
    return { amount: Number(unitPrice).toFixed(2), isValid: true };
  }
  
  // If unit price is zero but we have a total amount, calculate per-item
  if (orderTotalAmount && orderTotalAmount > 0 && lineItemCount > 0) {
    const calculatedAmount = orderTotalAmount / lineItemCount;
    console.warn(`Using calculated amount ${calculatedAmount} for zero-value line item`);
    return { amount: calculatedAmount.toFixed(2), isValid: true };
  }
  
  // Return zero but flag as potentially invalid
  return { amount: '0.00', isValid: false };
};

export interface AlibabaOrderForExport {
  id: string;
  supplier_name: string | null;
  invoice_type: 'Product' | 'Freight' | 'Service Fee' | null;
  order_id: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency_code: string | null;
  line_items: any;
  total_amount: number | null;
  amount_aud?: number | null;  // Added: AUD amount when paid in AUD
  notes: string | null;
  description?: string | null;
}

// Format invoice number - return as-is (no # prefix needed for Xero)
const formatInvoiceNumber = (orderId: string | null): string => {
  if (!orderId) return '';
  return orderId;
};

// Convert a single order to Xero bill rows (one row per cost type)
export const orderToXeroRows = (order: AlibabaOrderForExport): XeroBillRow[] => {
  const rows: XeroBillRow[] = [];
  const lineItems = parseLineItems(order.line_items);
  
  // Common fields for all rows of this order
  // Use fallback supplier name if missing
  const supplierName = order.supplier_name || 'Alibaba Supplier (Unknown)';
  
  const commonFields = {
    ContactName: supplierName,
    EmailAddress: '',
    POAddressLine1: '',
    POAddressLine2: '',
    POAddressLine3: '',
    POAddressLine4: '',
    POCity: '',
    PORegion: '',
    POPostalCode: '',
    POCountry: '',
    InvoiceNumber: formatInvoiceNumber(order.order_id),
    Reference: order.notes || formatInvoiceNumber(order.order_id) || '',
    InvoiceDate: formatXeroDate(order.invoice_date),
    DueDate: formatXeroDate(order.due_date),
    TrackingName1: 'Marketplaces',
    TrackingOption1: 'Alibaba',
    TrackingName2: 'SUPPLIERS',
    TrackingOption2: supplierName,
    Currency: 'AUD'  // Always export in AUD since we have calculated AUD amounts
  };
  
  // If no line items, create a single row with total amount
  if (lineItems.length === 0) {
    // Use AUD amount if available, otherwise fall back to total
    const amount = order.amount_aud || order.total_amount || 0;
    rows.push({
      ...commonFields,
      InventoryItemCode: '',
      Description: order.description || `${order.invoice_type || 'Invoice'} - ${order.order_id || 'No ID'}`,
      Quantity: '1',
      UnitAmount: amount.toFixed(2),
      Discount: '',
      AccountCode: getAccountCode(order.invoice_type),
      TaxType: 'GST Free Expenses', // Always GST Free for Alibaba
      TaxAmount: ''
    });
  } else {
    // Group line items by cost_type and create one row per cost type
    const costTypeTotals: Record<string, { 
      audAmount: number; 
      usdAmount: number;
      description: string;
      costType: string;
    }> = {};
    
    lineItems.forEach((item: any) => {
      // Use robust cost type detection with account code fallback
      const costType = getCostTypeFromItem(item, order.invoice_type);
      const audAmount = toNumber(item.aud_amount ?? item.audAmount ?? 0);
      const usdAmount = getItemUnitPrice(item) * getItemQuantity(item);
      
      if (!costTypeTotals[costType]) {
        costTypeTotals[costType] = {
          audAmount: 0,
          usdAmount: 0,
          description: item.description || item.productName || costType,
          costType
        };
      }
      
      costTypeTotals[costType].audAmount += audAmount;
      costTypeTotals[costType].usdAmount += usdAmount;
    });
    
    // Calculate total USD from line items for proportional AUD split (excluding service fees which have no USD)
    const totalUsd = lineItems.reduce((sum: number, item: any) => {
      return sum + (getItemUnitPrice(item) * getItemQuantity(item));
    }, 0);
    
    // Calculate total AUD already accounted for in line items
    const totalLineItemAud = Object.values(costTypeTotals).reduce((sum, t) => sum + t.audAmount, 0);
    
    // Check for Service Fee line - this is the EXACT amount paid, never adjust it
    const hasServiceFeeLine = 'Service Fee' in costTypeTotals;
    const serviceFeeAud = hasServiceFeeLine ? costTypeTotals['Service Fee'].audAmount : 0;
    const orderAud = toNumber(order.amount_aud);
    
    // CRITICAL: Service Fee is FIXED (user-entered exact amount)
    // Only Product and Freight can be adjusted to match the total
    if (orderAud > 0 && totalLineItemAud > 0 && Math.abs(orderAud - totalLineItemAud) > 0.01) {
      const discrepancy = orderAud - totalLineItemAud;
      console.warn(`AUD discrepancy for order ${order.order_id}: Line items = $${totalLineItemAud.toFixed(2)}, Order total = $${orderAud.toFixed(2)} (gap: $${discrepancy.toFixed(2)})`);
      
      // Calculate the adjustable portion (everything except Service Fee)
      const adjustableTypes = Object.keys(costTypeTotals).filter(ct => ct !== 'Service Fee');
      const adjustableTotal = adjustableTypes.reduce((sum, ct) => sum + costTypeTotals[ct].audAmount, 0);
      
      if (adjustableTotal > 0) {
        // The target for adjustable items = total order AUD minus fixed service fee
        const targetAdjustableTotal = orderAud - serviceFeeAud;
        const adjustmentRatio = targetAdjustableTotal / adjustableTotal;
        
        // Proportional adjustment applied
        
        // Apply proportional adjustment to non-service-fee items
        adjustableTypes.forEach(ct => {
          costTypeTotals[ct].audAmount = costTypeTotals[ct].audAmount * adjustmentRatio;
        });
      }
    } else if (!hasServiceFeeLine && orderAud > 0 && totalLineItemAud === 0 && totalUsd > 0) {
      // No per-item AUD amounts - need to do proportional split
      // Estimate service fee at ~2.99% for Alibaba
      const estimatedServiceFee = orderAud * 0.0299;
      if (estimatedServiceFee > 0.50) {
        // Estimating service fee at ~3% for order without per-item AUD
        const remainingAud = orderAud - estimatedServiceFee;
        
        // Add service fee line
        costTypeTotals['Service Fee'] = {
          audAmount: estimatedServiceFee,
          usdAmount: 0,
          description: 'Alibaba Service Fee (estimated)',
          costType: 'Service Fee'
        };
        
        // Recalculate other cost types with remaining AUD
        Object.keys(costTypeTotals).forEach(ct => {
          if (ct !== 'Service Fee') {
            costTypeTotals[ct].audAmount = (costTypeTotals[ct].usdAmount / totalUsd) * remainingAud;
          }
        });
      }
    }
    
    // Create a row for each cost type
    Object.entries(costTypeTotals).forEach(([costType, totals]) => {
      // Use calculated AUD amount if available, otherwise proportional split
      let amount = totals.audAmount;
      
      // If no AUD amount, do proportional split of full order AUD
      if (amount === 0 && orderAud > 0 && totalUsd > 0) {
        amount = (totals.usdAmount / totalUsd) * orderAud;
      }
      
      // Skip rows with zero amount
      if (amount <= 0) {
        console.warn(`Skipping ${costType} row with zero amount for order ${order.order_id}`);
        return;
      }
      
      rows.push({
        ...commonFields,
        InventoryItemCode: '',
        Description: `${totals.description} (${costType})`,
        Quantity: '1',
        UnitAmount: amount.toFixed(2),
        Discount: '',
        AccountCode: getAccountCode(costType),
        TaxType: 'GST Free Expenses', // Always GST Free for Alibaba/international
        TaxAmount: ''
      });
    });
  }
  
  return rows;
};

// Convert multiple orders to CSV string
export const ordersToXeroCSV = (orders: AlibabaOrderForExport[]): string => {
  const allRows: XeroBillRow[] = [];
  
  orders.forEach(order => {
    const rows = orderToXeroRows(order);
    allRows.push(...rows);
  });
  
  if (allRows.length === 0) {
    return '';
  }
  
  // CSV Headers matching Xero Bill Template
  const headers = [
    'ContactName',
    'EmailAddress',
    'POAddressLine1',
    'POAddressLine2',
    'POAddressLine3',
    'POAddressLine4',
    'POCity',
    'PORegion',
    'POPostalCode',
    'POCountry',
    'InvoiceNumber',
    'Reference',
    'InvoiceDate',
    'DueDate',
    'InventoryItemCode',
    'Description',
    'Quantity',
    'UnitAmount',
    'Discount',
    'AccountCode',
    'TaxType',
    'TaxAmount',
    'TrackingName1',
    'TrackingOption1',
    'TrackingName2',
    'TrackingOption2',
    'Currency'
  ];
  
  // Escape CSV values (handle commas, quotes, newlines)
  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
  
  // Build CSV content
  const csvLines: string[] = [];
  csvLines.push(headers.join(','));
  
  allRows.forEach(row => {
    const values = headers.map(header => escapeCSV(row[header as keyof XeroBillRow] || ''));
    csvLines.push(values.join(','));
  });
  
  return csvLines.join('\n');
};

// Validation result interface
export interface ExportValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  ordersSummary: {
    total: number;
    exported: number;
    skipped: number;
  };
  skippedOrders: { orderId: string; reasons: string[] }[];
  validOrders: AlibabaOrderForExport[];
}

// Check if an order has minimum required data for export
const isOrderExportable = (order: AlibabaOrderForExport): { valid: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  
  if (!order.invoice_date) {
    reasons.push('Missing invoice date');
  }
  
  // Supplier name is now optional - we'll use a fallback in the export
  // if (!order.supplier_name) {
  //   reasons.push('Missing supplier name');
  // }
  
  const lineItems = parseLineItems(order.line_items);
  if (lineItems.length === 0 && (!order.total_amount || order.total_amount <= 0) && (!order.amount_aud || order.amount_aud <= 0)) {
    reasons.push('No line items and no total amount');
  }
  
  return { valid: reasons.length === 0, reasons };
};

// Filter and validate orders for export
export const filterValidOrdersForExport = (orders: AlibabaOrderForExport[]): ExportValidationResult => {
  const warnings: string[] = [];
  const validOrders: AlibabaOrderForExport[] = [];
  const skippedOrders: { orderId: string; reasons: string[] }[] = [];
  
  orders.forEach((order) => {
    const label = order.order_id || order.id;
    const { valid, reasons } = isOrderExportable(order);
    
    if (!valid) {
      skippedOrders.push({ orderId: label, reasons });
      return;
    }
    
    // Order is valid - add to export list, but check for warnings
    validOrders.push(order);
    
    // Check for non-blocking warnings
    const lineItems = parseLineItems(order.line_items);
    lineItems.forEach((item: any, itemIdx: number) => {
      const amount = getItemUnitPrice(item);
      if (amount === 0) {
        warnings.push(`${label} line ${itemIdx + 1}: Zero unit amount`);
      }
    });
  });
  
  return {
    valid: validOrders.length > 0,
    warnings,
    errors: [],
    ordersSummary: { 
      total: orders.length, 
      exported: validOrders.length,
      skipped: skippedOrders.length 
    },
    skippedOrders,
    validOrders
  };
};

// Download CSV file with filtering (skips incomplete orders)
export const downloadXeroCSV = (orders: AlibabaOrderForExport[], filename?: string): ExportValidationResult => {
  // Filter valid orders
  const result = filterValidOrdersForExport(orders);
  
  // Log skipped orders
  if (result.skippedOrders.length > 0) {
    console.warn('Skipped orders:', result.skippedOrders);
  }
  if (result.warnings.length > 0) {
    console.warn('Export warnings:', result.warnings);
  }
  
  // Block if no valid orders
  if (result.validOrders.length === 0) {
    result.errors.push('No valid orders to export');
    result.valid = false;
    return result;
  }
  
  // Generate CSV with valid orders only
  const csv = ordersToXeroCSV(result.validOrders);
  
  if (!csv) {
    result.errors.push('Failed to generate CSV');
    result.valid = false;
    return result;
  }
  
  // Add BOM for UTF-8 Excel compatibility
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  
  // Create download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  const date = new Date().toISOString().split('T')[0];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  // Use a unique filename by default so you never accidentally open an older download.
  link.download = filename || `xero-bills-export-${date}-${stamp}.csv`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  return result;
}
