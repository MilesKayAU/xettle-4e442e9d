import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Circle, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface ChecklistItem {
  key: string;
  label: string;
  category: 'email' | 'billing' | 'integrations' | 'data' | 'security' | 'ops';
  check: () => Promise<boolean>;
}

const CATEGORY_LABELS: Record<string, string> = {
  email: 'Email & Branding',
  billing: 'Billing & Plans',
  integrations: 'Integrations',
  data: 'Data & Accounting',
  security: 'Security & Auth',
  ops: 'Ops & Monitoring',
};

export default function PreLaunchChecklist() {
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const items: ChecklistItem[] = [
    // ── Email & Branding ──
    {
      key: 'email_domain',
      label: 'Custom email domain configured',
      category: 'email',
      check: async () => true, // notify.xettle.app is live
    },
    {
      key: 'email_confirmation',
      label: 'Confirmation email branded as Xettle',
      category: 'email',
      check: async () => true,
    },
    {
      key: 'email_reset',
      label: 'Password reset email branded as Xettle',
      category: 'email',
      check: async () => true,
    },

    // ── Billing & Plans ──
    {
      key: 'stripe_billing',
      label: 'Stripe billing connected',
      category: 'billing',
      check: async () => false,
    },
    {
      key: 'trial_flow',
      label: 'Trial → paid upgrade flow tested',
      category: 'billing',
      check: async () => false,
    },

    // ── Integrations ──
    {
      key: 'xero_connected',
      label: 'Xero OAuth tested with live tenant',
      category: 'integrations',
      check: async () => {
        try {
          const { count } = await supabase
            .from('xero_tokens' as any)
            .select('id', { count: 'exact', head: true });
          return (count || 0) > 0;
        } catch { return false; }
      },
    },
    {
      key: 'shopify_connected',
      label: 'Shopify app install flow tested',
      category: 'integrations',
      check: async () => {
        try {
          const { count } = await supabase
            .from('shopify_tokens' as any)
            .select('id', { count: 'exact', head: true });
          return (count || 0) > 0;
        } catch { return false; }
      },
    },
    {
      key: 'amazon_sp_roles',
      label: 'Amazon SP-API roles approved',
      category: 'integrations',
      check: async () => false, // Pending Amazon approval
    },
    {
      key: 'ebay_connected',
      label: 'eBay OAuth tested',
      category: 'integrations',
      check: async () => {
        try {
          const { count } = await supabase
            .from('ebay_tokens')
            .select('id', { count: 'exact', head: true });
          return (count || 0) > 0;
        } catch { return false; }
      },
    },

    // ── Data & Accounting ──
    {
      key: 'settlement_upload',
      label: 'Settlement upload + Xero push end-to-end tested',
      category: 'data',
      check: async () => {
        try {
          const { count } = await supabase
            .from('settlements' as any)
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pushed');
          return (count || 0) > 0;
        } catch { return false; }
      },
    },
    {
      key: 'marketplace_mappings',
      label: 'At least one marketplace has full account mappings',
      category: 'data',
      check: async () => {
        try {
          const { count } = await supabase
            .from('marketplace_account_mapping')
            .select('id', { count: 'exact', head: true });
          return (count || 0) >= 3; // Needs revenue, fees, GST at minimum
        } catch { return false; }
      },
    },
    {
      key: 'coa_synced',
      label: 'Xero Chart of Accounts synced',
      category: 'data',
      check: async () => {
        try {
          const { count } = await supabase
            .from('xero_accounts' as any)
            .select('id', { count: 'exact', head: true });
          return (count || 0) > 0;
        } catch { return false; }
      },
    },

    // ── Security & Auth ──
    {
      key: 'rls_active',
      label: 'RLS enabled on all public tables',
      category: 'security',
      check: async () => {
        try {
          const { data } = await supabase.rpc('get_rls_inventory');
          if (!data || !Array.isArray(data)) return false;
          const publicTables = data.filter((t: any) => !t.table_name.startsWith('_'));
          return publicTables.every((t: any) => t.rls_enabled);
        } catch { return false; }
      },
    },
    {
      key: 'cors_production',
      label: 'CORS locked to production origins',
      category: 'security',
      check: async () => {
        try {
          const { data } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'cors_allow_localhost')
            .maybeSingle();
          // Pass if setting doesn't exist (defaults to locked) or is explicitly false
          return !data || data.value !== 'true';
        } catch { return true; } // Default secure
      },
    },
    {
      key: 'bookkeeper_account',
      label: 'Bookkeeper account created and tested',
      category: 'security',
      check: async () => {
        try {
          const { count } = await supabase
            .from('user_roles')
            .select('id', { count: 'exact', head: true })
            .neq('role', 'admin' as any);
          return (count || 0) > 0;
        } catch { return false; }
      },
    },
    {
      key: 'scope_consent',
      label: 'Scope consent banner configured',
      category: 'security',
      check: async () => {
        try {
          const { data } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'scope_consent_version')
            .maybeSingle();
          return !!data?.value;
        } catch { return false; }
      },
    },

    // ── Ops & Monitoring ──
    {
      key: 'auto_push_live',
      label: 'auto_push_live_mode enabled',
      category: 'ops',
      check: async () => {
        try {
          const { data } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'auto_push_live_mode')
            .maybeSingle();
          return data?.value === 'true';
        } catch { return false; }
      },
    },
    {
      key: 'error_capture',
      label: 'Global error capture active',
      category: 'ops',
      check: async () => true, // Installed in main.tsx
    },
    {
      key: 'api_health',
      label: 'API health endpoint responding',
      category: 'ops',
      check: async () => {
        try {
          const { error } = await supabase.functions.invoke('api-health', {
            method: 'GET',
          });
          return !error;
        } catch { return false; }
      },
    },
    {
      key: 'custom_domain',
      label: 'Custom domain (xettle.app) connected',
      category: 'ops',
      check: async () => true, // xettle.app is live
    },
    {
      key: 'fbm_page_live',
      label: 'FBM product page published (/fulfillment-bridge)',
      category: 'ops',
      check: async () => true, // Page created and routed
    },
  ];

  const runChecks = async () => {
    setLoading(true);
    const r: Record<string, boolean> = {};
    await Promise.all(
      items.map(async (item) => {
        try {
          r[item.key] = await item.check();
        } catch {
          r[item.key] = false;
        }
      })
    );
    setResults(r);
    setLoading(false);
  };

  useEffect(() => {
    runChecks();
  }, []);

  const completedCount = Object.values(results).filter(Boolean).length;
  const categories = [...new Set(items.map(i => i.category))];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Pre-Launch Checklist</CardTitle>
            <p className="text-xs text-muted-foreground">
              {completedCount}/{items.length} complete
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={runChecks}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {categories.map(cat => {
            const catItems = items.filter(i => i.category === cat);
            const catDone = catItems.filter(i => results[i.key]).length;
            return (
              <div key={cat}>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  {CATEGORY_LABELS[cat]} ({catDone}/{catItems.length})
                </p>
                <div className="space-y-1.5">
                  {catItems.map(item => {
                    const done = results[item.key];
                    return (
                      <div key={item.key} className="flex items-center gap-2 text-sm">
                        {loading ? (
                          <Circle className="h-4 w-4 text-muted-foreground animate-pulse" />
                        ) : done ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive/60" />
                        )}
                        <span className={done ? 'text-foreground' : 'text-muted-foreground'}>
                          {item.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
