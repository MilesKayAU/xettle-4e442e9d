import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { 
  PurchaseOrder, 
  PurchaseOrderWithSupplier, 
  CreatePurchaseOrderInput,
  PurchaseOrderLineItem 
} from '@/types/purchase-orders';

// Helper to check if user is admin
const checkAdminStatus = async (): Promise<boolean> => {
  try {
    const { data, error } = await supabase.rpc('has_role', { _role: 'admin' });
    if (error) {
      console.error('Failed to check admin status:', error);
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
};

export const usePurchaseOrders = () => {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithSupplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const generatePONumber = (country: string): string => {
    const countryCode = country === 'Australia' ? 'AU' : country === 'UK' ? 'UK' : 'US';
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString().slice(-6);
    return `PO-${countryCode}-${year}-${timestamp}`;
  };

  const fetchPurchaseOrders = useCallback(async (country?: string) => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error('Not authenticated');
      }

      // Verify admin status
      const isAdmin = await checkAdminStatus();
      if (!isAdmin) {
        throw new Error('Unauthorized: Admin access required');
      }

      let query = supabase
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(
            id,
            name,
            company_name,
            contact_person,
            email,
            phone
          )
        `)
        .order('created_at', { ascending: false });

      if (country) {
        query = query.eq('country', country);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Parse line_items from JSON
      const parsed = (data || []).map(po => ({
        ...po,
        line_items: (po.line_items as unknown as PurchaseOrderLineItem[]) || [],
      })) as PurchaseOrderWithSupplier[];

      setPurchaseOrders(parsed);
    } catch (error: any) {
      console.error('Failed to fetch purchase orders:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load purchase orders',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const createPurchaseOrder = useCallback(async (input: CreatePurchaseOrderInput): Promise<PurchaseOrder | null> => {
    setCreating(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error('Not authenticated');
      }

      // Verify admin status before creating
      const isAdmin = await checkAdminStatus();
      if (!isAdmin) {
        throw new Error('Unauthorized: Only admins can create purchase orders');
      }

      // Validate input
      if (!input.country || !['Australia', 'UK', 'USA'].includes(input.country)) {
        throw new Error('Invalid country');
      }
      if (!input.line_items || input.line_items.length === 0) {
        throw new Error('At least one line item is required');
      }

      const poNumber = generatePONumber(input.country);
      const totalAmount = input.line_items.reduce((sum, item) => sum + item.total, 0);

      const { data, error } = await supabase
        .from('purchase_orders')
        .insert({
          user_id: userData.user.id,
          supplier_id: input.supplier_id,
          po_number: poNumber,
          country: input.country,
          currency: input.currency,
          notes: input.notes || null,
          terms: input.terms || null,
          line_items: input.line_items as unknown as any,
          total_amount: totalAmount,
          status: 'draft',
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Purchase Order Created',
        description: `${poNumber} has been created as a draft`,
      });

      return data as unknown as PurchaseOrder;
    } catch (error: any) {
      console.error('Failed to create purchase order:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create purchase order',
        variant: 'destructive',
      });
      return null;
    } finally {
      setCreating(false);
    }
  }, []);

  const updatePurchaseOrderStatus = useCallback(async (
    poId: string, 
    status: PurchaseOrder['status'],
    additionalData?: Partial<PurchaseOrder>
  ) => {
    try {
      const updateData: any = { 
        status,
        ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
        ...additionalData,
      };

      const { error } = await supabase
        .from('purchase_orders')
        .update(updateData)
        .eq('id', poId);

      if (error) throw error;

      toast({
        title: 'Status Updated',
        description: `Purchase order status changed to ${status}`,
      });

      return true;
    } catch (error) {
      console.error('Failed to update purchase order:', error);
      toast({
        title: 'Error',
        description: 'Failed to update purchase order',
        variant: 'destructive',
      });
      return false;
    }
  }, []);

  const deletePurchaseOrder = useCallback(async (poId: string) => {
    try {
      const { error } = await supabase
        .from('purchase_orders')
        .delete()
        .eq('id', poId);

      if (error) throw error;

      toast({
        title: 'Deleted',
        description: 'Purchase order has been deleted',
      });

      return true;
    } catch (error) {
      console.error('Failed to delete purchase order:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete purchase order',
        variant: 'destructive',
      });
      return false;
    }
  }, []);

  return {
    purchaseOrders,
    loading,
    creating,
    fetchPurchaseOrders,
    createPurchaseOrder,
    updatePurchaseOrderStatus,
    deletePurchaseOrder,
    generatePONumber,
  };
};
