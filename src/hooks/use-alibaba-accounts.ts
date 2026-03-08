import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface AlibabaAccountDetails {
  alibaba_buyer_email: string;
  alibaba_buyer_company: string;
  alibaba_buyer_id: string;
  additional_instructions?: string;
}

const DEFAULT_ACCOUNT: AlibabaAccountDetails = {
  alibaba_buyer_email: '',
  alibaba_buyer_company: '',
  alibaba_buyer_id: '',
  additional_instructions: '',
};

export type CountryKey = 'Australia' | 'UK' | 'USA';

export function useAlibabaAccounts() {
  const [accounts, setAccounts] = useState<Record<CountryKey, AlibabaAccountDetails>>({
    Australia: { ...DEFAULT_ACCOUNT },
    UK: { ...DEFAULT_ACCOUNT },
    USA: { ...DEFAULT_ACCOUNT },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<CountryKey | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['alibaba_account_Australia', 'alibaba_account_UK', 'alibaba_account_USA']);

      if (error) throw error;

      const newAccounts: Record<CountryKey, AlibabaAccountDetails> = {
        Australia: { ...DEFAULT_ACCOUNT },
        UK: { ...DEFAULT_ACCOUNT },
        USA: { ...DEFAULT_ACCOUNT },
      };

      data?.forEach((setting) => {
        const country = setting.key.replace('alibaba_account_', '') as CountryKey;
        if (setting.value) {
          try {
            newAccounts[country] = JSON.parse(setting.value);
          } catch (e) {
            console.error(`Failed to parse ${country} settings:`, e);
          }
        }
      });

      setAccounts(newAccounts);
    } catch (error) {
      console.error('Failed to fetch Alibaba accounts:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const saveAccount = async (country: CountryKey, details: AlibabaAccountDetails) => {
    setSaving(country);
    const key = `alibaba_account_${country}`;
    
    try {
      // Check if the setting exists
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', key)
        .single();

      const value = JSON.stringify(details);

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from('app_settings')
          .update({ value, updated_at: new Date().toISOString() })
          .eq('key', key);
        
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from('app_settings')
          .insert({ key, value });
        
        if (error) throw error;
      }

      setAccounts(prev => ({
        ...prev,
        [country]: details,
      }));

      toast({
        title: 'Saved',
        description: `${country} Alibaba account settings saved successfully.`,
      });
    } catch (error) {
      console.error('Failed to save Alibaba account:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  const isConfigured = (country: CountryKey): boolean => {
    const account = accounts[country];
    return !!(account.alibaba_buyer_email && account.alibaba_buyer_company);
  };

  return {
    accounts,
    loading,
    saving,
    saveAccount,
    isConfigured,
    refetch: fetchAccounts,
  };
}
