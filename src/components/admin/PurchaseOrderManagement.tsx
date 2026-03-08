import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import POStatusBadge from "@/components/purchase-orders/POStatusBadge";
import POCountryBadge from "@/components/purchase-orders/POCountryBadge";
import { 
  FileText, 
  RefreshCw, 
  Search, 
  Link2, 
  CheckCircle, 
  Eye, 
  Trash2,
  ExternalLink,
  DollarSign,
  AlertCircle,
  Download,
  Plus,
  Send
} from "lucide-react";
import { format } from "date-fns";
import { downloadPOXeroCSV } from "@/utils/xero-po-export";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PurchaseOrderWithSupplier, PurchaseOrderLineItem } from "@/types/purchase-orders";

interface AlibabaOrder {
  id: string;
  order_id: string | null;
  supplier_name: string | null;
  total_amount: number | null;
  currency_code: string | null;
  status: string;
  created_at: string;
}

// Extended type - now inherits payment fields from base PurchaseOrder
type ExtendedPurchaseOrder = PurchaseOrderWithSupplier;

export function PurchaseOrderManagement() {
  const navigate = useNavigate();
  const { purchaseOrders, loading, fetchPurchaseOrders, updatePurchaseOrderStatus, deletePurchaseOrder } = usePurchaseOrders();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [accessError, setAccessError] = useState<string | null>(null);
  
  // Dialog states
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<ExtendedPurchaseOrder | null>(null);
  
  // Link invoice states
  const [alibabaOrders, setAlibabaOrders] = useState<AlibabaOrder[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  
  // Verify payment states
  const [paymentNotes, setPaymentNotes] = useState("");
  const [verifying, setVerifying] = useState(false);
  
  // Send PO states
  const [supplierEmail, setSupplierEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setAccessError(null);
        await fetchPurchaseOrders();
      } catch (err: any) {
        if (err?.message?.includes('Admin access required') || err?.message?.includes('Unauthorized')) {
          setAccessError('You need admin privileges to view purchase orders.');
        }
      }
    };
    loadData();
  }, []);

  const filteredOrders = purchaseOrders.filter((po) => {
    const matchesSearch = 
      po.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (po.supplier?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (po.alibaba_order_id || "").toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || po.status === statusFilter;
    const matchesCountry = countryFilter === "all" || po.country === countryFilter;
    const matchesPayment = paymentFilter === "all" || po.payment_status === paymentFilter;
    
    return matchesSearch && matchesStatus && matchesCountry && matchesPayment;
  });

  const handleViewPO = (po: ExtendedPurchaseOrder) => {
    setSelectedPO(po);
    setViewDialogOpen(true);
  };

  const handleSendPO = (po: ExtendedPurchaseOrder) => {
    setSelectedPO(po);
    setSupplierEmail(po.supplier?.email || "");
    setCustomMessage("");
    setSendDialogOpen(true);
  };

  const handleConfirmSend = async () => {
    if (!selectedPO || !supplierEmail) {
      toast({
        title: "Email Required",
        description: "Please enter the supplier email address",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-purchase-order', {
        body: {
          purchaseOrderId: selectedPO.id,
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
        .eq('id', selectedPO.id);

      toast({
        title: "Purchase Order Sent",
        description: `Email sent to ${supplierEmail}`,
      });

      fetchPurchaseOrders();
      setSendDialogOpen(false);
    } catch (error) {
      console.error('Failed to send PO:', error);
      toast({
        title: "Send Failed",
        description: "Failed to send email. Please check the supplier email and try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleLinkInvoice = async (po: ExtendedPurchaseOrder) => {
    setSelectedPO(po);
    setSelectedInvoiceId("");
    setLoadingInvoices(true);
    setLinkDialogOpen(true);

    try {
      const { data, error } = await supabase
        .from("alibaba_orders")
        .select("id, order_id, supplier_name, total_amount, currency_code, status, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setAlibabaOrders(data || []);
    } catch (error) {
      console.error("Error fetching Alibaba orders:", error);
      toast({
        title: "Error",
        description: "Failed to load Alibaba invoices",
        variant: "destructive",
      });
    } finally {
      setLoadingInvoices(false);
    }
  };

  const handleConfirmLink = async () => {
    if (!selectedPO || !selectedInvoiceId) return;

    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ alibaba_order_uuid: selectedInvoiceId })
        .eq("id", selectedPO.id);

      if (error) throw error;

      toast({
        title: "Invoice Linked",
        description: `PO ${selectedPO.po_number} linked to Alibaba invoice`,
      });

      setLinkDialogOpen(false);
      fetchPurchaseOrders();
    } catch (error) {
      console.error("Error linking invoice:", error);
      toast({
        title: "Error",
        description: "Failed to link invoice",
        variant: "destructive",
      });
    }
  };

  const handleVerifyPayment = (po: ExtendedPurchaseOrder) => {
    setSelectedPO(po);
    setPaymentNotes("");
    setVerifyDialogOpen(true);
  };

  const handleConfirmVerify = async () => {
    if (!selectedPO) return;

    setVerifying(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from("purchase_orders")
        .update({
          payment_status: "verified",
          payment_verified_at: new Date().toISOString(),
          payment_verified_by: user?.id,
          payment_notes: paymentNotes || null,
        })
        .eq("id", selectedPO.id);

      if (error) throw error;

      toast({
        title: "Payment Verified",
        description: `Payment for ${selectedPO.po_number} has been verified`,
      });

      setVerifyDialogOpen(false);
      fetchPurchaseOrders();
    } catch (error) {
      console.error("Error verifying payment:", error);
      toast({
        title: "Error",
        description: "Failed to verify payment",
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleMarkComplete = async (po: ExtendedPurchaseOrder) => {
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({ 
          status: "completed",
          payment_status: "paid"
        })
        .eq("id", po.id);

      if (error) throw error;

      toast({
        title: "PO Completed",
        description: `${po.po_number} marked as complete`,
      });

      fetchPurchaseOrders();
    } catch (error) {
      console.error("Error completing PO:", error);
      toast({
        title: "Error",
        description: "Failed to complete PO",
        variant: "destructive",
      });
    }
  };

  const handleDeletePO = async (po: ExtendedPurchaseOrder) => {
    if (!confirm(`Are you sure you want to delete ${po.po_number}?`)) return;
    
    const success = await deletePurchaseOrder(po.id);
    if (success) {
      toast({
        title: "PO Deleted",
        description: `${po.po_number} has been deleted`,
      });
    }
  };

  const getPaymentStatusBadge = (status: string | undefined) => {
    switch (status) {
      case "verified":
        return <Badge className="bg-blue-500 hover:bg-blue-600">Verified</Badge>;
      case "paid":
        return <Badge className="bg-green-500 hover:bg-green-600">Paid</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const handleExportForXero = () => {
    // Export approved and completed POs
    const exportablePOs = purchaseOrders.filter(
      po => po.status === 'approved' || po.status === 'completed'
    );
    
    if (exportablePOs.length === 0) {
      toast({
        title: "No POs to Export",
        description: "Only approved or completed purchase orders can be exported.",
        variant: "destructive",
      });
      return;
    }

    const result = downloadPOXeroCSV(exportablePOs);

    if (!result.valid) {
      toast({
        title: "Export Failed",
        description: result.errors.join(', '),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Export Complete",
      description: `Exported ${result.summary.exported} POs (${result.summary.skipped} skipped). Total: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result.summary.totalAmount)}`,
    });

    if (result.warnings.length > 0) {
      console.warn('Export warnings:', result.warnings);
    }
  };

  const formatCurrency = (amount: number | null, currency: string = "USD") => {
    if (!amount) return "-";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount);
  };

  // Show access error if user is not admin
  if (accessError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h3 className="text-lg font-semibold mb-2">Access Denied</h3>
            <p className="text-muted-foreground">{accessError}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Purchase Order Management
            </CardTitle>
            <CardDescription>
              Manage all purchase orders, verify payments, and link to Alibaba invoices
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => navigate('/purchase-orders')}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create PO
            </Button>
            <Button 
              onClick={handleExportForXero} 
              variant="outline" 
              size="sm"
              disabled={purchaseOrders.filter(p => p.status === 'approved' || p.status === 'completed').length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export for Xero
            </Button>
            <Button onClick={() => fetchPurchaseOrders()} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search PO number, supplier, or Alibaba ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              <SelectItem value="Australia">Australia</SelectItem>
              <SelectItem value="UK">UK</SelectItem>
              <SelectItem value="USA">USA</SelectItem>
            </SelectContent>
          </Select>
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Payment Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payments</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{purchaseOrders.filter(p => p.status === "approved").length}</div>
              <div className="text-sm text-muted-foreground">Approved (Pending Payment)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{purchaseOrders.filter(p => (p as any).payment_status === "verified").length}</div>
              <div className="text-sm text-muted-foreground">Payment Verified</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{purchaseOrders.filter(p => p.status === "sent").length}</div>
              <div className="text-sm text-muted-foreground">Awaiting Approval</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{purchaseOrders.filter(p => p.status === "completed").length}</div>
              <div className="text-sm text-muted-foreground">Completed</div>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No purchase orders found
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Alibaba ID</TableHead>
                  <TableHead>Approved By</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-mono font-medium">{po.po_number}</TableCell>
                    <TableCell><POCountryBadge country={po.country} /></TableCell>
                    <TableCell>{po.supplier?.name || "-"}</TableCell>
                    <TableCell>{formatCurrency(po.total_amount, po.currency)}</TableCell>
                    <TableCell><POStatusBadge status={po.status} /></TableCell>
                    <TableCell>{getPaymentStatusBadge((po as any).payment_status)}</TableCell>
                    <TableCell>
                      {po.alibaba_order_id ? (
                        <span className="font-mono text-xs">{po.alibaba_order_id}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {po.approved_by_name ? (
                        <div className="text-sm">
                          <div>{po.approved_by_name}</div>
                          <div className="text-xs text-muted-foreground">{po.approved_by_email}</div>
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(po.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleViewPO(po)}
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        
                        {po.status === "approved" && !po.alibaba_order_uuid && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleLinkInvoice(po)}
                            title="Link to Invoice"
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                        )}
                        
                        {po.status === "approved" && (po as any).payment_status !== "verified" && (po as any).payment_status !== "paid" && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleVerifyPayment(po)}
                            title="Verify Payment"
                            className="text-blue-600 hover:text-blue-700"
                          >
                            <DollarSign className="h-4 w-4" />
                          </Button>
                        )}
                        
                        {po.status === "approved" && (po as any).payment_status === "verified" && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleMarkComplete(po)}
                            title="Mark Complete"
                            className="text-green-600 hover:text-green-700"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                        
                        {po.status === "draft" && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleSendPO(po)}
                            title="Send to Supplier"
                            className="text-blue-600 hover:text-blue-700"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        )}
                        
                        {po.status === "draft" && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleDeletePO(po)}
                            title="Delete"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* View PO Dialog */}
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Purchase Order Details</DialogTitle>
              <DialogDescription>
                {selectedPO?.po_number}
              </DialogDescription>
            </DialogHeader>
            {selectedPO && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Status</Label>
                    <div className="mt-1"><POStatusBadge status={selectedPO.status} /></div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Country</Label>
                    <div className="mt-1"><POCountryBadge country={selectedPO.country} /></div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Supplier</Label>
                    <div className="mt-1 font-medium">{selectedPO.supplier?.name || "-"}</div>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Total Amount</Label>
                    <div className="mt-1 font-medium">{formatCurrency(selectedPO.total_amount, selectedPO.currency)}</div>
                  </div>
                </div>
                
                {selectedPO.approved_by_name && (
                  <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                    <Label className="text-muted-foreground">Approved By</Label>
                    <div className="font-medium">{selectedPO.approved_by_name}</div>
                    <div className="text-sm text-muted-foreground">{selectedPO.approved_by_email}</div>
                    {selectedPO.approved_at && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {format(new Date(selectedPO.approved_at), "dd MMM yyyy 'at' HH:mm")}
                      </div>
                    )}
                  </div>
                )}
                
                {selectedPO.alibaba_order_id && (
                  <div>
                    <Label className="text-muted-foreground">Alibaba Order ID</Label>
                    <div className="mt-1 font-mono">{selectedPO.alibaba_order_id}</div>
                  </div>
                )}
                
                {selectedPO.supplier_notes && (
                  <div>
                    <Label className="text-muted-foreground">Supplier Notes</Label>
                    <div className="mt-1 p-3 bg-muted rounded-lg text-sm">{selectedPO.supplier_notes}</div>
                  </div>
                )}
                
                {selectedPO.line_items && selectedPO.line_items.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Line Items</Label>
                    <div className="mt-2 border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedPO.line_items.map((item, index) => (
                            <TableRow key={index}>
                              <TableCell>{item.title}</TableCell>
                              <TableCell className="text-right">{item.quantity}</TableCell>
                              <TableCell className="text-right">{formatCurrency(item.unit_price, selectedPO.currency)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(item.total, selectedPO.currency)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Link Invoice Dialog */}
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Link to Alibaba Invoice</DialogTitle>
              <DialogDescription>
                Select an Alibaba invoice to link with {selectedPO?.po_number}
                {selectedPO?.alibaba_order_id && (
                  <span className="block mt-1 font-mono text-xs">
                    Supplier provided ID: {selectedPO.alibaba_order_id}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            
            {loadingInvoices ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin" />
              </div>
            ) : alibabaOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                <p>No Alibaba invoices found</p>
                <p className="text-sm">Create an invoice first in Alibaba Management</p>
              </div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {alibabaOrders.map((order) => (
                  <div
                    key={order.id}
                    onClick={() => setSelectedInvoiceId(order.id)}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedInvoiceId === order.id 
                        ? "border-primary bg-primary/5" 
                        : "hover:border-muted-foreground/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm">{order.order_id || "No Order ID"}</div>
                        <div className="text-sm text-muted-foreground">{order.supplier_name}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          {formatCurrency(order.total_amount, order.currency_code || "USD")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(order.created_at), "dd MMM yyyy")}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmLink} disabled={!selectedInvoiceId}>
                <Link2 className="h-4 w-4 mr-2" />
                Link Invoice
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Verify Payment Dialog */}
        <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Verify Payment</DialogTitle>
              <DialogDescription>
                Confirm that payment has been made for {selectedPO?.po_number}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              {selectedPO?.alibaba_order_id && (
                <div className="p-3 bg-muted rounded-lg">
                  <Label className="text-muted-foreground text-xs">Alibaba Order ID to verify</Label>
                  <div className="font-mono mt-1">{selectedPO.alibaba_order_id}</div>
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="payment-notes">Payment Notes (optional)</Label>
                <Textarea
                  id="payment-notes"
                  placeholder="e.g., Paid via AMEX Gold on Jan 19, 2025"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setVerifyDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmVerify} disabled={verifying}>
                {verifying ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Verify Payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Send PO Dialog */}
        <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Send Purchase Order to Supplier</DialogTitle>
              <DialogDescription>
                Send {selectedPO?.po_number} to the supplier for approval.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-mono font-bold">{selectedPO?.po_number}</p>
                <p className="text-sm text-muted-foreground">{selectedPO?.supplier?.name}</p>
                <p className="font-bold mt-2">
                  {selectedPO?.currency} {(selectedPO?.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="supplier-email">Supplier Email *</Label>
                <Input
                  id="supplier-email"
                  type="email"
                  placeholder="supplier@example.com"
                  value={supplierEmail}
                  onChange={(e) => setSupplierEmail(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="custom-message">Additional Message (Optional)</Label>
                <Textarea
                  id="custom-message"
                  placeholder="Add any special instructions..."
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={3}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                The supplier will receive an email with full order details and a link to approve the PO.
              </p>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmSend} disabled={sending || !supplierEmail}>
                {sending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Send Email
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
