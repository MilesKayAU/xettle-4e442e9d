import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Mail, ExternalLink, Copy, Check, AlertTriangle } from 'lucide-react';
import { PurchaseOrderWithSupplier, ENTITY_DETAILS, PurchaseOrderLineItem } from '@/types/purchase-orders';
import POCountryBadge from './POCountryBadge';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAlibabaAccounts, CountryKey } from '@/hooks/use-alibaba-accounts';

interface SendPODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: PurchaseOrderWithSupplier | null;
  onSent: () => void;
}

const SendPODialog: React.FC<SendPODialogProps> = ({
  open,
  onOpenChange,
  purchaseOrder,
  onSent,
}) => {
  const [supplierEmail, setSupplierEmail] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const { accounts, loading: accountsLoading, isConfigured } = useAlibabaAccounts();

  useEffect(() => {
    if (purchaseOrder?.supplier?.email) {
      setSupplierEmail(purchaseOrder.supplier.email);
    }
  }, [purchaseOrder]);

  if (!purchaseOrder) return null;

  const entity = ENTITY_DETAILS[purchaseOrder.country];
  const lineItems = purchaseOrder.line_items as PurchaseOrderLineItem[];
  const country = purchaseOrder.country as CountryKey;
  const alibabaAccount = accounts[country];
  const isAlibabaConfigured = isConfigured(country);
  
  const approvalUrl = `${window.location.origin}/po-approval/${purchaseOrder.approval_token}`;

  const generateEmailBody = () => {
    let body = `Dear ${purchaseOrder.supplier?.contact_person || 'Supplier'},\n\n`;
    body += `Please find below Purchase Order ${purchaseOrder.po_number} from ${entity.name}.\n\n`;
    body += `Entity: ${entity.name}\n`;
    body += `Country: ${purchaseOrder.country}\n`;
    body += `Currency: ${purchaseOrder.currency}\n\n`;
    body += `=== ORDER DETAILS ===\n\n`;
    
    lineItems.forEach(item => {
      body += `${item.sku} - ${item.title}\n`;
      body += `  Quantity: ${item.quantity}\n`;
      body += `  Unit Price: ${purchaseOrder.currency} ${item.unit_price.toFixed(2)}\n`;
      body += `  Total: ${purchaseOrder.currency} ${item.total.toFixed(2)}\n\n`;
    });
    
    body += `===================\n`;
    body += `TOTAL: ${purchaseOrder.currency} ${(purchaseOrder.total_amount || 0).toLocaleString()}\n\n`;
    
    if (customMessage) {
      body += `${customMessage}\n\n`;
    }
    
    body += `Please review and approve this order by clicking the link below:\n`;
    body += `${approvalUrl}\n\n`;
    body += `Best regards,\n${entity.name}`;
    
    return body;
  };

  const handleSendViaEdgeFunction = async () => {
    if (!supplierEmail) {
      toast({
        title: 'Email Required',
        description: 'Please enter the supplier email address',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-purchase-order', {
        body: {
          purchaseOrderId: purchaseOrder.id,
          supplierEmail,
          customMessage,
        },
      });

      if (error) throw error;

      // Update PO status to sent
      await supabase
        .from('purchase_orders')
        .update({ 
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', purchaseOrder.id);

      toast({
        title: 'Purchase Order Sent',
        description: `Email sent to ${supplierEmail}`,
      });

      onSent();
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to send PO:', error);
      toast({
        title: 'Send Failed',
        description: 'Failed to send email. Try using the mailto link instead.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleOpenMailto = () => {
    const subject = encodeURIComponent(`Purchase Order ${purchaseOrder.po_number} from ${entity.name}`);
    const body = encodeURIComponent(generateEmailBody());
    window.open(`mailto:${supplierEmail}?subject=${subject}&body=${body}`, '_blank');
  };

  const copyApprovalLink = async () => {
    await navigator.clipboard.writeText(approvalUrl);
    setCopied(true);
    toast({ title: 'Link Copied', description: 'Approval link copied to clipboard' });
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send Purchase Order to Supplier</DialogTitle>
          <DialogDescription>
            Send {purchaseOrder.po_number} to {purchaseOrder.supplier?.name || 'supplier'} for approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* PO Summary */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono font-bold text-lg">{purchaseOrder.po_number}</p>
                  <p className="text-sm text-muted-foreground">{entity.name}</p>
                </div>
                <div className="text-right">
                  <POCountryBadge country={purchaseOrder.country} />
                  <p className="mt-2 font-bold">
                    {purchaseOrder.currency} {(purchaseOrder.total_amount || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Alibaba Buyer Account Preview */}
          <Card className={`border-2 ${isAlibabaConfigured ? 'border-red-300 bg-red-50' : 'border-amber-500 bg-amber-50'}`}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-red-800">🚨 ALIBABA TRADE ASSURANCE ACCOUNT:</p>
                {!isAlibabaConfigured && (
                  <div className="flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-xs font-medium">Not Configured</span>
                  </div>
                )}
              </div>
              <div className="bg-white p-3 rounded border text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Buyer Email:</span>{' '}
                  <strong>{alibabaAccount.alibaba_buyer_email || '(Not configured)'}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Company:</span>{' '}
                  <strong>{alibabaAccount.alibaba_buyer_company || '(Not configured)'}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Buyer ID:</span>{' '}
                  <strong>{alibabaAccount.alibaba_buyer_id || '(Not configured)'}</strong>
                </p>
              </div>
              {!isAlibabaConfigured && (
                <p className="text-xs text-amber-700 mt-2">
                  ⚠️ Configure Alibaba account settings in Admin → Inventory → Alibaba Accounts
                </p>
              )}
              {isAlibabaConfigured && (
                <p className="text-xs text-red-700 mt-2">
                  Supplier will be instructed to create the Trade Assurance order to this account.
                </p>
              )}
            </CardContent>
          </Card>
          
          {/* Invoice To Preview */}
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="pt-4">
              <p className="text-sm font-medium text-amber-800 mb-1">Invoice To:</p>
              <p className="text-lg font-bold text-amber-900">{entity.name}</p>
              <p className="text-sm text-amber-700 mt-1">For: {entity.amazon_store}</p>
            </CardContent>
          </Card>

          {/* Supplier Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Supplier Email</Label>
            <Input
              id="email"
              type="email"
              value={supplierEmail}
              onChange={(e) => setSupplierEmail(e.target.value)}
              placeholder="supplier@example.com"
            />
          </div>

          {/* Custom Message */}
          <div className="space-y-2">
            <Label htmlFor="message">Additional Message (Optional)</Label>
            <Textarea
              id="message"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Add any special instructions or notes..."
              rows={3}
            />
          </div>

          {/* Approval Link */}
          <div className="space-y-2">
            <Label>Supplier Approval Link</Label>
            <div className="flex gap-2">
              <Input value={approvalUrl} readOnly className="font-mono text-sm" />
              <Button variant="outline" size="icon" onClick={copyApprovalLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This link allows the supplier to view and approve the PO without logging in.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleOpenMailto}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open in Email Client
          </Button>
          <Button onClick={handleSendViaEdgeFunction} disabled={sending || !supplierEmail}>
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-2 h-4 w-4" />
            )}
            Send Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SendPODialog;
