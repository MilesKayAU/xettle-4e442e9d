import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, CloudDownload, Upload, CheckCircle2, Lock, Crown, Loader2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface AutomationSettingsPanelProps {
  userTier: 'free' | 'starter' | 'pro';
}

interface AutomationSettings {
  amazon_auto_fetch: boolean;
  amazon_fetch_interval: string; // '12' or '24'
  xero_auto_push: boolean;
  xero_push_requires_approval: boolean;
}

const DEFAULT_SETTINGS: AutomationSettings = {
  amazon_auto_fetch: false,
  amazon_fetch_interval: '24',
  xero_auto_push: false,
  xero_push_requires_approval: true,
};

export default function AutomationSettingsPanel({ userTier }: AutomationSettingsPanelProps) {
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canAmazonFetch = userTier === 'starter' || userTier === 'pro';
  const canXeroPush = userTier === 'pro';
  const canTwelveHour = userTier === 'pro';

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('key, value')
          .in('key', ['automation_amazon_auto_fetch', 'automation_amazon_fetch_interval', 'automation_xero_auto_push', 'automation_xero_push_requires_approval']);
        if (data) {
          const map: Record<string, string> = {};
          data.forEach(r => { if (r.value) map[r.key] = r.value; });
          setSettings({
            amazon_auto_fetch: map['automation_amazon_auto_fetch'] === 'true',
            amazon_fetch_interval: map['automation_amazon_fetch_interval'] || '24',
            xero_auto_push: map['automation_xero_auto_push'] === 'true',
            xero_push_requires_approval: map['automation_xero_push_requires_approval'] !== 'false',
          });
        }
      } catch {} finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const saveSetting = useCallback(async (key: string, value: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const fullKey = `automation_${key}`;

      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', fullKey)
        .eq('user_id', user.id)
        .limit(1);

      if (existing && existing.length > 0) {
        await supabase.from('app_settings').update({ value }).eq('id', existing[0].id);
      } else {
        await supabase.from('app_settings').insert({ user_id: user.id, key: fullKey, value });
      }
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    }
  }, []);

  const handleToggle = async (key: keyof AutomationSettings, value: boolean | string) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await saveSetting(key, String(value));
    
    if (key === 'amazon_auto_fetch') {
      toast.success(value ? 'Amazon auto-fetch enabled' : 'Amazon auto-fetch disabled');
    } else if (key === 'xero_auto_push') {
      toast.success(value ? 'Xero auto-push enabled' : 'Xero auto-push disabled');
    } else if (key === 'xero_push_requires_approval') {
      toast.success(value ? 'Manual approval required before Xero push' : 'Settlements will auto-push without approval');
    } else if (key === 'amazon_fetch_interval') {
      toast.success(`Fetch interval set to every ${value} hours`);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          Automation Controls
        </CardTitle>
        <CardDescription className="text-xs">
          Toggle automations on and off. Start manual, scale up as you're comfortable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Amazon Auto-Fetch ── */}
        <div className={`rounded-lg border p-4 space-y-3 ${canAmazonFetch ? 'border-border' : 'border-border bg-muted/30'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CloudDownload className="h-4 w-4 text-primary" />
              <div>
                <Label className="text-sm font-medium">Auto-fetch from Amazon</Label>
                <p className="text-xs text-muted-foreground">Automatically download new settlement reports via SP-API</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!canAmazonFetch && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Lock className="h-3 w-3" /> Starter+
                </Badge>
              )}
              <Switch
                checked={settings.amazon_auto_fetch}
                onCheckedChange={(checked) => handleToggle('amazon_auto_fetch', checked)}
                disabled={!canAmazonFetch}
              />
            </div>
          </div>

          {canAmazonFetch && settings.amazon_auto_fetch && (
            <div className="flex items-center gap-3 ml-6">
              <Label className="text-xs text-muted-foreground">Check every:</Label>
              <Select
                value={settings.amazon_fetch_interval}
                onValueChange={(val) => handleToggle('amazon_fetch_interval', val)}
              >
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">
                    <span>24 hours (daily)</span>
                  </SelectItem>
                  <SelectItem value="12" disabled={!canTwelveHour}>
                    <div className="flex items-center gap-1.5">
                      <span>12 hours</span>
                      {!canTwelveHour && <Lock className="h-3 w-3 text-muted-foreground" />}
                      {canTwelveHour && <Crown className="h-3 w-3 text-primary" />}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!canAmazonFetch && (
            <p className="text-xs text-muted-foreground ml-6">
              Upgrade to <strong className="text-foreground">Starter ($129/yr)</strong> to auto-fetch settlements from Amazon.{' '}
              <Link to="/pricing" className="text-primary hover:underline">View Plans</Link>
            </p>
          )}
        </div>

        {/* ── Xero Auto-Push ── */}
        <div className={`rounded-lg border p-4 space-y-3 ${canXeroPush ? 'border-border' : 'border-border bg-muted/30'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              <div>
                <Label className="text-sm font-medium">Auto-push to Xero</Label>
                <p className="text-xs text-muted-foreground">Automatically push reconciled settlements to Xero as journals</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!canXeroPush && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Crown className="h-3 w-3" /> Pro
                </Badge>
              )}
              <Switch
                checked={settings.xero_auto_push}
                onCheckedChange={(checked) => handleToggle('xero_auto_push', checked)}
                disabled={!canXeroPush}
              />
            </div>
          </div>

          {canXeroPush && settings.xero_auto_push && (
            <div className="ml-6 space-y-3">
              {/* Approval toggle */}
              <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
                <div>
                  <Label className="text-xs font-medium">Require manual approval</Label>
                  <p className="text-[11px] text-muted-foreground">
                    {settings.xero_push_requires_approval
                      ? 'Settlements are fetched automatically but wait for your approval before pushing to Xero'
                      : 'Reconciled settlements push to Xero automatically — fully hands-off'}
                  </p>
                </div>
                <Switch
                  checked={settings.xero_push_requires_approval}
                  onCheckedChange={(checked) => handleToggle('xero_push_requires_approval', checked)}
                />
              </div>

              {!settings.xero_push_requires_approval && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Full automation is enabled — reconciled settlements will push to Xero without manual review. You can always review journals in your Xero history.</span>
                </div>
              )}
            </div>
          )}

          {!canXeroPush && (
            <p className="text-xs text-muted-foreground ml-6">
              Upgrade to <strong className="text-foreground">Pro ($229/yr)</strong> for automatic Xero push with optional manual approval.{' '}
              <Link to="/pricing" className="text-primary hover:underline">View Plans</Link>
            </p>
          )}
        </div>

        {/* Summary */}
        <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            Your current workflow:
          </p>
          {userTier === 'free' && (
            <p>📋 Manual upload → Review → Manual push to Xero</p>
          )}
          {userTier === 'starter' && (
            <p>
              {settings.amazon_auto_fetch
                ? '🤖 Auto-fetch from Amazon → Review → Manual push to Xero'
                : '📋 Manual fetch → Review → Manual push to Xero'}
            </p>
          )}
          {userTier === 'pro' && (
            <p>
              {settings.amazon_auto_fetch && settings.xero_auto_push && !settings.xero_push_requires_approval
                ? '🚀 Fully automatic — Amazon → Parse → Xero (hands-off)'
                : settings.amazon_auto_fetch && settings.xero_auto_push && settings.xero_push_requires_approval
                ? '🤖 Auto-fetch → Review & Approve → Auto-push to Xero'
                : settings.amazon_auto_fetch
                ? '🤖 Auto-fetch from Amazon → Review → Manual push to Xero'
                : '📋 Manual upload → Review → Manual push to Xero'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
