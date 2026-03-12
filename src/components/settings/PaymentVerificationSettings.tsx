/**
 * PaymentVerificationSettings — Toggle payment verification per gateway channel.
 * 
 * PAYMENT VERIFICATION LAYER ONLY
 * This component manages VERIFICATION settings.
 * No invoice. No journal. No Xero push.
 * Settlements are the only accounting source.
 * See: architecture rule #11
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Settings2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ACCOUNTING_RULES } from '@/constants/accounting-rules';

// Rule #11 enforcement
if (!ACCOUNTING_RULES.PAYMENTS_NEVER_CREATE_ACCOUNTING_ENTRIES) {
  throw new Error('CRITICAL: Accounting rule violated');
}

interface GatewayConfig {
  code: string;
  label: string;
  enabledKey: string;
  accountIdKey: string;
}

const GATEWAYS: GatewayConfig[] = [
  { code: 'paypal', label: 'PayPal', enabledKey: 'paypal_verification_enabled', accountIdKey: 'paypal_xero_account_id' },
  { code: 'shopify_payments', label: 'Shopify Payments', enabledKey: 'shopify_payments_verification_enabled', accountIdKey: 'shopify_payments_xero_account_id' },
  { code: 'manual_gateway', label: 'Manual Gateway', enabledKey: 'manual_gateway_verification_enabled', accountIdKey: '' },
];

export default function PaymentVerificationSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const keys = GATEWAYS.flatMap(g => [g.enabledKey, g.accountIdKey]).filter(Boolean);
      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', keys);

      const map: Record<string, string> = {};
      for (const s of (data || [])) {
        map[s.key] = s.value || '';
      }
      setSettings(map);
    } catch (err) {
      console.error('Failed to load payment verification settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleGateway = async (gateway: GatewayConfig, enabled: boolean) => {
    setToggling(gateway.code);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated');

      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', gateway.enabledKey)
        .maybeSingle();

      if (existing) {
        await supabase.from('app_settings')
          .update({ value: enabled ? 'true' : 'false' })
          .eq('id', existing.id);
      } else {
        await supabase.from('app_settings')
          .insert({ user_id: session.user.id, key: gateway.enabledKey, value: enabled ? 'true' : 'false' });
      }

      setSettings(prev => ({ ...prev, [gateway.enabledKey]: enabled ? 'true' : 'false' }));
      toast.success(`${gateway.label} verification ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message}`);
    } finally {
      setToggling(null);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Payment Verification</CardTitle>
        </div>
        <CardDescription>
          Toggle which payment channels get verification against Xero bank feeds.
          This is verification only — no accounting entries are created.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {GATEWAYS.map(gateway => {
          const isEnabled = settings[gateway.enabledKey] === 'true';
          const hasAccount = !!settings[gateway.accountIdKey];
          const isManual = gateway.code === 'manual_gateway';

          return (
            <div
              key={gateway.code}
              className="flex items-center justify-between p-3 rounded-lg border border-border"
            >
              <div className="flex items-center gap-3">
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => toggleGateway(gateway, checked)}
                  disabled={toggling === gateway.code || (isManual && !hasAccount)}
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{gateway.label}</p>
                  {hasAccount && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      Xero bank feed detected
                    </p>
                  )}
                  {!hasAccount && !isManual && (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      No {gateway.label} account found in Xero — connect bank feed to enable
                    </p>
                  )}
                  {isManual && (
                    <p className="text-xs text-muted-foreground">Not configured</p>
                  )}
                </div>
              </div>
              {isEnabled && (
                <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:text-green-400">
                  Active
                </Badge>
              )}
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          Payment verification matches gateway transactions against your orders for confirmation.
          Settlements remain the only source of accounting entries (Rule #11).
        </p>
      </CardContent>
    </Card>
  );
}
