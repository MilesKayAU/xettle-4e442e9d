import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Upload, Send, ExternalLink, Zap, FileText, X, CheckCircle, CreditCard } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePaymentMethods } from '@/hooks/use-payment-methods';

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number;
  audAmount?: number; // AUD amount for this line item
  accountCode: string;
  taxType: string;
  cost_type?: string; // Product, Freight, or Service Fee
}

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
}

interface AttachedFile {
  id: string;
  name: string;
  path: string;
  size: number;
  uploaded: boolean;
  extracting: boolean;
  extracted: boolean;
  extractedData?: any;
}

interface EnhancedAlibabaOrder {
  id?: string;
  supplier_name: string;
  invoice_type: 'Product' | 'Freight' | 'Service Fee';
  order_id: string;
  invoice_date: string;
  due_date: string;
  currency_code: string;
  pdf_file_path: string | null;
  attachments: AttachedFile[];
  line_items: LineItem[];
  total_amount: number;
  amount_aud?: number; // Total AUD amount paid
  payment_method?: string; // Payment method used (e.g., AMEX, Wise)
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  xero_sync_status: string;
  status: string;
  notes: string;
  country: 'Australia' | 'UK' | 'USA';
}

type InvoiceCountry = 'Australia' | 'UK' | 'USA';

interface EnhancedAlibabaInvoiceFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingOrder?: EnhancedAlibabaOrder | null;
  defaultCountry?: InvoiceCountry;
}

const ACCOUNT_CODE_MAPPING: Record<string, string> = {
  'Product': '631',      // Inventory Account
  'Freight': '425',      // International Freight Costs
  'Service Fee': '411'   // Transaction Service Fee - Alibaba
};

// Reverse mapping for deriving cost_type from accountCode
const COST_TYPE_FROM_ACCOUNT: Record<string, string> = {
  '631': 'Product',
  '310': 'Product',
  '425': 'Freight',
  '411': 'Service Fee',
  '404': 'Service Fee'
};

const TAX_TYPE_OPTIONS = {
  'USD': 'NONE',
  'AUD': 'GST on Expenses'
};

export const EnhancedAlibabaInvoiceForm: React.FC<EnhancedAlibabaInvoiceFormProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editingOrder,
  defaultCountry = 'Australia'
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showExtractPreview, setShowExtractPreview] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const { toast } = useToast();
  const { paymentMethods, loading: paymentMethodsLoading } = usePaymentMethods();

  const [formData, setFormData] = useState<EnhancedAlibabaOrder>({
    supplier_name: '',
    invoice_type: 'Product',
    order_id: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 14 days from now
    currency_code: 'USD',
    pdf_file_path: null,
    attachments: [],
    line_items: [{
      id: '1',
      description: '',
      quantity: 1,
      unitAmount: 0,
      audAmount: 0,
      accountCode: '631',
      taxType: 'NONE',
      cost_type: 'Product'
    }],
    total_amount: 0,
    amount_aud: 0,
    payment_method: '',
    xero_invoice_id: null,
    xero_invoice_number: null,
    xero_sync_status: 'not_synced',
    status: 'draft',
    notes: '',
    country: defaultCountry
  });

  useEffect(() => {
    if (isOpen) {
      fetchSuppliers();
      if (editingOrder) {
        // Ensure attachments is always an array
        const attachments = Array.isArray(editingOrder.attachments) 
          ? editingOrder.attachments 
          : [];
        
        // Transform line items from DB format (snake_case) to form format (camelCase)
        const rawLineItems = Array.isArray(editingOrder.line_items) 
          ? editingOrder.line_items 
          : [];
        
        const lineItems = rawLineItems.length > 0 
          ? rawLineItems.map((item: any, index: number) => {
              const accountCode = item.accountCode || item.account_code || '631';
              // Derive cost_type from account code if not present
              const derivedCostType = COST_TYPE_FROM_ACCOUNT[accountCode] || 'Product';
              return {
                id: item.id || (index + 1).toString(),
                description: item.description || '',
                quantity: Number(item.quantity) || 1,
                // Handle both snake_case (from DB) and camelCase (from form)
                unitAmount: Number(item.unitAmount ?? item.unit_amount ?? 0),
                // Load AUD amount per line item
                audAmount: Number(item.audAmount ?? item.aud_amount ?? 0),
                accountCode,
                taxType: item.taxType || item.tax_type || 'NONE',
                cost_type: item.cost_type || item.costType || derivedCostType
              };
            })
          : [{
              id: '1',
              description: '',
              quantity: 1,
              unitAmount: 0,
              audAmount: 0,
              accountCode: '631',
              taxType: 'NONE',
              cost_type: 'Product'
            }];
        
        const parsedOrder = {
          ...editingOrder,
          attachments,
          line_items: lineItems,
          amount_aud: (editingOrder as any).amount_aud || 0,
          payment_method: (editingOrder as any).payment_method || '',
          country: (editingOrder as any).country || defaultCountry
        };
        setFormData(parsedOrder as EnhancedAlibabaOrder);
      } else {
        // Reset form for new order
        setFormData({
          supplier_name: '',
          invoice_type: 'Product',
          order_id: '',
          invoice_date: new Date().toISOString().split('T')[0],
          due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          currency_code: 'USD',
          pdf_file_path: null,
          attachments: [],
          line_items: [{
            id: '1',
            description: '',
            quantity: 1,
            unitAmount: 0,
            audAmount: 0,
            accountCode: '631',
            taxType: 'NONE',
            cost_type: 'Product'
          }],
          total_amount: 0,
          amount_aud: 0,
          payment_method: '',
          xero_invoice_id: null,
          xero_invoice_number: null,
          xero_sync_status: 'not_synced',
          status: 'draft',
          notes: '',
          country: defaultCountry
        });
      }
    }
  }, [isOpen, editingOrder, defaultCountry]);

  const fetchSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('invoice_suppliers')
        .select('*')
        .order('name');

      if (error) throw error;
      setSuppliers(data || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  const calculateTotal = () => {
    const total = formData.line_items.reduce((sum, item) => 
      sum + (item.quantity * item.unitAmount), 0
    );
    setFormData(prev => ({ ...prev, total_amount: total }));
  };

  useEffect(() => {
    calculateTotal();
  }, [formData.line_items]);

  const handleInvoiceTypeChange = (invoiceType: 'Product' | 'Freight' | 'Service Fee') => {
    const newAccountCode = ACCOUNT_CODE_MAPPING[invoiceType];
    const newTaxType = formData.currency_code === 'AUD' && invoiceType === 'Freight' 
      ? TAX_TYPE_OPTIONS.AUD 
      : TAX_TYPE_OPTIONS.USD;

    setFormData(prev => ({
      ...prev,
      invoice_type: invoiceType,
      line_items: prev.line_items.map(item => ({
        ...item,
        accountCode: newAccountCode,
        taxType: newTaxType,
        cost_type: invoiceType // Update cost_type when invoice type changes
      }))
    }));
  };

  const handleCurrencyChange = (currency: string) => {
    const newTaxType = currency === 'AUD' && formData.invoice_type === 'Freight'
      ? TAX_TYPE_OPTIONS.AUD
      : TAX_TYPE_OPTIONS.USD;

    setFormData(prev => ({
      ...prev,
      currency_code: currency,
      line_items: prev.line_items.map(item => ({
        ...item,
        taxType: newTaxType
      }))
    }));
  };

  const addLineItem = () => {
    const newId = (formData.line_items.length + 1).toString();
    const newItem: LineItem = {
      id: newId,
      description: '',
      quantity: 1,
      unitAmount: 0,
      accountCode: ACCOUNT_CODE_MAPPING[formData.invoice_type],
      taxType: formData.currency_code === 'AUD' && formData.invoice_type === 'Freight' 
        ? TAX_TYPE_OPTIONS.AUD 
        : TAX_TYPE_OPTIONS.USD,
      cost_type: formData.invoice_type // Inherit cost_type from invoice type
    };

    setFormData(prev => ({
      ...prev,
      line_items: [...prev.line_items, newItem]
    }));
  };

  const removeLineItem = (id: string) => {
    if (formData.line_items.length > 1) {
      setFormData(prev => ({
        ...prev,
        line_items: prev.line_items.filter(item => item.id !== id)
      }));
    }
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: any) => {
    setFormData(prev => ({
      ...prev,
      line_items: prev.line_items.map(item =>
        item.id === id ? { ...item, [field]: value } : item
      )
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Allowed file types for attachments
    const allowedTypes = [
      'application/pdf',
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'text/csv',
      'application/vnd.ms-excel', // .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    ];

    for (const file of files) {
      // Validate file type
      const isAllowed = allowedTypes.includes(file.type) || 
        file.name.endsWith('.csv') || 
        file.name.endsWith('.xls') || 
        file.name.endsWith('.xlsx');
      
      if (!isAllowed) {
        toast({
          title: "Invalid File Type",
          description: `${file.name} is not a supported file type`,
          variant: "destructive"
        });
        continue;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: `${file.name} is larger than 5MB`,
          variant: "destructive"
        });
        continue;
      }

      try {
        const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const fileExtension = file.name.split('.').pop() || 'pdf';
        const fileName = `${formData.order_id || 'invoice'}-${fileId}.${fileExtension}`;
        const filePath = `alibaba-invoices/${fileName}`;

        // Add file to state as uploading
        const newFile: AttachedFile = {
          id: fileId,
          name: file.name,
          path: filePath,
          size: file.size,
          uploaded: false,
          extracting: false,
          extracted: false
        };

        setFormData(prev => ({
          ...prev,
          attachments: [...prev.attachments, newFile]
        }));

        const { error: uploadError } = await supabase.storage
          .from('alibaba-attachments')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Update file status to uploaded
        setFormData(prev => ({
          ...prev,
          attachments: prev.attachments.map(f => 
            f.id === fileId ? { ...f, uploaded: true } : f
          ),
          // Set primary PDF path for backward compatibility
          pdf_file_path: prev.pdf_file_path || filePath
        }));
        
        toast({
          title: "Success",
          description: `${file.name} uploaded successfully`
        });
      } catch (error) {
        console.error('Error uploading file:', error);
        toast({
          title: "Upload Error",
          description: `Failed to upload ${file.name}`,
          variant: "destructive"
        });
        
        // Remove failed upload from state by file name since fileId might not be available in catch scope
        setFormData(prev => ({
          ...prev,
          attachments: prev.attachments.filter(f => f.name !== file.name)
        }));
      }
    }
    
    // Clear input
    e.target.value = '';
  };

  const removeAttachment = (fileId: string) => {
    setFormData(prev => ({
      ...prev,
      attachments: prev.attachments.filter(f => f.id !== fileId)
    }));
  };

  const extractDataFromPDF = async (file: AttachedFile) => {
    if (!file.uploaded) {
      toast({
        title: "Error",
        description: "Please wait for the file to finish uploading",
        variant: "destructive"
      });
      return;
    }

    // Check if file is a PDF - current OCR system only supports images
    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.path.includes('.pdf');
    if (isPDF) {
      toast({
        title: "PDF OCR Not Available",
        description: "OCR extraction currently only supports image files (JPG, PNG, GIF, WebP). Please convert your PDF to an image first, or upload images directly.",
        variant: "destructive"
      });
      return;
    }

    // Update file status to extracting
    setFormData(prev => ({
      ...prev,
      attachments: prev.attachments.map(f => 
        f.id === file.id ? { ...f, extracting: true } : f
      )
    }));

    try {
      const { data, error } = await supabase.functions.invoke('extract-invoice-data', {
        body: { filePath: file.path }
      });

      if (error) throw error;

      // Update file with extracted data
      setFormData(prev => ({
        ...prev,
        attachments: prev.attachments.map(f => 
          f.id === file.id ? { 
            ...f, 
            extracting: false, 
            extracted: true, 
            extractedData: data 
          } : f
        )
      }));

      setExtractedData(data);
      setShowExtractPreview(true);

      toast({
        title: "Success",
        description: `Data extracted from ${file.name}`,
      });
    } catch (error: any) {
      console.error('Error extracting data:', error);
      setFormData(prev => ({
        ...prev,
        attachments: prev.attachments.map(f => 
          f.id === file.id ? { ...f, extracting: false } : f
        )
      }));
      
      let errorMessage = `Failed to extract data from ${file.name}`;
      if (error?.message?.includes('Unsupported file type')) {
        errorMessage = `OCR extraction only supports image files. Please convert your PDF to an image (JPG, PNG, GIF, or WebP) first.`;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Extraction Error",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  const applyExtractedData = () => {
    if (!extractedData) return;

    const updates: Partial<EnhancedAlibabaOrder> = {};

    // Map extracted data to form fields
    if (extractedData.supplier_name) {
      updates.supplier_name = extractedData.supplier_name;
    }
    if (extractedData.invoice_type) {
      updates.invoice_type = extractedData.invoice_type;
    }
    if (extractedData.order_id) {
      updates.order_id = extractedData.order_id;
    }
    if (extractedData.invoice_date) {
      updates.invoice_date = extractedData.invoice_date;
    }
    if (extractedData.due_date) {
      updates.due_date = extractedData.due_date;
    }
    if (extractedData.currency_code) {
      updates.currency_code = extractedData.currency_code;
    }
    if (extractedData.total_amount) {
      updates.total_amount = parseFloat(extractedData.total_amount);
    }
    
    // Map line items if available
    if (extractedData.line_items && extractedData.line_items.length > 0) {
      const mappedLineItems = extractedData.line_items.map((item: any, index: number) => ({
        id: (index + 1).toString(),
        description: item.description || '',
        quantity: parseInt(item.quantity) || 1,
        unitAmount: parseFloat(item.unit_amount) || 0,
        accountCode: ACCOUNT_CODE_MAPPING[updates.invoice_type || formData.invoice_type],
        taxType: (updates.currency_code || formData.currency_code) === 'AUD' && 
                  (updates.invoice_type || formData.invoice_type) === 'Freight' 
                    ? TAX_TYPE_OPTIONS.AUD 
                    : TAX_TYPE_OPTIONS.USD
      }));
      updates.line_items = mappedLineItems;
    }

    setFormData(prev => ({ ...prev, ...updates }));
    setShowExtractPreview(false);
    setExtractedData(null);

    toast({
      title: "Success",
      description: "Extracted data applied to form"
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user');

      // Prepare order data for Supabase
      // Note: Supabase JSONB columns accept plain JS objects/arrays directly
      // Transform line items to include snake_case aud_amount for DB consistency
      const transformedLineItems = formData.line_items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unit_amount: item.unitAmount,
        aud_amount: item.audAmount || 0,
        account_code: item.accountCode,
        tax_type: item.taxType,
        cost_type: item.cost_type
      }));

      const orderData: Record<string, unknown> = {
        supplier_name: formData.supplier_name,
        invoice_type: formData.invoice_type,
        order_id: formData.order_id,
        invoice_date: formData.invoice_date,
        due_date: formData.due_date,
        currency_code: formData.currency_code,
        pdf_file_path: formData.pdf_file_path,
        line_items: transformedLineItems,
        attachments: formData.attachments,
        total_amount: formData.total_amount,
        amount_aud: formData.amount_aud || null,
        payment_method: formData.payment_method || null,
        xero_invoice_id: formData.xero_invoice_id,
        xero_invoice_number: formData.xero_invoice_number,
        xero_sync_status: formData.xero_sync_status,
        status: formData.status,
        notes: formData.notes,
        country: formData.country,
        user_id: user.id,
        order_url: formData.order_id ? `https://biz.alibaba.com/ta/detail.htm?${formData.order_id}` : null
      };

      if (editingOrder?.id) {
        const { error } = await supabase
          .from('alibaba_orders')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(orderData as any)
          .eq('id', editingOrder.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('alibaba_orders')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .insert(orderData as any);

        if (error) throw error;
      }

      toast({
        title: "Success",
        description: `Invoice ${editingOrder ? 'updated' : 'created'} successfully`
      });

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving invoice:', error);
      toast({
        title: "Error",
        description: `Failed to ${editingOrder ? 'update' : 'create'} invoice`,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSyncToXero = async () => {
    if (!formData.id) {
      toast({
        title: "Error",
        description: "Please save the invoice first before syncing to Xero",
        variant: "destructive"
      });
      return;
    }

    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-to-xero', {
        body: { 
          invoiceId: formData.id,
          invoiceData: formData
        }
      });

      if (error) throw error;

      if (data.success) {
        setFormData(prev => ({
          ...prev,
          xero_invoice_id: data.xeroInvoiceId,
          xero_invoice_number: data.xeroInvoiceNumber,
          xero_sync_status: 'synced'
        }));

        toast({
          title: "Success",
          description: `Invoice synced to Xero successfully. Invoice #${data.xeroInvoiceNumber}`
        });
        
        onSuccess();
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (error) {
      console.error('Error syncing to Xero:', error);
      toast({
        title: "Sync Error",
        description: error.message || "Failed to sync invoice to Xero",
        variant: "destructive"
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingOrder ? 'Edit' : 'Create New'} Invoice
              {formData.xero_invoice_number && (
                <Badge variant="secondary" className="ml-2">
                  Xero #{formData.xero_invoice_number}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Header Fields */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Invoice Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="supplier">Supplier *</Label>
                    <Select value={formData.supplier_name} onValueChange={(value) => setFormData(prev => ({ ...prev, supplier_name: value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.name}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="invoice_type">Invoice Type *</Label>
                    <Select value={formData.invoice_type} onValueChange={handleInvoiceTypeChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Product">Product</SelectItem>
                        <SelectItem value="Freight">Freight</SelectItem>
                        <SelectItem value="Service Fee">Service Fee</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="order_id">Order/PI ID *</Label>
                    <Input
                      id="order_id"
                      value={formData.order_id}
                      onChange={(e) => setFormData(prev => ({ ...prev, order_id: e.target.value }))}
                      placeholder="ALB-ORDER-1234"
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="currency">Currency *</Label>
                    <Select value={formData.currency_code} onValueChange={handleCurrencyChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="AUD">AUD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="country">Country *</Label>
                    <Select value={formData.country} onValueChange={(value) => setFormData(prev => ({ ...prev, country: value as InvoiceCountry }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Australia">🇦🇺 Australia</SelectItem>
                        <SelectItem value="UK">🇬🇧 UK</SelectItem>
                        <SelectItem value="USA">🇺🇸 USA</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="invoice_date">Invoice Date *</Label>
                    <Input
                      id="invoice_date"
                      type="date"
                      value={formData.invoice_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, invoice_date: e.target.value }))}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="due_date">Due Date *</Label>
                    <Input
                      id="due_date"
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="pdf_upload">Upload Invoice Files</Label>
                  <Input
                    id="pdf_upload"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.csv,.xls,.xlsx,.doc,.docx"
                    multiple
                    onChange={handleFileUpload}
                    className="mt-1"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    📄 Upload PDFs for storage, or 🖼️ images (JPG, PNG, GIF, WebP) for automatic data extraction via OCR
                  </p>
                  
                  {/* Display uploaded files */}
                  {formData.attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <Label className="text-sm text-muted-foreground">Uploaded Files:</Label>
                      {formData.attachments.map((file) => (
                        <div key={file.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            <span className="text-sm font-medium">{file.name}</span>
                            <Badge variant={file.uploaded ? "default" : "secondary"}>
                              {file.uploaded ? "Uploaded" : "Uploading..."}
                            </Badge>
                            {file.extracted && (
                              <Badge variant="outline" className="text-green-600">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Extracted
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {file.uploaded && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => extractDataFromPDF(file)}
                                disabled={file.extracting}
                              >
                                <Zap className="h-3 w-3 mr-1" />
                                {file.extracting ? "Extracting..." : "Extract Data"}
                              </Button>
                            )}
                            
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAttachment(file.id)}
                              className="text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Line Items */}
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">Line Items</CardTitle>
                  <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Line Item
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {formData.line_items.map((item, index) => (
                    <div key={item.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="font-medium">Line Item {index + 1}</h4>
                        {formData.line_items.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLineItem(item.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <Label>Description *</Label>
                          <Textarea
                            value={item.description}
                            onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                            placeholder="Item description"
                            rows={2}
                            required
                          />
                        </div>

                        <div>
                          <Label>Quantity *</Label>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(item.id, 'quantity', parseInt(e.target.value) || 1)}
                            required
                          />
                        </div>

                        <div>
                          <Label>Unit Amount ({formData.currency_code}) *</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitAmount}
                            onChange={(e) => updateLineItem(item.id, 'unitAmount', parseFloat(e.target.value) || 0)}
                            required
                          />
                        </div>

                        <div>
                          <Label>AUD Amount</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.audAmount || ''}
                            onChange={(e) => updateLineItem(item.id, 'audAmount', parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                          />
                        </div>

                        <div>
                          <Label>Account Code</Label>
                          <Input
                            value={item.accountCode}
                            onChange={(e) => updateLineItem(item.id, 'accountCode', e.target.value)}
                            placeholder="310"
                          />
                        </div>

                        <div>
                          <Label>Tax Type</Label>
                          <Select value={item.taxType} onValueChange={(value) => updateLineItem(item.id, 'taxType', value)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">NONE</SelectItem>
                              <SelectItem value="GST on Expenses">GST on Expenses</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="text-right text-sm text-muted-foreground">
                        Line Total: {formData.currency_code} {(item.quantity * item.unitAmount).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4 mt-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="text-lg font-semibold">
                      Total USD: {formData.total_amount.toFixed(2)}
                    </div>
                  </div>
                  
                  {/* AUD Amount & Payment Method Section */}
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-base font-semibold">💵 AUD Amount Paid</Label>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="amount_aud">Total AUD Paid *</Label>
                        <Input
                          id="amount_aud"
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.amount_aud || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, amount_aud: parseFloat(e.target.value) || 0 }))}
                          placeholder="531.95"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Enter the exact AUD amount you paid to Alibaba
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="payment_method" className="flex items-center gap-1">
                          <CreditCard className="h-3 w-3" />
                          Payment Method
                        </Label>
                        <Select 
                          value={formData.payment_method || ''} 
                          onValueChange={(value) => setFormData(prev => ({ ...prev, payment_method: value }))}
                          disabled={paymentMethodsLoading}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select payment method" />
                          </SelectTrigger>
                          <SelectContent className="bg-background z-50">
                            {paymentMethods.map((method) => (
                              <SelectItem key={method} value={method}>{method}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Calculated Rate</Label>
                      <div className="h-10 flex items-center text-sm text-muted-foreground">
                        {formData.amount_aud && formData.total_amount > 0 
                          ? `1 USD = ${(formData.amount_aud / formData.total_amount).toFixed(4)} AUD`
                          : 'Enter AUD amount to see rate'
                        }
                      </div>
                    </div>
                    
                    {/* Auto-calculate AUD split button */}
                    {formData.amount_aud && formData.amount_aud > 0 && formData.total_amount > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const rate = formData.amount_aud! / formData.total_amount;
                          const updatedLineItems = formData.line_items.map(item => ({
                            ...item,
                            audAmount: Math.round(item.quantity * item.unitAmount * rate * 100) / 100
                          }));
                          setFormData(prev => ({ ...prev, line_items: updatedLineItems }));
                        }}
                      >
                        ⚡ Auto-calculate AUD per line item
                      </Button>
                    )}
                    
                    {/* Show per-line AUD breakdown if any have values */}
                    {formData.line_items.some(item => item.audAmount && item.audAmount > 0) && (
                      <div className="text-sm space-y-1 pt-2 border-t">
                        <div className="font-medium">AUD Breakdown:</div>
                        {formData.line_items.map((item, idx) => (
                          <div key={item.id} className="flex justify-between text-muted-foreground">
                            <span>{item.description || `Line ${idx + 1}`} ({item.cost_type})</span>
                            <span>${(item.audAmount || 0).toFixed(2)} AUD</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-semibold pt-1 border-t">
                          <span>Total</span>
                          <span>${formData.line_items.reduce((sum, i) => sum + (i.audAmount || 0), 0).toFixed(2)} AUD</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional notes"
                rows={3}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex justify-between pt-4">
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
              </div>
              
              <div className="flex gap-2">
                {editingOrder?.id && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleSyncToXero}
                    disabled={syncing}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {syncing ? 'Syncing...' : 'Sync to Xero'}
                  </Button>
                )}
                
                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving...' : editingOrder ? 'Update Invoice' : 'Create Invoice'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* OCR Extraction Preview Dialog */}
      <Dialog open={showExtractPreview} onOpenChange={setShowExtractPreview}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Extracted Invoice Data</DialogTitle>
          </DialogHeader>
          
          {extractedData && (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Extracted Information:</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {extractedData.supplier_name && (
                    <div><strong>Supplier:</strong> {extractedData.supplier_name}</div>
                  )}
                  {extractedData.invoice_type && (
                    <div><strong>Type:</strong> {extractedData.invoice_type}</div>
                  )}
                  {extractedData.order_id && (
                    <div><strong>Order ID:</strong> {extractedData.order_id}</div>
                  )}
                  {extractedData.total_amount && (
                    <div><strong>Total:</strong> {extractedData.currency_code || 'USD'} {extractedData.total_amount}</div>
                  )}
                  {extractedData.invoice_date && (
                    <div><strong>Invoice Date:</strong> {extractedData.invoice_date}</div>
                  )}
                  {extractedData.due_date && (
                    <div><strong>Due Date:</strong> {extractedData.due_date}</div>
                  )}
                </div>
                
                {extractedData.line_items && extractedData.line_items.length > 0 && (
                  <div className="mt-3">
                    <strong>Line Items ({extractedData.line_items.length}):</strong>
                    <div className="mt-1 space-y-1">
                      {extractedData.line_items.slice(0, 3).map((item: any, index: number) => (
                        <div key={index} className="text-xs bg-background p-2 rounded">
                          {item.description} - Qty: {item.quantity}, Amount: {item.unit_amount}
                        </div>
                      ))}
                      {extractedData.line_items.length > 3 && (
                        <div className="text-xs text-muted-foreground">
                          ... and {extractedData.line_items.length - 3} more items
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setShowExtractPreview(false)}>
                  Cancel
                </Button>
                <Button onClick={applyExtractedData}>
                  Apply to Form
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};