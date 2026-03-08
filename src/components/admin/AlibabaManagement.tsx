import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, ExternalLink, Edit, Trash2, FileText, Download, AlertTriangle, Check, Sparkles, MoreHorizontal, Settings, Mail, RefreshCw, CloudUpload } from 'lucide-react';
import { useNotificationSettings } from '@/hooks/use-notification-settings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { EnhancedAlibabaInvoiceForm } from './EnhancedAlibabaInvoiceForm';
import { QuickAlibabaInvoiceCreator } from './QuickAlibabaInvoiceCreator';
import { NotificationSettings } from './NotificationSettings';
import { downloadXeroCSV, AlibabaOrderForExport } from '@/utils/xero-csv-export';

export type InvoiceCountry = 'Australia' | 'UK' | 'USA';

interface EnhancedAlibabaOrder {
  id: string;
  supplier_name: string | null;
  invoice_type: 'Product' | 'Freight' | 'Service Fee' | null;
  order_id: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency_code: string | null;
  pdf_file_path: string | null;
  attachments: any;
  line_items: any;
  total_amount: number | null;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  xero_sync_status: string | null;
  xero_sync_error?: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  country: InvoiceCountry | null;
  // Legacy fields for backward compatibility
  order_url: string | null;
  description: string | null;
  pay_date: string | null;
  payment_method: string | null;
  amount_aud: number | null;
}

const AlibabaManagement = () => {
  const [orders, setOrders] = useState<EnhancedAlibabaOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [editingOrder, setEditingOrder] = useState<EnhancedAlibabaOrder | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<InvoiceCountry>('Australia');
  
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [syncingToXero, setSyncingToXero] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { notificationEmail } = useNotificationSettings();

  // Filter orders by selected country
  const filteredOrders = useMemo(() => {
    return orders.filter(order => (order.country || 'Australia') === selectedCountry);
  }, [orders, selectedCountry]);

  // Sync single invoice to Xero
  const handleSyncToXero = async (order: EnhancedAlibabaOrder) => {
    // Only sync Australian invoices for now
    if ((order.country || 'Australia') !== 'Australia') {
      toast({
        title: "Not supported yet",
        description: `Xero sync for ${order.country} invoices is not yet configured`,
        variant: "destructive"
      });
      return;
    }

    // Check if order has required fields
    const issues = getOrderIssues(order);
    if (issues.length > 0) {
      toast({
        title: "Cannot sync incomplete invoice",
        description: issues.join(', '),
        variant: "destructive"
      });
      return;
    }

    setSyncingToXero(prev => new Set(prev).add(order.id));

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be logged in to sync to Xero');
      }

      const { data, error } = await supabase.functions.invoke('sync-to-xero', {
        body: {
          invoiceId: order.id,
          userId: user.id,
          country: order.country || 'Australia',
          invoiceData: {
            supplier_name: order.supplier_name,
            invoice_type: order.invoice_type,
            order_id: order.order_id,
            invoice_date: order.invoice_date,
            due_date: order.due_date,
            currency_code: order.currency_code,
            line_items: order.line_items,
            total_amount: order.total_amount,
            amount_aud: order.amount_aud,
            description: order.description,
            notes: order.notes,
            attachments: order.attachments,
            pdf_file_path: order.pdf_file_path
          }
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Synced to Xero",
          description: `Invoice ${data.xeroInvoiceNumber} created in ${data.tenantName || 'Xero'}`
        });
        fetchOrders();
      } else {
        throw new Error(data?.error || 'Failed to sync to Xero');
      }
    } catch (error: any) {
      console.error('Error syncing to Xero:', error);
      toast({
        title: "Sync failed",
        description: error.message || "Check console for details",
        variant: "destructive"
      });
      fetchOrders(); // Refresh to show error status
    } finally {
      setSyncingToXero(prev => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
  };

  // Bulk sync selected invoices to Xero
  const handleBulkSyncToXero = async () => {
    const ordersToSync = filteredOrders.filter(o => 
      selectedOrders.has(o.id) && 
      o.xero_sync_status !== 'synced' &&
      (o.country || 'Australia') === 'Australia'
    );

    if (ordersToSync.length === 0) {
      toast({
        title: "No invoices to sync",
        description: "Select Australian invoices that haven't been synced yet",
        variant: "destructive"
      });
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const order of ordersToSync) {
      await handleSyncToXero(order);
      // Small delay between syncs
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    fetchOrders();
  };

  const handleSendEmailAlert = async (order: EnhancedAlibabaOrder) => {
    if (!notificationEmail) {
      toast({
        title: "No email configured",
        description: "Please configure a notification email in settings first",
        variant: "destructive"
      });
      return;
    }

    setSendingEmail(order.id);
    try {
      const { error } = await supabase.functions.invoke('send-invoice-notification', {
        body: {
          to_email: notificationEmail,
          invoice_id: order.id,
          supplier_name: order.supplier_name || 'Unknown Supplier',
          order_id: order.order_id || 'N/A',
          amount: order.amount_aud || order.total_amount || 0,
          currency: order.amount_aud ? 'AUD' : (order.currency_code || 'USD'),
          invoice_type: order.invoice_type || 'Invoice'
        }
      });

      if (error) throw error;

      toast({
        title: "Email sent",
        description: `Notification sent to ${notificationEmail}`
      });
    } catch (error) {
      console.error('Error sending email:', error);
      toast({
        title: "Failed to send email",
        description: "Check console for details",
        variant: "destructive"
      });
    } finally {
      setSendingEmail(null);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('alibaba_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders((data || []) as EnhancedAlibabaOrder[]);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast({
        title: "Error",
        description: "Failed to fetch Alibaba orders",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrder = async (id: string) => {
    if (!confirm('Are you sure you want to delete this order?')) return;

    try {
      const { error } = await supabase
        .from('alibaba_orders')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Order deleted successfully"
      });

      fetchOrders();
    } catch (error) {
      console.error('Error deleting order:', error);
      toast({
        title: "Error",
        description: "Failed to delete order",
        variant: "destructive"
      });
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('alibaba_orders')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Order status updated successfully"
      });

      fetchOrders();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: "Error",
        description: "Failed to update order status",
        variant: "destructive"
      });
    }
  };


  const openEditForm = (order: EnhancedAlibabaOrder) => {
    setEditingOrder(order);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingOrder(null);
  };

  // Selection handlers
  const handleSelectOrder = (orderId: string, checked: boolean) => {
    setSelectedOrders(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(orderId);
      } else {
        newSet.delete(orderId);
      }
      return newSet;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    } else {
      setSelectedOrders(new Set());
    }
  };

  // Export to Xero CSV
  const handleExportToCSV = (exportAll: boolean = false) => {
    const ordersToExport = exportAll 
      ? orders 
      : orders.filter(o => selectedOrders.has(o.id));
    
    if (ordersToExport.length === 0) {
      toast({
        title: "No invoices selected",
        description: "Please select invoices to export or use 'Export All'",
        variant: "destructive"
      });
      return;
    }

    const exportData: AlibabaOrderForExport[] = ordersToExport.map(order => ({
      id: order.id,
      supplier_name: order.supplier_name,
      invoice_type: order.invoice_type,
      order_id: order.order_id,
      invoice_date: order.invoice_date,
      due_date: order.due_date,
      currency_code: order.currency_code,
      line_items: order.line_items,
      total_amount: order.total_amount,
      amount_aud: order.amount_aud,  // Include AUD amount for export
      notes: order.notes,
      description: order.description
    }));

    const result = downloadXeroCSV(exportData);
    
    // Handle export failure
    if (!result.valid) {
      toast({
        title: "Export failed",
        description: result.errors.join('. '),
        variant: "destructive"
      });
      return;
    }
    
    // Build toast message based on results
    const { exported, skipped } = result.ordersSummary;
    
    if (skipped > 0) {
      const skippedIds = result.skippedOrders.map(s => s.orderId).join(', ');
      toast({
        title: `Exported ${exported} invoice(s)`,
        description: `Skipped ${skipped} incomplete: ${skippedIds}`,
      });
    } else if (result.warnings.length > 0) {
      toast({
        title: "Export completed with warnings",
        description: `Exported ${exported} invoice(s). ${result.warnings.length} warning(s).`
      });
    } else {
      toast({
        title: "Export successful",
        description: `Exported ${exported} invoice(s) to Xero CSV`
      });
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'completed': return 'default';
      case 'paid': return 'secondary';
      case 'synced': return 'default';
      case 'draft': return 'outline';
      case 'pending': return 'outline';
      default: return 'outline';
    }
  };

  const formatCurrency = (amount: number | null, currency: string = 'AUD') => {
    if (!amount) return 'Not set';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const getInvoiceTypeColor = (type: string | null) => {
    switch (type) {
      case 'Product': return 'bg-blue-100 text-blue-800';
      case 'Freight': return 'bg-green-100 text-green-800';
      case 'Service Fee': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Check if order is incomplete (can't be exported)
  const getOrderIssues = (order: EnhancedAlibabaOrder): string[] => {
    const issues: string[] = [];
    if (!order.invoice_date) issues.push('Missing invoice date');
    if (!order.supplier_name) issues.push('Missing supplier name');
    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    if (lineItems.length === 0 && (!order.total_amount || order.total_amount <= 0)) {
      issues.push('No line items or amount');
    }
    return issues;
  };

  // Fix malformed Alibaba order URLs that are missing the orderId= parameter
  const getFixedOrderUrl = (order: EnhancedAlibabaOrder): string | null => {
    // If we have a direct URL, try to fix it
    if (order.order_url) {
      // Check if URL is malformed (has ? followed directly by order number without orderId=)
      const malformedPattern = /\?(\d{15,})$/;
      if (malformedPattern.test(order.order_url)) {
        return order.order_url.replace(malformedPattern, '?orderId=$1');
      }
      return order.order_url;
    }
    
    // If no URL but we have order_id, construct the URL
    if (order.order_id) {
      return `https://biz.alibaba.com/ta/detail.htm?orderId=${order.order_id}`;
    }
    
    return null;
  };

  if (loading) {
    return <div className="flex justify-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Alibaba Invoice Management</h2>
          <p className="text-muted-foreground">Manage invoices and sync with Xero</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" size="icon" onClick={() => setShowNotificationSettings(!showNotificationSettings)}>
            <Settings className="h-4 w-4" />
          </Button>
          {selectedOrders.size > 0 && selectedCountry === 'Australia' && (
            <Button 
              variant="default" 
              onClick={handleBulkSyncToXero}
              disabled={syncingToXero.size > 0}
            >
              <CloudUpload className="h-4 w-4 mr-2" />
              {syncingToXero.size > 0 ? 'Syncing...' : `Sync to Xero (${selectedOrders.size})`}
            </Button>
          )}
          {selectedOrders.size > 0 && (
            <Button variant="outline" onClick={() => handleExportToCSV(false)}>
              <Download className="h-4 w-4 mr-2" />
              Export Selected ({selectedOrders.size})
            </Button>
          )}
          <Button variant="outline" onClick={() => handleExportToCSV(true)}>
            <Download className="h-4 w-4 mr-2" />
            Export All CSV
          </Button>
          <Button variant="secondary" onClick={() => setIsQuickCreateOpen(true)}>
            <Sparkles className="h-4 w-4 mr-2" />
            Quick Create
          </Button>
          <Button onClick={() => setIsFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Invoice
          </Button>
        </div>
      </div>

      {/* Notification Settings */}
      {showNotificationSettings && (
        <NotificationSettings />
      )}

      {/* Country Tabs */}
      <Tabs value={selectedCountry} onValueChange={(value) => {
        setSelectedCountry(value as InvoiceCountry);
        setSelectedOrders(new Set()); // Clear selection when switching tabs
      }}>
        <TabsList className="bg-muted">
          <TabsTrigger value="Australia" className="data-[state=inactive]:text-foreground data-[state=inactive]:opacity-70">
            🇦🇺 Australia ({orders.filter(o => (o.country || 'Australia') === 'Australia').length})
          </TabsTrigger>
          <TabsTrigger value="UK" className="data-[state=inactive]:text-foreground data-[state=inactive]:opacity-70">
            🇬🇧 UK ({orders.filter(o => o.country === 'UK').length})
          </TabsTrigger>
          <TabsTrigger value="USA" className="data-[state=inactive]:text-foreground data-[state=inactive]:opacity-70">
            🇺🇸 USA ({orders.filter(o => o.country === 'USA').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Invoices - {selectedCountry} ({filteredOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 px-2">
                  <Checkbox
                    checked={filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length}
                    onCheckedChange={(checked) => handleSelectAll(!!checked)}
                  />
                </TableHead>
                <TableHead className="px-2">Order/PI ID</TableHead>
                <TableHead className="px-2">Supplier</TableHead>
                <TableHead className="px-2 w-20">Type</TableHead>
                <TableHead className="px-2 w-24">Amount</TableHead>
                <TableHead className="px-2 w-24">Status</TableHead>
                <TableHead className="px-2 w-24">Xero</TableHead>
                <TableHead className="px-2 w-20">Date</TableHead>
                <TableHead className="px-2 w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => (
                <TableRow key={order.id} className={selectedOrders.has(order.id) ? 'bg-muted/50' : ''}>
                  <TableCell className="px-2">
                    <Checkbox
                      checked={selectedOrders.has(order.id)}
                      onCheckedChange={(checked) => handleSelectOrder(order.id, !!checked)}
                    />
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="flex items-center gap-1">
                      {(() => {
                        const issues = getOrderIssues(order);
                        return issues.length > 0 ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-medium">Incomplete - won't export:</p>
                                <ul className="text-xs list-disc ml-4">
                                  {issues.map((issue, i) => <li key={i}>{issue}</li>)}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : null;
                      })()}
                      <span className="font-mono text-xs">
                        {order.order_id || 'N/A'}
                      </span>
                      {(() => {
                        const fixedUrl = getFixedOrderUrl(order);
                        return fixedUrl ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(fixedUrl, '_blank')}
                            className="p-0.5 h-5 w-5"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        ) : null;
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="max-w-[180px] truncate text-xs">
                      {order.supplier_name || order.description || 'No supplier'}
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    {order.invoice_type ? (
                      <Badge className={`${getInvoiceTypeColor(order.invoice_type)} text-xs px-1.5 py-0`}>
                        {order.invoice_type}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">Legacy</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="text-xs">
                      <span>
                        {order.amount_aud 
                          ? formatCurrency(order.amount_aud, 'AUD')
                          : order.total_amount 
                            ? formatCurrency(order.total_amount, order.currency_code || 'USD')
                            : 'Not set'
                        }
                      </span>
                      {order.amount_aud && order.total_amount && order.currency_code === 'USD' && (
                        <span className="text-muted-foreground block text-[10px]">
                          USD {order.total_amount.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <Select 
                      value={order.status} 
                      onValueChange={(value) => handleStatusChange(order.id, value)}
                    >
                      <SelectTrigger className="h-7 w-20 text-xs px-2">
                        <Badge variant={getStatusBadgeVariant(order.status)} className="text-xs px-1.5 py-0">
                          {order.status}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="px-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1">
                            {order.xero_sync_status === 'synced' ? (
                              <Badge variant="default" className="text-xs px-1.5 py-0">
                                ✓ Synced
                              </Badge>
                            ) : order.xero_sync_status === 'error' ? (
                              <Badge variant="destructive" className="text-xs px-1.5 py-0">
                                Error
                              </Badge>
                            ) : syncingToXero.has(order.id) ? (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                Syncing
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs px-1.5 py-0">Not Synced</Badge>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {order.xero_sync_status === 'synced' && order.xero_invoice_number && (
                            <p>Invoice: {order.xero_invoice_number}</p>
                          )}
                          {order.xero_sync_status === 'error' && order.xero_sync_error && (
                            <p className="text-destructive">{order.xero_sync_error}</p>
                          )}
                          {order.xero_sync_status !== 'synced' && order.xero_sync_status !== 'error' && (
                            <p>Click menu to sync to Xero</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="text-xs">
                      {order.invoice_date 
                        ? new Date(order.invoice_date).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit' })
                        : new Date(order.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit' })
                      }
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => openEditForm(order)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        
                        {(order.pdf_file_path || (Array.isArray(order.attachments) && order.attachments.length > 0)) && (
                          <DropdownMenuItem onClick={async () => {
                            const filePaths: string[] = [];
                            if (order.pdf_file_path) filePaths.push(order.pdf_file_path);
                            if (Array.isArray(order.attachments)) {
                              order.attachments.forEach((att: any) => {
                                if (typeof att === 'string') filePaths.push(att);
                                else if (att?.path) filePaths.push(att.path);
                              });
                            }
                            
                            if (filePaths.length === 0) {
                              toast({ title: "No attachments", variant: "destructive" });
                              return;
                            }
                            
                            for (const filePath of filePaths) {
                              const { data } = await supabase.storage
                                .from('alibaba-attachments')
                                .createSignedUrl(filePath, 300);
                              if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                            }
                          }}>
                            <Download className="h-4 w-4 mr-2" />
                            Download Files
                          </DropdownMenuItem>
                        )}
                        
                        {/* Sync to Xero - only for Australian invoices */}
                        {(order.country || 'Australia') === 'Australia' && order.xero_sync_status !== 'synced' && (
                          <DropdownMenuItem 
                            onClick={() => handleSyncToXero(order)}
                            disabled={syncingToXero.has(order.id)}
                          >
                            <CloudUpload className="h-4 w-4 mr-2" />
                            {syncingToXero.has(order.id) ? 'Syncing...' : 'Sync to Xero'}
                          </DropdownMenuItem>
                        )}
                        
                        <DropdownMenuItem onClick={async () => {
                          const newStatus = order.xero_sync_status === 'synced' ? 'not_synced' : 'synced';
                          try {
                            const { error } = await supabase
                              .from('alibaba_orders')
                              .update({ 
                                xero_sync_status: newStatus,
                                xero_synced_at: newStatus === 'synced' ? new Date().toISOString() : null,
                                xero_sync_error: null
                              })
                              .eq('id', order.id);
                            
                            if (error) throw error;
                            toast({
                              title: newStatus === 'synced' ? "Marked as Synced" : "Marked as Not Synced",
                            });
                            fetchOrders();
                          } catch (error) {
                            toast({ title: "Error", variant: "destructive" });
                          }
                        }}>
                          <Check className="h-4 w-4 mr-2" />
                          {order.xero_sync_status === 'synced' ? 'Mark Not Synced' : 'Mark Synced'}
                        </DropdownMenuItem>
                        
                        <DropdownMenuItem 
                          onClick={() => handleSendEmailAlert(order)}
                          disabled={sendingEmail === order.id}
                        >
                          <Mail className="h-4 w-4 mr-2" />
                          {sendingEmail === order.id ? 'Sending...' : 'Send Email Alert'}
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem 
                          onClick={() => handleDeleteOrder(order.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {filteredOrders.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <div className="mb-2">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
              </div>
              <div className="text-lg font-medium">No invoices found for {selectedCountry}</div>
              <p>Create your first {selectedCountry} invoice to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enhanced Invoice Form */}
      <EnhancedAlibabaInvoiceForm
        isOpen={isFormOpen}
        onClose={closeForm}
        onSuccess={fetchOrders}
        editingOrder={editingOrder}
        defaultCountry={selectedCountry}
      />

      {/* Quick Create Dialog */}
      <QuickAlibabaInvoiceCreator
        open={isQuickCreateOpen}
        defaultCountry={selectedCountry}
        onOpenChange={setIsQuickCreateOpen}
        onInvoiceCreated={fetchOrders}
      />
    </div>
  );
};

export default AlibabaManagement;