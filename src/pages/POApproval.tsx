import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, CheckCircle, XCircle, Package, AlertTriangle, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ENTITY_DETAILS, PurchaseOrderLineItem } from '@/types/purchase-orders';
import POCountryBadge from '@/components/purchase-orders/POCountryBadge';
import { toast } from '@/hooks/use-toast';

// Input sanitization helpers
const sanitizeString = (input: string, maxLength: number = 500): string => {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>]/g, ''); // Remove remaining angle brackets
};

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

interface AlibabaAccountDetails {
  alibaba_buyer_email: string;
  alibaba_buyer_company: string;
  alibaba_buyer_id: string;
  additional_instructions?: string;
}

interface PurchaseOrderData {
  id: string;
  po_number: string;
  country: 'Australia' | 'UK' | 'USA';
  status: string;
  total_amount: number | null;
  currency: string;
  notes: string | null;
  terms: string | null;
  line_items: PurchaseOrderLineItem[];
  created_at: string;
  expires_at: string | null;
  approved_at: string | null;
  supplier?: {
    name: string;
    company_name?: string;
  } | null;
}

const POApproval = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<boolean | null>(null);
  const [alibabaAccount, setAlibabaAccount] = useState<AlibabaAccountDetails | null>(null);
  
  // Form fields
  const [approverName, setApproverName] = useState('');
  const [approverEmail, setApproverEmail] = useState('');
  const [alibabaOrderId, setAlibabaOrderId] = useState('');
  const [supplierNotes, setSupplierNotes] = useState('');
  const [billingConfirmed, setBillingConfirmed] = useState(false);

  useEffect(() => {
    if (token) {
      fetchPurchaseOrder();
    }
  }, [token]);

  const fetchAlibabaAccount = async (country: string) => {
    try {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', `alibaba_account_${country}`)
        .single();

      if (data?.value) {
        const parsed = JSON.parse(data.value);
        setAlibabaAccount(parsed);
      }
    } catch (err) {
      console.error('Failed to fetch Alibaba account settings:', err);
    }
  };

  const fetchPurchaseOrder = async () => {
    // Validate token format before querying
    if (!token || !isValidUUID(token)) {
      setError('Invalid approval link');
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          country,
          status,
          total_amount,
          currency,
          notes,
          terms,
          line_items,
          created_at,
          expires_at,
          approved_at,
          supplier:suppliers(name, company_name)
        `)
        .eq('approval_token', token)
        .maybeSingle(); // Use maybeSingle to avoid error when no match

      if (error) throw error;

      if (!data) {
        setError('Purchase order not found or link is invalid');
        return;
      }

      // Check if expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        setError('This purchase order link has expired');
        return;
      }

      // Check if already actioned
      if (data.status === 'approved' || data.status === 'rejected') {
        setApproved(data.status === 'approved');
      }

      // Fetch Alibaba account settings for this country
      await fetchAlibabaAccount(data.country);

      setPurchaseOrder({
        ...data,
        line_items: (data.line_items as unknown as PurchaseOrderLineItem[]) || [],
      } as PurchaseOrderData);
    } catch (err) {
      console.error('Failed to fetch PO:', err);
      setError('Failed to load purchase order. The link may be invalid.');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    // Validate and sanitize inputs
    const sanitizedName = sanitizeString(approverName, 100);
    const sanitizedEmail = approverEmail.trim().toLowerCase();
    const sanitizedAlibabaId = sanitizeString(alibabaOrderId, 100);
    const sanitizedNotes = sanitizeString(supplierNotes, 1000);

    if (!sanitizedName || sanitizedName.length < 2) {
      toast({
        title: 'Invalid Name',
        description: 'Please enter a valid name (at least 2 characters)',
        variant: 'destructive',
      });
      return;
    }

    if (!isValidEmail(sanitizedEmail)) {
      toast({
        title: 'Invalid Email',
        description: 'Please enter a valid email address',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by_name: sanitizedName,
          approved_by_email: sanitizedEmail,
          alibaba_order_id: sanitizedAlibabaId || null,
          supplier_notes: sanitizedNotes || null,
        })
        .eq('approval_token', token)
        .eq('status', 'sent'); // Only allow approving POs that are in 'sent' status

      if (error) throw error;

      // Send notification to admin
      try {
        await supabase.functions.invoke('notify-po-approval', {
          body: {
            po_id: purchaseOrder.id,
            action: 'approved',
            approver_name: sanitizedName,
            approver_email: sanitizedEmail,
            alibaba_order_id: sanitizedAlibabaId || undefined,
            supplier_notes: sanitizedNotes || undefined,
          },
        });
      } catch (notifyErr) {
        console.error('Failed to send admin notification:', notifyErr);
      }

      setApproved(true);
      toast({
        title: 'Order Approved',
        description: 'Thank you! The order has been approved.',
      });
    } catch (err) {
      console.error('Failed to approve PO:', err);
      toast({
        title: 'Error',
        description: 'Failed to approve order. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    // Validate and sanitize inputs
    const sanitizedName = sanitizeString(approverName, 100);
    const sanitizedEmail = approverEmail.trim().toLowerCase();
    const sanitizedNotes = sanitizeString(supplierNotes, 1000);

    if (!sanitizedName || sanitizedName.length < 2) {
      toast({
        title: 'Invalid Name',
        description: 'Please enter a valid name (at least 2 characters)',
        variant: 'destructive',
      });
      return;
    }

    if (!isValidEmail(sanitizedEmail)) {
      toast({
        title: 'Invalid Email',
        description: 'Please enter a valid email address',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('purchase_orders')
        .update({
          status: 'rejected',
          approved_at: new Date().toISOString(),
          approved_by_name: sanitizedName,
          approved_by_email: sanitizedEmail,
          supplier_notes: sanitizedNotes || null,
        })
        .eq('approval_token', token)
        .eq('status', 'sent'); // Only allow rejecting POs that are in 'sent' status

      if (error) throw error;

      // Send notification to admin
      try {
        await supabase.functions.invoke('notify-po-approval', {
          body: {
            po_id: purchaseOrder.id,
            action: 'rejected',
            approver_name: sanitizedName,
            approver_email: sanitizedEmail,
            supplier_notes: sanitizedNotes || undefined,
          },
        });
      } catch (notifyErr) {
        console.error('Failed to send admin notification:', notifyErr);
      }

      setApproved(false);
      toast({
        title: 'Order Rejected',
        description: 'The order has been rejected.',
      });
    } catch (err) {
      console.error('Failed to reject PO:', err);
      toast({
        title: 'Error',
        description: 'Failed to reject order. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-xl font-semibold mb-2">Error</h2>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!purchaseOrder) {
    return null;
  }

  const entity = ENTITY_DETAILS[purchaseOrder.country];

  // Already actioned
  if (approved !== null && purchaseOrder.approved_at) {
    return (
      <div className="min-h-screen bg-muted/30 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="pt-6 text-center">
              {approved ? (
                <>
                  <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-500" />
                  <h2 className="text-2xl font-semibold mb-2">Order Approved</h2>
                  <p className="text-muted-foreground mb-4">
                    This purchase order has been approved.
                  </p>
                </>
              ) : (
                <>
                  <XCircle className="h-16 w-16 mx-auto mb-4 text-destructive" />
                  <h2 className="text-2xl font-semibold mb-2">Order Rejected</h2>
                  <p className="text-muted-foreground mb-4">
                    This purchase order has been rejected.
                  </p>
                </>
              )}
              <p className="text-sm text-muted-foreground">
                PO Number: {purchaseOrder.po_number}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Package className="h-10 w-10 text-primary" />
                <div>
                  <CardTitle className="text-2xl">Purchase Order Review</CardTitle>
                  <CardDescription>
                    Please review and approve or reject this purchase order
                  </CardDescription>
                </div>
              </div>
              <POCountryBadge country={purchaseOrder.country} />
            </div>
          </CardHeader>
        </Card>

        {/* CRITICAL: ALIBABA TRADE ASSURANCE INSTRUCTIONS */}
        <Card className="border-red-500 border-2 bg-red-50">
          <CardContent className="pt-6">
            <div className="mb-4">
              <h3 className="font-bold text-red-700 text-lg uppercase mb-2">
                🚨 ALIBABA PAYMENT (TRADE ASSURANCE) – CREATE ORDER TO THIS BUYER ACCOUNT
              </h3>
            </div>
            <div className="space-y-3 bg-white p-4 rounded-lg border">
              <div className="border-b pb-2">
                <span className="text-sm text-muted-foreground">Alibaba Registered Email:</span>
                <p className="text-lg font-bold">
                  {alibabaAccount?.alibaba_buyer_email || entity.alibaba_buyer_email || '(Not configured)'}
                </p>
              </div>
              <div className="border-b pb-2">
                <span className="text-sm text-muted-foreground">Buyer/Company Name on Alibaba:</span>
                <p className="text-lg font-bold">
                  {alibabaAccount?.alibaba_buyer_company || entity.alibaba_buyer_company || '(Not configured)'}
                </p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Alibaba Member/Buyer ID:</span>
                <p className="text-lg font-bold">
                  {alibabaAccount?.alibaba_buyer_id || entity.alibaba_buyer_id || '(Not configured)'}
                </p>
              </div>
            </div>
            {alibabaAccount?.additional_instructions && (
              <div className="mt-4 p-3 bg-orange-100 rounded border border-orange-200">
                <p className="text-sm text-orange-800">
                  <strong>Additional Instructions:</strong> {alibabaAccount.additional_instructions}
                </p>
              </div>
            )}
            <Alert className="mt-4 border-red-300 bg-red-100">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                <strong>INSTRUCTION:</strong> Please create the Trade Assurance order addressed to the buyer account above and send the payment request inside that Alibaba thread/account. DO NOT send to any other account.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* Invoice To Block */}
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-100 rounded-full">
                <Building2 className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-amber-800 text-sm mb-1">INVOICE TO:</h3>
                <p className="text-xl font-bold text-amber-900 mb-2">{entity.name}</p>
                <p className="text-amber-700">
                  {entity.address}<br/>
                  For: <strong>{entity.amazon_store}</strong>
                </p>
              </div>
              <POCountryBadge country={purchaseOrder.country} />
            </div>
          </CardContent>
        </Card>

        {/* PO Details */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-muted-foreground">PO Number</p>
                <p className="text-2xl font-mono font-bold">{purchaseOrder.po_number}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="text-2xl font-bold">
                  {purchaseOrder.currency} {(purchaseOrder.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Entity Info */}
            <div className="bg-muted p-4 rounded-lg">
              <p className="font-semibold">{entity.name}</p>
              <p className="text-sm text-muted-foreground">{entity.address}</p>
              <p className="text-sm text-muted-foreground">{entity.email}</p>
            </div>

            {/* Line Items */}
            <div>
              <h3 className="font-semibold mb-3">Order Items</h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseOrder.line_items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono">{item.sku}</TableCell>
                        <TableCell>{item.title}</TableCell>
                        <TableCell className="text-right">{item.quantity.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          {purchaseOrder.currency} {item.unit_price.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {purchaseOrder.currency} {item.total.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Notes and Terms */}
            {(purchaseOrder.notes || purchaseOrder.terms) && (
              <div className="grid md:grid-cols-2 gap-4">
                {purchaseOrder.notes && (
                  <div>
                    <h4 className="font-medium mb-2">Notes</h4>
                    <p className="text-sm text-muted-foreground">{purchaseOrder.notes}</p>
                  </div>
                )}
                {purchaseOrder.terms && (
                  <div>
                    <h4 className="font-medium mb-2">Terms & Conditions</h4>
                    <p className="text-sm text-muted-foreground">{purchaseOrder.terms}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Approval Form */}
        <Card>
          <CardHeader>
            <CardTitle>Your Response</CardTitle>
            <CardDescription>
              Please fill in your details and approve or reject this order
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Your Name *</Label>
                <Input
                  id="name"
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  placeholder="Enter your name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Your Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={approverEmail}
                  onChange={(e) => setApproverEmail(e.target.value)}
                  placeholder="Enter your email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="alibaba-order">Alibaba Order ID (if applicable)</Label>
              <Input
                id="alibaba-order"
                value={alibabaOrderId}
                onChange={(e) => setAlibabaOrderId(e.target.value)}
                placeholder={`Enter your Alibaba order ID for ${entity.name}`}
              />
              <p className="text-xs text-muted-foreground">
                If you have created an order on Alibaba, please provide the order ID. 
                Ensure it's under{' '}
                <strong>
                  {alibabaAccount?.alibaba_buyer_email || entity.alibaba_buyer_email || 'the correct buyer account'}
                </strong>.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                value={supplierNotes}
                onChange={(e) => setSupplierNotes(e.target.value)}
                placeholder="Any additional comments or notes..."
                rows={3}
              />
            </div>

            {/* Billing Confirmation Checkbox */}
            <div className="flex items-start space-x-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <Checkbox
                id="billing-confirm"
                checked={billingConfirmed}
                onCheckedChange={(checked) => setBillingConfirmed(checked as boolean)}
                className="mt-0.5"
              />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="billing-confirm" className="font-medium text-amber-900 cursor-pointer">
                  I confirm this order will be invoiced to {entity.name}
                </Label>
                <p className="text-sm text-amber-700">
                  The Alibaba order/invoice will be created under the correct entity account for {entity.amazon_store}.
                </p>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                By approving this order, you confirm the quantities and prices listed above.
                This approval is binding and will be used for payment processing.
              </AlertDescription>
            </Alert>

            <div className="flex gap-4 pt-4">
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={submitting}
                className="flex-1"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Reject Order
              </Button>
              <Button
                onClick={handleApprove}
                disabled={submitting || !billingConfirmed}
                className="flex-1 bg-green-600 hover:bg-green-700"
                title={!billingConfirmed ? "Please confirm the billing entity above" : ""}
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                Approve Order
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default POApproval;
