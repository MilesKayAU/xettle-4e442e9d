import { useState, useCallback, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Sparkles, Upload, FileText, X, Check, AlertCircle, Image, CreditCard, Globe, Plus, Trash2, Calculator, CheckCircle2, TrendingUp, TrendingDown, RefreshCw, FileUp, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSettings } from '@/hooks/use-notification-settings';
import { usePaymentMethods } from '@/hooks/use-payment-methods';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface SupplierDetails {
  name?: string;
  company_name?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address?: string;
  street?: string;
  city?: string;
  province_region_state?: string;
  postal_code?: string;
  country?: string;
  alibaba_store_url?: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  cost_type: 'Product' | 'Freight' | 'Service Fee';
  account_code: string;
  aud_amount?: number;
}

interface ParsedOrderData {
  order_number: string | null;
  order_date: string | null;
  supplier_name: string | null;
  supplier_details: SupplierDetails | null;
  line_items: LineItem[];
  total_amount: number | null;
  currency: string | null;
  suggested_invoice_type: 'Freight' | 'Product' | 'Service Fee' | null;
  shipping_address: string | null;
  payment_date: string | null;
  // Payment image extracted fields
  aud_amount_paid: number | null;
  exchange_rate: number | null;
  payment_method: string | null;
  transaction_id: string | null;
  payment_datetime: string | null;
  // PDF parsing fields
  internal_seller_name?: string | null;
  invoice_number?: string | null;
  gst_registration?: string | null;
}

type InvoiceCountry = 'Australia' | 'UK' | 'USA';
type InputMode = 'paste' | 'pdf';

interface QuickAlibabaInvoiceCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvoiceCreated: () => void;
  defaultCountry?: InvoiceCountry;
}

export function QuickAlibabaInvoiceCreator({ open, onOpenChange, onInvoiceCreated, defaultCountry = 'Australia' }: QuickAlibabaInvoiceCreatorProps) {
  const { toast } = useToast();
  const { notificationEmail, isConfigured: emailConfigured } = useNotificationSettings();
  const { paymentMethods, loading: paymentMethodsLoading } = usePaymentMethods();
  
  // Input mode toggle
  const [inputMode, setInputMode] = useState<InputMode>('paste');
  
  // Paste mode state
  const [pastedContent, setPastedContent] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedOrderData | null>(null);
  
  // PDF mode state
  const [receiptPdf, setReceiptPdf] = useState<File | null>(null);
  const [serviceFeeInvoicePdf, setServiceFeeInvoicePdf] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [serviceFeePreview, setServiceFeePreview] = useState<string | null>(null);
  const [isPdfParsing, setIsPdfParsing] = useState(false);
  
  // invoiceType is now determined per line item, not globally
  const [country, setCountry] = useState<InvoiceCountry>(defaultCountry);
  const [audAmount, setAudAmount] = useState<string>('');
  const [serviceFeeAud, setServiceFeeAud] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [paymentImage, setPaymentImage] = useState<File | null>(null);
  const [paymentImagePreview, setPaymentImagePreview] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  
  // Calculated AUD split values
  const [calculatedAudSplit, setCalculatedAudSplit] = useState<{
    productUsd: number;
    freightUsd: number;
    serviceFeeUsd: number;
    totalProductFreightUsd: number;
    productPercent: number;
    freightPercent: number;
    remainingAud: number;
    productAud: number;
    freightAud: number;
    effectiveRate: number | null;
    isValid: boolean;
  } | null>(null);
  
  // Market exchange rate state
  const [marketRate, setMarketRate] = useState<{
    rate: number;
    date: string;
    source: string;
  } | null>(null);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // Update country when defaultCountry prop changes
  useEffect(() => {
    setCountry(defaultCountry);
  }, [defaultCountry]);

  const resetForm = useCallback(() => {
    setPastedContent('');
    setParsedData(null);
    // invoiceType now determined per line item
    setCountry(defaultCountry);
    setAudAmount('');
    setServiceFeeAud('');
    setPaymentMethod('');
    setAttachments([]);
    setPaymentImage(null);
    setPaymentImagePreview(null);
    setCalculatedAudSplit(null);
    setMarketRate(null);
    setRateError(null);
    // Reset PDF mode state
    setReceiptPdf(null);
    setServiceFeeInvoicePdf(null);
    setReceiptPreview(null);
    setServiceFeePreview(null);
    setInputMode('paste');
  }, [defaultCountry]);

  // Convert PDF to image using pdf.js
  const convertPdfToImage = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    
    const scale = 2.0; // Higher scale for better quality
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
    
    return canvas.toDataURL('image/png');
  }, []);

  // Handle PDF file selection for Receipt
  const handleReceiptPdfSelect = useCallback(async (file: File) => {
    if (!file.type.includes('pdf')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF file",
        variant: "destructive"
      });
      return;
    }
    
    setReceiptPdf(file);
    try {
      const preview = await convertPdfToImage(file);
      setReceiptPreview(preview);
    } catch (err) {
      console.error('PDF preview error:', err);
      setReceiptPreview(null);
    }
  }, [convertPdfToImage, toast]);

  // Handle PDF file selection for Service Fee Invoice
  const handleServiceFeePdfSelect = useCallback(async (file: File) => {
    if (!file.type.includes('pdf')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF file",
        variant: "destructive"
      });
      return;
    }
    
    setServiceFeeInvoicePdf(file);
    try {
      const preview = await convertPdfToImage(file);
      setServiceFeePreview(preview);
    } catch (err) {
      console.error('PDF preview error:', err);
      setServiceFeePreview(null);
    }
  }, [convertPdfToImage, toast]);

  // Parse both PDFs
  const handleParsePdfs = async () => {
    if (!receiptPdf || !serviceFeeInvoicePdf) {
      toast({
        title: "Missing files",
        description: "Please upload both the USD Receipt and Service Fee Invoice PDFs",
        variant: "destructive"
      });
      return;
    }

    setIsPdfParsing(true);
    try {
      // Convert both PDFs to images
      const [receiptImage, serviceFeeImage] = await Promise.all([
        convertPdfToImage(receiptPdf),
        convertPdfToImage(serviceFeeInvoicePdf)
      ]);

      // Call the edge function
      const { data, error } = await supabase.functions.invoke('parse-alibaba-pdfs', {
        body: {
          receiptImageBase64: receiptImage,
          serviceFeeImageBase64: serviceFeeImage
        }
      });

      if (error) throw error;

      if (data?.success && data?.data) {
        const parsed = data.data;
        
        // Map to ParsedOrderData format
        const mappedData: ParsedOrderData = {
          // IMPORTANT: keep the base Alibaba order id separate from the invoice number,
          // since invoice numbers can include suffixes like `_100...`.
          order_number: parsed.order_number || parsed.invoice_number || null,
          order_date: parsed.invoice_date || parsed.order_date,
          supplier_name: parsed.supplier_name,
          supplier_details: null,
          line_items: parsed.line_items || [],
          total_amount: parsed.total_usd,
          currency: parsed.currency || 'USD',
          suggested_invoice_type: 'Product',
          shipping_address: null,
          payment_date: null,
          aud_amount_paid: parsed.total_aud,
          exchange_rate: data.effective_rate,
          payment_method: null,
          transaction_id: null,
          payment_datetime: null,
          internal_seller_name: parsed.internal_seller_name,
          invoice_number: parsed.invoice_number,
          gst_registration: parsed.gst_registration
        };

        setParsedData(mappedData);
        
        // Auto-fill AUD amounts
        if (parsed.total_aud) {
          setAudAmount(parsed.total_aud.toString());
        }
        if (parsed.service_fee_aud) {
          setServiceFeeAud(parsed.service_fee_aud.toString());
        }

        // Add PDFs to attachments
        setAttachments([receiptPdf, serviceFeeInvoicePdf]);

        toast({
          title: "PDFs parsed successfully",
          description: `Order #${parsed.order_number || 'unknown'} with ${parsed.line_items?.length || 0} line items`
        });
      } else {
        throw new Error(data?.error || 'Failed to parse PDFs');
      }
    } catch (error: any) {
      console.error('PDF parse error:', error);
      toast({
        title: "Parse failed",
        description: error.message || "Could not parse the PDF files",
        variant: "destructive"
      });
    } finally {
      setIsPdfParsing(false);
    }
  };
  
  // Fetch market exchange rate
  const fetchMarketRate = useCallback(async () => {
    setIsLoadingRate(true);
    setRateError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('get-exchange-rate', {
        body: { from: 'USD', to: 'AUD' }
      });
      
      if (error) throw error;
      
      if (data?.success) {
        setMarketRate({
          rate: data.rate,
          date: data.date,
          source: data.source
        });
      } else {
        throw new Error(data?.error || 'Failed to fetch rate');
      }
    } catch (error: any) {
      console.error('Exchange rate error:', error);
      setRateError(error.message || 'Could not fetch exchange rate');
    } finally {
      setIsLoadingRate(false);
    }
  }, []);
  
  // Fetch market rate when dialog opens and there's parsed data with USD
  useEffect(() => {
    if (parsedData && !marketRate && !isLoadingRate) {
      fetchMarketRate();
    }
  }, [parsedData, marketRate, isLoadingRate, fetchMarketRate]);
  
  // Calculate AUD split when relevant values change
  useEffect(() => {
    if (!parsedData || !audAmount) {
      setCalculatedAudSplit(null);
      return;
    }
    
    const totalAud = parseFloat(audAmount) || 0;
    const serviceFee = parseFloat(serviceFeeAud) || 0;
    
    if (totalAud <= 0) {
      setCalculatedAudSplit(null);
      return;
    }
    
    // Sum USD by cost type
    const productUsd = parsedData.line_items
      .filter(i => i.cost_type === 'Product')
      .reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
      
    const freightUsd = parsedData.line_items
      .filter(i => i.cost_type === 'Freight')
      .reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
      
    const serviceFeeUsd = parsedData.line_items
      .filter(i => i.cost_type === 'Service Fee')
      .reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
    
    const totalProductFreightUsd = productUsd + freightUsd;
    
    // Calculate remaining AUD for Product + Freight
    const remainingAud = totalAud - serviceFee;
    
    // Calculate percentages
    const productPercent = totalProductFreightUsd > 0 ? (productUsd / totalProductFreightUsd) * 100 : 0;
    const freightPercent = totalProductFreightUsd > 0 ? (freightUsd / totalProductFreightUsd) * 100 : 0;
    
    // Proportional split
    const productAud = totalProductFreightUsd > 0 
      ? (productUsd / totalProductFreightUsd) * remainingAud 
      : 0;
    const freightAud = totalProductFreightUsd > 0 
      ? (freightUsd / totalProductFreightUsd) * remainingAud 
      : 0;
    
    // Effective exchange rate (USD to AUD for Product + Freight)
    const effectiveRate = totalProductFreightUsd > 0 
      ? remainingAud / totalProductFreightUsd 
      : null;
    
    // Validate: totals must match
    const calculatedTotal = productAud + freightAud + serviceFee;
    const isValid = Math.abs(calculatedTotal - totalAud) < 0.01;
    
    setCalculatedAudSplit({
      productUsd,
      freightUsd,
      serviceFeeUsd,
      totalProductFreightUsd,
      productPercent,
      freightPercent,
      remainingAud,
      productAud,
      freightAud,
      effectiveRate,
      isValid
    });
  }, [parsedData, audAmount, serviceFeeAud]);

  const processImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please use an image (PNG, JPG). PDFs must be converted to images first.",
        variant: "destructive"
      });
      return;
    }
    setPaymentImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPaymentImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    toast({
      title: "Image added",
      description: "Payment receipt image ready for parsing"
    });
  }, [toast]);

  const handlePaymentImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  // Handle paste event for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          // Rename pasted images with a descriptive name
          const extension = file.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const renamedFile = new File([file], `payment-receipt-${timestamp}.${extension}`, { type: file.type });
          processImageFile(renamedFile);
        }
        return;
      }
    }
  }, [processImageFile]);

  const removePaymentImage = () => {
    setPaymentImage(null);
    setPaymentImagePreview(null);
  };

  const handleParse = async () => {
    if (!pastedContent.trim()) {
      toast({
        title: "No content",
        description: "Please paste Alibaba order content first",
        variant: "destructive"
      });
      return;
    }

    setIsParsing(true);
    try {
      // Convert payment image to base64 if present
      let paymentImageBase64: string | null = null;
      if (paymentImage) {
        paymentImageBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(paymentImage);
        });
      }

      const { data, error } = await supabase.functions.invoke('parse-alibaba-order', {
        body: { 
          pastedContent,
          paymentImageBase64 
        }
      });

      if (error) throw error;

      if (data?.success && data?.data) {
        // Ensure all line items have cost_type and account_code
        const lineItemsWithCostType = (data.data.line_items || []).map((item: any) => ({
          ...item,
          cost_type: item.cost_type || data.data.suggested_invoice_type || 'Product',
          account_code: item.account_code || (
            item.cost_type === 'Freight' ? '425' : 
            item.cost_type === 'Service Fee' ? '631' : '310'
          )
        }));
        setParsedData({
          ...data.data,
          line_items: lineItemsWithCostType
        });
        // Auto-fill AUD amount if extracted from payment image
        if (data.data.aud_amount_paid) {
          setAudAmount(data.data.aud_amount_paid.toString());
        }
        // Auto-fill payment method if extracted
        if (data.data.payment_method) {
          setPaymentMethod(data.data.payment_method);
        }
        
        const hasPaymentData = data.data.aud_amount_paid;
        toast({
          title: "Parsed successfully",
          description: hasPaymentData 
            ? `Found order #${data.data.order_number || 'unknown'} with AUD $${data.data.aud_amount_paid?.toFixed(2)}` 
            : `Found order #${data.data.order_number || 'unknown'}`
        });
      } else {
        throw new Error(data?.error || 'Failed to parse order');
      }
    } catch (error: any) {
      console.error('Parse error:', error);
      toast({
        title: "Parse failed",
        description: error.message || "Could not parse the pasted content",
        variant: "destructive"
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments(prev => [...prev, ...files]);
  };

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setAttachments(prev => [...prev, ...files]);
  }, []);

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Line item handlers
  const handleAddLineItem = () => {
    if (!parsedData) return;
    const newItem: LineItem = {
      description: '',
      quantity: 1,
      unit_price: 0,
      total: 0,
      cost_type: 'Product',
      account_code: '310'
    };
    setParsedData({
      ...parsedData,
      line_items: [...parsedData.line_items, newItem]
    });
  };

  const handleUpdateLineItem = (index: number, field: keyof LineItem, value: any) => {
    if (!parsedData) return;
    const updatedItems = [...parsedData.line_items];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: value,
      // Auto-update account_code when cost_type changes
      ...(field === 'cost_type' && {
        account_code: value === 'Freight' ? '425' : value === 'Service Fee' ? '631' : '310'
      }),
      // Auto-update total when quantity or unit_price changes
      ...(field === 'quantity' && { total: value * updatedItems[index].unit_price }),
      ...(field === 'unit_price' && { total: updatedItems[index].quantity * value })
    };
    
    // Recalculate total_amount
    const newTotal = updatedItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    
    setParsedData({
      ...parsedData,
      line_items: updatedItems,
      total_amount: newTotal
    });
  };

  const handleRemoveLineItem = (index: number) => {
    if (!parsedData || parsedData.line_items.length <= 1) return;
    const updatedItems = parsedData.line_items.filter((_, i) => i !== index);
    const newTotal = updatedItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    
    setParsedData({
      ...parsedData,
      line_items: updatedItems,
      total_amount: newTotal
    });
  };

  const handleCreate = useCallback(async () => {
    console.log('[handleCreate] Starting with attachments:', attachments.map(f => f.name));
    console.log('[handleCreate] Payment image:', paymentImage?.name || 'none');
    
    if (!parsedData) {
      toast({
        title: "No data",
        description: "Please parse order content first",
        variant: "destructive"
      });
      return;
    }

    // Validate that all line items have valid data
    const hasValidLineItems = parsedData.line_items.every(item => 
      item.description.trim() && item.quantity > 0 && item.unit_price >= 0
    );
    
    if (!hasValidLineItems) {
      toast({
        title: "Invalid line items",
        description: "Please ensure all line items have a description and valid quantity/price",
        variant: "destructive"
      });
      return;
    }

    setIsCreating(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if supplier exists and create if not
      let supplierCreated = false;
      if (parsedData.supplier_name) {
        const supplierName = parsedData.supplier_name.trim();
        console.log('Checking supplier:', supplierName);
        console.log('Supplier details from AI:', parsedData.supplier_details);
        
        // Check if supplier already exists (case-insensitive match)
        const { data: existingSuppliers, error: checkError } = await supabase
          .from('suppliers')
          .select('id, name')
          .ilike('name', supplierName);
        
        if (checkError) {
          console.error('Error checking for existing supplier:', checkError);
        }
        
        console.log('Existing suppliers found:', existingSuppliers);
        
        if (!existingSuppliers || existingSuppliers.length === 0) {
          // Create new supplier with extracted details
          const supplierDetails = parsedData.supplier_details || {};
          console.log('Creating new supplier with details:', supplierDetails);
          
          const supplierInsertData = {
            name: supplierName,
            company_name: supplierDetails.company_name || supplierName,
            contact_person: supplierDetails.contact_person || null,
            email: supplierDetails.email || null,
            phone: supplierDetails.phone || null,
            mobile: supplierDetails.mobile || null,
            website: supplierDetails.website || supplierDetails.alibaba_store_url || null,
            address: supplierDetails.address || null,
            street: supplierDetails.street || null,
            city: supplierDetails.city || null,
            province_region_state: supplierDetails.province_region_state || null,
            postal_code: supplierDetails.postal_code || null,
            country: supplierDetails.country || 'China',
            notes: `Auto-created from Alibaba order. Store URL: ${supplierDetails.alibaba_store_url || 'N/A'}`
          };
          
          console.log('Inserting supplier:', supplierInsertData);
          
          const { data: newSupplier, error: supplierError } = await supabase
            .from('suppliers')
            .insert(supplierInsertData)
            .select();
          
          if (supplierError) {
            console.error('Supplier creation error:', supplierError);
            toast({
              title: "Supplier creation warning",
              description: `Could not create supplier: ${supplierError.message}`,
              variant: "destructive"
            });
          } else {
            console.log('New supplier created:', newSupplier);
            supplierCreated = true;
          }
        } else {
          console.log('Supplier already exists, skipping creation');
        }
      } else {
        console.log('No supplier_name in parsed data, skipping supplier creation');
      }

      // Calculate due date (14 days from invoice date)
      const invoiceDate = parsedData.order_date || new Date().toISOString().split('T')[0];
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + 14);

      // Prepare line items with per-item account codes and AUD amounts based on calculated split
      const lineItems = parsedData.line_items.map(item => {
        const itemUsdTotal = item.quantity * item.unit_price;
        let audAmountForItem: number | null = null;
        
        // Calculate AUD amount for each line item based on the split
        if (calculatedAudSplit) {
          if (item.cost_type === 'Service Fee') {
            // Service fee uses the exact AUD entered
            const serviceFeeItems = parsedData.line_items.filter(i => i.cost_type === 'Service Fee');
            const totalServiceFeeUsd = serviceFeeItems.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
            // Proportionally split the service fee AUD among service fee line items
            audAmountForItem = totalServiceFeeUsd > 0 
              ? (itemUsdTotal / totalServiceFeeUsd) * (parseFloat(serviceFeeAud) || 0)
              : 0;
          } else if (item.cost_type === 'Product') {
            // Product gets proportional share based on USD ratio
            audAmountForItem = calculatedAudSplit.productUsd > 0
              ? (itemUsdTotal / calculatedAudSplit.productUsd) * calculatedAudSplit.productAud
              : 0;
          } else if (item.cost_type === 'Freight') {
            // Freight gets proportional share based on USD ratio
            audAmountForItem = calculatedAudSplit.freightUsd > 0
              ? (itemUsdTotal / calculatedAudSplit.freightUsd) * calculatedAudSplit.freightAud
              : 0;
          }
        }
        
        return {
          description: item.description,
          quantity: item.quantity,
          unit_amount: item.unit_price,
          aud_amount: audAmountForItem,
          account_code: item.account_code || (
            item.cost_type === 'Freight' ? '425' : 
            item.cost_type === 'Service Fee' ? '411' : '310'
          ),
          cost_type: item.cost_type,
          tax_type: 'GST Free Expenses' // International suppliers
        };
      });
      
      // AUTO-ADD Service Fee line item if user entered a service fee AUD but no Service Fee line exists
      const hasServiceFeeLine = parsedData.line_items.some(i => i.cost_type === 'Service Fee');
      const serviceFeeAudValue = parseFloat(serviceFeeAud) || 0;
      
      if (!hasServiceFeeLine && serviceFeeAudValue > 0) {
        // Calculate USD equivalent based on the effective exchange rate
        const effectiveRate = calculatedAudSplit?.effectiveRate || 1.52; // fallback rate
        const serviceFeeUsd = serviceFeeAudValue / effectiveRate;
        
        lineItems.push({
          description: 'Alibaba Service Fee',
          quantity: 1,
          unit_amount: Math.round(serviceFeeUsd * 100) / 100,
          aud_amount: serviceFeeAudValue,
          account_code: '411',
          cost_type: 'Service Fee',
          tax_type: 'GST Free Expenses'
        });
        console.log(`Auto-created Service Fee line item: $${serviceFeeAudValue.toFixed(2)} AUD`);
      }

      // Determine primary invoice type from line items (most common or first)
      const costTypeCounts = parsedData.line_items.reduce((acc, item) => {
        acc[item.cost_type] = (acc[item.cost_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const primaryInvoiceType = Object.entries(costTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Product';

      // Create the order
      const { data: order, error: orderError } = await supabase
        .from('alibaba_orders')
        .insert({
          user_id: user.id,
          order_id: parsedData.order_number,
          supplier_name: parsedData.supplier_name,
          invoice_type: primaryInvoiceType,
          invoice_date: invoiceDate,
          due_date: dueDate.toISOString().split('T')[0],
          total_amount: parsedData.total_amount,
          amount_aud: audAmount ? parseFloat(audAmount) : null,
          currency_code: parsedData.currency || 'USD',
          line_items: lineItems,
          pay_date: parsedData.payment_date || parsedData.payment_datetime?.split('T')[0],
          payment_method: paymentMethod || null,
          status: 'pending',
          xero_sync_status: 'not_synced',
          country: country,
          order_url: parsedData.order_number 
            ? `https://trade.alibaba.com/order/detail.htm?orderId=${parsedData.order_number}`
            : null,
          attachments: []
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Upload attachments if any
      console.log('[handleCreate] Preparing to upload - attachments count:', attachments.length);
      const allFiles = [...attachments];
      if (paymentImage) {
        allFiles.push(paymentImage);
      }
      console.log('[handleCreate] Total files to upload:', allFiles.map(f => f.name));
      
      if (allFiles.length > 0 && order) {
        const uploadedPaths: string[] = [];
        
        for (const file of allFiles) {
          const filePath = `${user.id}/${order.id}/${file.name}`;
          const { error: uploadError } = await supabase.storage
            .from('alibaba-attachments')
            .upload(filePath, file);
          
          if (uploadError) {
            console.error('Upload error:', uploadError);
          } else {
            uploadedPaths.push(filePath);
          }
        }

        // Update order with attachment paths
        if (uploadedPaths.length > 0) {
          await supabase
            .from('alibaba_orders')
            .update({ attachments: uploadedPaths })
            .eq('id', order.id);
        }
      }

      // Send email notification if configured
      if (emailConfigured && notificationEmail && order) {
        try {
          console.log('Sending invoice notification to:', notificationEmail);
          const { data: emailResult, error: emailError } = await supabase.functions.invoke('send-invoice-notification', {
            body: {
              to_email: notificationEmail,
              invoice_id: order.id,
              supplier_name: parsedData.supplier_name,
              order_id: parsedData.order_number,
              amount: audAmount ? parseFloat(audAmount) : parsedData.total_amount,
              currency: audAmount ? 'AUD' : (parsedData.currency || 'USD'),
              invoice_type: primaryInvoiceType
            }
          });
          
          if (emailError) {
            console.error('Email notification error:', emailError);
          } else {
            console.log('Email notification sent:', emailResult);
          }
        } catch (emailErr) {
          console.error('Failed to send email notification:', emailErr);
          // Don't fail the whole operation if email fails
        }
      }

      const successMessage = supplierCreated 
        ? `Order #${parsedData.order_number} created + new supplier added`
        : `Order #${parsedData.order_number} created successfully`;
      
      toast({
        title: "Invoice created",
        description: successMessage
      });

      resetForm();
      onOpenChange(false);
      onInvoiceCreated();

    } catch (error: any) {
      console.error('Create error:', error);
      toast({
        title: "Creation failed",
        description: error.message || "Could not create invoice",
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  }, [
    parsedData,
    attachments,
    paymentImage,
    audAmount,
    serviceFeeAud,
    paymentMethod,
    country,
    calculatedAudSplit,
    emailConfigured,
    notificationEmail,
    toast,
    onInvoiceCreated,
    resetForm,
    onOpenChange
  ]);

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen) resetForm();
      onOpenChange(newOpen);
    }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Quick Invoice Creator
          </DialogTitle>
          <DialogDescription>
            Upload Alibaba PDFs or paste order content to auto-extract invoice details
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2" onPaste={handlePaste}>
          {/* Input Mode Tabs */}
          <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as InputMode)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pdf" className="flex items-center gap-2">
                <FileUp className="h-4 w-4" />
                Upload PDFs
              </TabsTrigger>
              <TabsTrigger value="paste" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Paste Text
              </TabsTrigger>
            </TabsList>

            {/* PDF Upload Mode */}
            <TabsContent value="pdf" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Receipt PDF Drop Zone */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    USD Receipt PDF
                  </Label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                      receiptPdf 
                        ? 'border-primary/50 bg-primary/5' 
                        : 'border-muted-foreground/25 hover:border-primary/50'
                    }`}
                    onClick={() => document.getElementById('receipt-pdf-upload')?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file) handleReceiptPdfSelect(file);
                    }}
                  >
                    {receiptPreview ? (
                      <div className="relative">
                        <img src={receiptPreview} alt="Receipt preview" className="max-h-24 mx-auto rounded" />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-0 right-0 h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReceiptPdf(null);
                            setReceiptPreview(null);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <p className="text-xs mt-2 text-muted-foreground truncate">{receiptPdf?.name}</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Drop or click to upload</p>
                        <p className="text-xs text-muted-foreground mt-1">The receipt with order details</p>
                      </>
                    )}
                    <input
                      id="receipt-pdf-upload"
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleReceiptPdfSelect(file);
                      }}
                    />
                  </div>
                </div>

                {/* Service Fee Invoice PDF Drop Zone */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Service Fee Invoice PDF
                  </Label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                      serviceFeeInvoicePdf 
                        ? 'border-primary/50 bg-primary/5' 
                        : 'border-muted-foreground/25 hover:border-primary/50'
                    }`}
                    onClick={() => document.getElementById('service-fee-pdf-upload')?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file) handleServiceFeePdfSelect(file);
                    }}
                  >
                    {serviceFeePreview ? (
                      <div className="relative">
                        <img src={serviceFeePreview} alt="Service fee preview" className="max-h-24 mx-auto rounded" />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute top-0 right-0 h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setServiceFeeInvoicePdf(null);
                            setServiceFeePreview(null);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <p className="text-xs mt-2 text-muted-foreground truncate">{serviceFeeInvoicePdf?.name}</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Drop or click to upload</p>
                        <p className="text-xs text-muted-foreground mt-1">The invoice with exact service fee</p>
                      </>
                    )}
                    <input
                      id="service-fee-pdf-upload"
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleServiceFeePdfSelect(file);
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Parse PDFs Button */}
              <Button
                onClick={handleParsePdfs}
                disabled={isPdfParsing || !receiptPdf || !serviceFeeInvoicePdf}
                className="w-full"
              >
                {isPdfParsing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Extracting data from PDFs...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Parse Both PDFs with AI
                  </>
                )}
              </Button>

              {/* PDF Mode Info */}
              {!parsedData && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Zero manual entry required!</p>
                    <p className="mt-1">Upload both PDFs and the AI will extract all line items, auto-assign cost types (Product/Freight/Service Fee), and calculate exact AUD splits. The Service Fee AUD will be locked to the exact amount from the invoice.</p>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Paste Text Mode */}
            <TabsContent value="paste" className="space-y-4 mt-4">
              {/* Paste Box */}
              <div className="space-y-2">
                <Label htmlFor="paste-content">Paste Order Content</Label>
                <Textarea
                  id="paste-content"
                  placeholder="Paste the entire Alibaba order page content here..."
                  value={pastedContent}
                  onChange={(e) => setPastedContent(e.target.value)}
                  className="min-h-[120px] font-mono text-sm"
                />
              </div>

              {/* Payment Image Upload - with paste support */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Payment Receipt Image (Optional)
                </Label>
                <p className="text-xs text-muted-foreground">
                  <strong>Paste (Ctrl+V)</strong> or upload a screenshot of your payment confirmation to auto-extract AUD amount
                </p>
                
                {!paymentImagePreview ? (
                  <div
                    className="border-2 border-dashed border-primary/30 bg-primary/5 rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors focus:outline-none focus:border-primary"
                    onClick={() => document.getElementById('payment-image-upload')?.click()}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        document.getElementById('payment-image-upload')?.click();
                      }
                    }}
                  >
                    <Image className="h-6 w-6 mx-auto text-primary/60 mb-1" />
                    <p className="text-sm text-primary/80">
                      <strong>Ctrl+V</strong> to paste or click to upload
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PNG, JPG screenshot
                    </p>
                    <input
                      id="payment-image-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePaymentImageUpload}
                    />
                  </div>
                ) : (
                  <div className="relative border rounded-lg p-2 bg-muted/30">
                    <img 
                      src={paymentImagePreview} 
                      alt="Payment receipt" 
                      className="max-h-32 mx-auto rounded"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={removePaymentImage}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <p className="text-xs text-center mt-2 text-muted-foreground">
                      {paymentImage?.name || 'Pasted image'}
                    </p>
                  </div>
                )}
              </div>

              {/* Parse Button */}
              <Button 
                onClick={handleParse} 
                disabled={isParsing || !pastedContent.trim()}
                className="w-full"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {paymentImage ? 'Parsing with AI (analyzing payment image)...' : 'Parsing with AI...'}
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Parse with AI {paymentImage && '(+ extract payment details)'}
                  </>
                )}
              </Button>
            </TabsContent>
          </Tabs>

          {/* Parsed Data Preview */}
          {parsedData && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    Parsed Data
                  </h3>
                  <div className="flex gap-2">
                    {inputMode === 'pdf' && (
                      <Badge variant="default" className="bg-primary">
                        PDF Extracted
                      </Badge>
                    )}
                    {parsedData.suggested_invoice_type && inputMode === 'paste' && (
                      <Badge variant="secondary">
                        AI suggests: {parsedData.suggested_invoice_type}
                      </Badge>
                    )}
                    {parsedData.aud_amount_paid && (
                      <Badge variant="default" className="bg-primary">
                        AUD extracted
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Order #:</span>
                    <span className="ml-2 font-mono">{parsedData.order_number || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date:</span>
                    <span className="ml-2">{parsedData.order_date || 'N/A'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Xero Supplier:</span>
                    <span className="ml-2">{parsedData.supplier_name || 'N/A'}</span>
                  </div>
                  {/* Show internal seller name when available (from PDF mode) */}
                  {parsedData.internal_seller_name && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Internal Seller:</span>
                      <span className="ml-2 text-primary">{parsedData.internal_seller_name}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Total ({parsedData.currency || 'USD'}):</span>
                    <span className="ml-2 font-semibold">
                      {parsedData.currency || 'USD'} {parsedData.total_amount?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Items:</span>
                    <span className="ml-2">{parsedData.line_items?.length || 0} line items</span>
                  </div>
                </div>

                {/* Payment Details from Image or PDF */}
                {(parsedData.aud_amount_paid || parsedData.exchange_rate || parsedData.payment_method) && (
                  <div className="border-t pt-3 mt-3">
                    <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                      <CreditCard className="h-4 w-4 text-primary" />
                      Payment Details {inputMode === 'pdf' ? '(extracted from PDFs)' : '(extracted from image)'}
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm bg-primary/10 p-3 rounded">
                      {parsedData.aud_amount_paid && (
                        <div>
                          <span className="text-muted-foreground">AUD Paid:</span>
                          <span className="ml-2 font-semibold text-primary">
                            ${parsedData.aud_amount_paid.toFixed(2)}
                          </span>
                        </div>
                      )}
                      {parsedData.exchange_rate && (
                        <div>
                          <span className="text-muted-foreground">Rate:</span>
                          <span className="ml-2">{parsedData.exchange_rate}</span>
                        </div>
                      )}
                      {parsedData.payment_method && (
                        <div>
                          <span className="text-muted-foreground">Method:</span>
                          <span className="ml-2">{parsedData.payment_method}</span>
                        </div>
                      )}
                      {parsedData.transaction_id && (
                        <div>
                          <span className="text-muted-foreground">Ref:</span>
                          <span className="ml-2 font-mono text-xs">{parsedData.transaction_id}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Editable Line Items */}
                {parsedData.line_items && parsedData.line_items.length > 0 && (
                  <div className="mt-4 border-t pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Line Items (editable)</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddLineItem}
                        className="h-7 text-xs"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Line
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {parsedData.line_items.map((item, idx) => (
                        <div key={idx} className="bg-muted/50 p-3 rounded-lg space-y-2">
                          <div className="flex gap-2 items-start">
                            <div className="flex-1">
                              <Label className="text-xs text-muted-foreground">Description</Label>
                              <Input
                                value={item.description}
                                onChange={(e) => handleUpdateLineItem(idx, 'description', e.target.value)}
                                className="h-8 text-sm"
                                placeholder="Item description"
                              />
                            </div>
                            <div className="w-20">
                              <Label className="text-xs text-muted-foreground">Qty</Label>
                              <Input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => handleUpdateLineItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="w-28">
                              <Label className="text-xs text-muted-foreground">Unit Price</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.unit_price}
                                onChange={(e) => handleUpdateLineItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                                className="h-8 text-sm"
                              />
                            </div>
                            {parsedData.line_items.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 mt-5 text-destructive hover:text-destructive"
                                onClick={() => handleRemoveLineItem(idx)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          <div className="flex gap-2 items-center">
                            <div className="flex-1">
                              <Label className="text-xs text-muted-foreground">Cost Type</Label>
                              <Select
                                value={item.cost_type}
                                onValueChange={(v) => handleUpdateLineItem(idx, 'cost_type', v as 'Product' | 'Freight' | 'Service Fee')}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-background z-50">
                                  <SelectItem value="Product">Product (310)</SelectItem>
                                  <SelectItem value="Freight">Freight (425)</SelectItem>
                                  <SelectItem value="Service Fee">Service Fee (631)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-32 text-right mt-5">
                              <Badge variant="outline" className="font-mono">
                                ${(item.quantity * item.unit_price).toFixed(2)}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-end text-sm font-medium">
                      Total: {parsedData.currency || 'USD'} ${parsedData.line_items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Country & Payment Details */}
          {parsedData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="country" className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  Country *
                </Label>
                <Select value={country} onValueChange={(v) => setCountry(v as InvoiceCountry)}>
                  <SelectTrigger id="country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="Australia">🇦🇺 Australia</SelectItem>
                    <SelectItem value="UK">🇬🇧 UK</SelectItem>
                    <SelectItem value="USA">🇺🇸 USA</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="aud-amount">Total AUD Paid *</Label>
                <Input
                  id="aud-amount"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 545.00"
                  value={audAmount}
                  onChange={(e) => setAudAmount(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="service-fee-aud">Service Fee AUD</Label>
                <Input
                  id="service-fee-aud"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 13.85"
                  value={serviceFeeAud}
                  onChange={(e) => setServiceFeeAud(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-method">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={paymentMethodsLoading}>
                  <SelectTrigger id="payment-method">
                    <SelectValue placeholder={paymentMethodsLoading ? "Loading..." : "Select method"} />
                  </SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    {paymentMethods.map((method) => (
                      <SelectItem key={method} value={method}>{method}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* AUD Currency Split Calculator */}
          {parsedData && audAmount && (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
              <CardContent className="pt-4">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Calculator className="h-4 w-4 text-primary" />
                  AUD Currency Split Calculator
                  {calculatedAudSplit?.isValid && (
                    <Badge variant="default" className="bg-green-600 ml-auto">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Verified
                    </Badge>
                  )}
                </h3>
                
                {calculatedAudSplit ? (
                  <div className="space-y-4">
                    {/* USD Breakdown */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-muted/50 p-3 rounded-lg">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">USD BREAKDOWN</h4>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span>Product:</span>
                            <span className="font-mono">USD ${calculatedAudSplit.productUsd.toFixed(2)} ({calculatedAudSplit.productPercent.toFixed(0)}%)</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Freight:</span>
                            <span className="font-mono">USD ${calculatedAudSplit.freightUsd.toFixed(2)} ({calculatedAudSplit.freightPercent.toFixed(0)}%)</span>
                          </div>
                          {calculatedAudSplit.serviceFeeUsd > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>Service Fee:</span>
                              <span className="font-mono">USD ${calculatedAudSplit.serviceFeeUsd.toFixed(2)} (separate)</span>
                            </div>
                          )}
                          <div className="border-t pt-1 mt-1 flex justify-between font-medium">
                            <span>Product+Freight:</span>
                            <span className="font-mono">USD ${calculatedAudSplit.totalProductFreightUsd.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-primary/10 p-3 rounded-lg">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">CALCULATED AUD SPLIT</h4>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span>Product AUD:</span>
                            <span className="font-mono font-semibold text-primary">${calculatedAudSplit.productAud.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Freight AUD:</span>
                            <span className="font-mono font-semibold text-primary">${calculatedAudSplit.freightAud.toFixed(2)}</span>
                          </div>
                          {(parseFloat(serviceFeeAud) || 0) > 0 && (
                            <div className="flex justify-between">
                              <span>Service Fee AUD:</span>
                              <span className="font-mono font-semibold text-primary">${parseFloat(serviceFeeAud).toFixed(2)}</span>
                            </div>
                          )}
                          <div className="border-t pt-1 mt-1 flex justify-between font-bold">
                            <span>Total:</span>
                            <span className="font-mono">${(calculatedAudSplit.productAud + calculatedAudSplit.freightAud + (parseFloat(serviceFeeAud) || 0)).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Exchange Rate Comparison */}
                    {calculatedAudSplit.effectiveRate && (
                      <div className="bg-muted/30 p-3 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-medium text-muted-foreground">EXCHANGE RATE COMPARISON</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={fetchMarketRate}
                            disabled={isLoadingRate}
                          >
                            {isLoadingRate ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Refresh
                              </>
                            )}
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          {/* Alibaba Rate */}
                          <div className="text-center p-2 bg-background rounded border">
                            <div className="text-xs text-muted-foreground mb-1">Alibaba Rate</div>
                            <div className="font-mono font-semibold">
                              {calculatedAudSplit.effectiveRate.toFixed(4)}
                            </div>
                          </div>
                          
                          {/* Market Rate */}
                          <div className="text-center p-2 bg-background rounded border">
                            <div className="text-xs text-muted-foreground mb-1">
                              Market Rate
                              {marketRate && (
                                <span className="block text-[10px] opacity-70">
                                  ({marketRate.date})
                                </span>
                              )}
                            </div>
                            {isLoadingRate ? (
                              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                            ) : rateError ? (
                              <span className="text-destructive text-xs">Error</span>
                            ) : marketRate ? (
                              <div className="font-mono font-semibold">
                                {marketRate.rate.toFixed(4)}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                          
                          {/* Difference */}
                          <div className="text-center p-2 bg-background rounded border">
                            <div className="text-xs text-muted-foreground mb-1">Difference</div>
                            {marketRate && calculatedAudSplit.effectiveRate ? (
                              (() => {
                                const diff = calculatedAudSplit.effectiveRate - marketRate.rate;
                                const diffPercent = (diff / marketRate.rate) * 100;
                                const isBetter = diff < 0;
                                return (
                                  <div className={`font-mono font-semibold flex items-center justify-center gap-1 ${isBetter ? 'text-green-600' : 'text-amber-600'}`}>
                                    {isBetter ? (
                                      <TrendingDown className="h-3 w-3" />
                                    ) : (
                                      <TrendingUp className="h-3 w-3" />
                                    )}
                                    {diff >= 0 ? '+' : ''}{diffPercent.toFixed(2)}%
                                  </div>
                                );
                              })()
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
                        </div>
                        
                        {/* Explanation */}
                        {marketRate && calculatedAudSplit.effectiveRate && (
                          <div className="text-xs text-muted-foreground text-center">
                            {(() => {
                              const diff = calculatedAudSplit.effectiveRate - marketRate.rate;
                              const diffPercent = (diff / marketRate.rate) * 100;
                              const totalUsd = calculatedAudSplit.totalProductFreightUsd;
                              const costDiff = Math.abs(diff * totalUsd);
                              
                              if (diff < 0) {
                                return (
                                  <span className="text-green-600">
                                    ✓ You saved ~${costDiff.toFixed(2)} AUD ({Math.abs(diffPercent).toFixed(2)}% better than market)
                                  </span>
                                );
                              } else if (diff > 0.01) {
                                return (
                                  <span className="text-amber-600">
                                    Alibaba margin: ~${costDiff.toFixed(2)} AUD ({diffPercent.toFixed(2)}% above market)
                                  </span>
                                );
                              } else {
                                return <span>Rate is at market value</span>;
                              }
                            })()}
                          </div>
                        )}
                        
                        {rateError && (
                          <div className="text-xs text-destructive text-center">
                            {rateError}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Verification */}
                    <div className={`text-center text-sm p-2 rounded ${calculatedAudSplit.isValid ? 'bg-green-100 text-green-800' : 'bg-destructive/10 text-destructive'}`}>
                      {calculatedAudSplit.isValid ? (
                        <span className="flex items-center justify-center gap-1">
                          <CheckCircle2 className="h-4 w-4" />
                          Verification passed: ${(calculatedAudSplit.productAud + calculatedAudSplit.freightAud + (parseFloat(serviceFeeAud) || 0)).toFixed(2)} = ${parseFloat(audAmount).toFixed(2)} ✓
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-1">
                          <AlertCircle className="h-4 w-4" />
                          Totals don't match. Check your inputs.
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Enter Total AUD Paid to calculate the split
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Bulk PDF Upload */}
          {parsedData && (
            <div className="space-y-2">
              <Label>Attach Invoice PDFs</Label>
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => document.getElementById('file-upload')?.click()}
              >
              <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                <p className="text-sm text-muted-foreground">
                  Drag & drop files here, or click to browse (PDF, images, Excel, CSV)
                </p>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx,.doc,.docx"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>

              {attachments.length > 0 && (
                <div className="space-y-2 mt-2">
                  {attachments.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-muted p-2 rounded text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{file.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAttachment(idx);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Create Button */}
          {parsedData && (
            <Button
              onClick={handleCreate}
              disabled={isCreating || !parsedData.line_items.length}
              className="w-full"
              size="lg"
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Invoice...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Create Invoice
                </>
              )}
            </Button>
          )}

          {/* Help Text */}
          {!parsedData && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="mb-1">
                  <strong>Step 1:</strong> Copy the entire order details page from Alibaba (Ctrl+A, Ctrl+C) and paste it above.
                </p>
                <p>
                  <strong>Step 2 (Optional):</strong> Upload a screenshot of your payment confirmation to auto-extract the AUD amount and payment details.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
