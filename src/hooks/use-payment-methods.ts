import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const PAYMENT_METHODS_KEY = 'payment_methods';
const DEFAULT_PAYMENT_METHODS = [
  'AMEX GOLD',
  'AMEX BLUE',
  'St George Debit',
  'Wise',
  'PayPal',
  'Bank transfer',
  'Qantas Business Rewards Card'
];

export function usePaymentMethods() {
  const [paymentMethods, setPaymentMethods] = useState<string[]>(DEFAULT_PAYMENT_METHODS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchPaymentMethods = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', PAYMENT_METHODS_KEY)
        .maybeSingle();

      if (error) throw error;

      if (data?.value) {
        try {
          const methods = JSON.parse(data.value);
          if (Array.isArray(methods) && methods.length > 0) {
            setPaymentMethods(methods);
          }
        } catch (parseError) {
          console.error('Error parsing payment methods:', parseError);
        }
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  const savePaymentMethods = async (methods: string[]) => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', PAYMENT_METHODS_KEY)
        .maybeSingle();

      const value = JSON.stringify(methods);

      if (existing) {
        const { error } = await supabase
          .from('app_settings')
          .update({ value, updated_at: new Date().toISOString() })
          .eq('key', PAYMENT_METHODS_KEY);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('app_settings')
          .insert({ key: PAYMENT_METHODS_KEY, value });

        if (error) throw error;
      }

      setPaymentMethods(methods);
      toast({
        title: 'Payment methods saved',
        description: `${methods.length} payment methods configured`,
      });
    } catch (error: any) {
      console.error('Error saving payment methods:', error);
      toast({
        title: 'Failed to save',
        description: error.message || 'Could not save payment methods',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const addPaymentMethod = async (method: string) => {
    const trimmed = method.trim();
    if (!trimmed) return;
    if (paymentMethods.includes(trimmed)) {
      toast({
        title: 'Already exists',
        description: `"${trimmed}" is already in the list`,
        variant: 'destructive',
      });
      return;
    }
    await savePaymentMethods([...paymentMethods, trimmed]);
  };

  const removePaymentMethod = async (method: string) => {
    const updated = paymentMethods.filter(m => m !== method);
    if (updated.length === 0) {
      toast({
        title: 'Cannot remove',
        description: 'You must have at least one payment method',
        variant: 'destructive',
      });
      return;
    }
    await savePaymentMethods(updated);
  };

  const updatePaymentMethod = async (oldMethod: string, newMethod: string) => {
    const trimmed = newMethod.trim();
    if (!trimmed) return;
    if (paymentMethods.includes(trimmed) && trimmed !== oldMethod) {
      toast({
        title: 'Already exists',
        description: `"${trimmed}" is already in the list`,
        variant: 'destructive',
      });
      return;
    }
    const updated = paymentMethods.map(m => m === oldMethod ? trimmed : m);
    await savePaymentMethods(updated);
  };

  const reorderPaymentMethods = async (methods: string[]) => {
    await savePaymentMethods(methods);
  };

  return {
    paymentMethods,
    loading,
    saving,
    addPaymentMethod,
    removePaymentMethod,
    updatePaymentMethod,
    reorderPaymentMethods,
    refetch: fetchPaymentMethods,
  };
}
