import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Truck, Play, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/ui/loading-spinner';

interface ShippingStats {
  marketplace_code: string;
  avg_shipping_cost_60: number | null;
  avg_shipping_cost_14: number | null;
  sample_size: number;
  last_updated: string;
}

export default function ShippingEstimateSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [fromPostcode, setFromPostcode] = useState('');
  const [defaultWeight, setDefaultWeight] = useState('500');
  const [defaultLength, setDefaultLength] = useState('30');
  const [defaultWidth, setDefaultWidth] = useState('20');
  const [defaultHeight, setDefaultHeight] = useState('15');
  const [defaultService, setDefaultService] = useState('AUS_PARCEL_REGULAR');
  const [batchSize, setBatchSize] = useState('20');
  const [stats, setStats] = useState<ShippingStats[]>([]);
  const [lastResult, setLastResult] = useState<any>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [settingsRes, statsRes] = await Promise.all([
        supabase
          .from('app_settings')
          .select('key, value')
          .eq('user_id', user.id)
          .like('key', 'shipping:%'),
        supabase
          .from('marketplace_shipping_stats')
          .select('*')
          .eq('user_id', user.id)
          .order('marketplace_code'),
      ]);

      const map: Record<string, string> = {};
      for (const row of settingsRes.data || []) {
        map[row.key] = row.value || '';
      }

      setEnabled(map['shipping:enabled'] === 'true');
      setFromPostcode(map['shipping:from_postcode'] || '');
      setDefaultWeight(map['shipping:default_weight_grams'] || '500');
      setDefaultLength(map['shipping:default_length'] || '30');
      setDefaultWidth(map['shipping:default_width'] || '20');
      setDefaultHeight(map['shipping:default_height'] || '15');
      setDefaultService(map['shipping:default_service'] || 'AUS_PARCEL_REGULAR');
      setStats((statsRes.data || []) as ShippingStats[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function saveSetting(key: string, value: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('app_settings').upsert(
      { user_id: user.id, key, value },
      { onConflict: 'user_id,key' }
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all([
        saveSetting('shipping:enabled', enabled ? 'true' : 'false'),
        saveSetting('shipping:from_postcode', fromPostcode),
        saveSetting('shipping:default_weight_grams', defaultWeight),
        saveSetting('shipping:default_length', defaultLength),
        saveSetting('shipping:default_width', defaultWidth),
        saveSetting('shipping:default_height', defaultHeight),
        saveSetting('shipping:default_service', defaultService),
      ]);
      toast({ title: 'Settings saved', description: 'Shipping estimate settings updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save settings.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleEstimateNow() {
    setEstimating(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('estimate-shipping-cost', {
        body: { batch_size: Math.min(parseInt(batchSize) || 20, 50) },
      });
      if (error) throw error;
      setLastResult(data);
      toast({
        title: 'Estimation complete',
        description: `Estimated: ${data.estimated}, Skipped: ${data.skipped}, No service: ${data.skipped_no_service || 0}`,
      });
      // Refresh stats
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: newStats } = await supabase
          .from('marketplace_shipping_stats')
          .select('*')
          .eq('user_id', user.id)
          .order('marketplace_code');
        setStats((newStats || []) as ShippingStats[]);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to estimate shipping.', variant: 'destructive' });
    } finally {
      setEstimating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="md" text="Loading shipping settings..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Non-dismissible warning banner */}
      <div className="rounded-md border border-amber-400/50 bg-amber-50/80 dark:bg-amber-900/20 dark:border-amber-700/40 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Analytics Only — Not Used for Accounting</p>
            <p className="text-xs text-amber-700 dark:text-amber-400/80">
              Estimated shipping cost is calculated using Australia Post PAC API. Accuracy depends on correct weight
              and dimensions in Shopify. Shopify product weights must be maintained at the variant level. Package dimensions
              use your default carton settings, not product dimensions. This data is used <strong>only for Insights and
              profitability analysis</strong>. It is not used for accounting or Xero exports.
            </p>
          </div>
        </div>
      </div>

      {/* Enable / Disable */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Shipping Cost Estimation</CardTitle>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          <CardDescription className="text-xs">
            Estimate shipping costs per order using Australia Post PAC API
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Default Settings</CardTitle>
          <CardDescription className="text-xs">
            Used when Shopify order data is incomplete
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">From Postcode (sender)</Label>
              <Input
                value={fromPostcode}
                onChange={(e) => setFromPostcode(e.target.value)}
                placeholder="e.g. 3000"
                maxLength={4}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Default Service</Label>
              <Select value={defaultService} onValueChange={setDefaultService}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUS_PARCEL_REGULAR">Regular Parcel</SelectItem>
                  <SelectItem value="AUS_PARCEL_EXPRESS">Express Parcel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Default Weight (g)</Label>
              <Input
                type="number"
                value={defaultWeight}
                onChange={(e) => setDefaultWeight(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Length (cm)</Label>
              <Input
                type="number"
                value={defaultLength}
                onChange={(e) => setDefaultLength(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Width (cm)</Label>
              <Input
                type="number"
                value={defaultWidth}
                onChange={(e) => setDefaultWidth(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Height (cm)</Label>
              <Input
                type="number"
                value={defaultHeight}
                onChange={(e) => setDefaultHeight(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Estimate Now */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run Estimation</CardTitle>
          <CardDescription className="text-xs">
            Estimate shipping costs for fulfilled Shopify orders not yet estimated
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-24">
              <Label className="text-xs">Batch Size</Label>
              <Input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
                min={1}
                max={50}
                className="mt-1"
              />
            </div>
            <Button
              onClick={handleEstimateNow}
              disabled={estimating || !enabled}
              className="mt-5"
            >
              {estimating ? (
                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              Estimate Now
            </Button>
          </div>

          {!enabled && (
            <p className="text-xs text-muted-foreground">Enable shipping estimation above to run.</p>
          )}

          {lastResult && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground">Last Run Result</p>
              <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                <span>Estimated: <strong className="text-foreground">{lastResult.estimated}</strong></span>
                <span>Skipped: <strong>{lastResult.skipped}</strong></span>
                <span>Errors: <strong>{lastResult.errors}</strong></span>
                <span>No service: <strong>{lastResult.skipped_no_service || 0}</strong></span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Marketplace Averages */}
      {stats.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Marketplace Shipping Averages</CardTitle>
            <CardDescription className="text-xs">
              Rolling averages from order_shipping_estimates — PAC API estimates only
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-foreground">Marketplace</th>
                    <th className="text-right px-3 py-2 font-medium text-foreground">Avg (60 orders)</th>
                    <th className="text-right px-3 py-2 font-medium text-foreground">Avg (14 orders)</th>
                    <th className="text-right px-3 py-2 font-medium text-foreground">Sample</th>
                    <th className="text-right px-3 py-2 font-medium text-foreground">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, idx) => (
                    <tr key={s.marketplace_code} className={idx > 0 ? 'border-t border-border' : ''}>
                      <td className="px-3 py-2 font-medium text-foreground">{s.marketplace_code}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {s.avg_shipping_cost_60 !== null ? `$${s.avg_shipping_cost_60.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {s.avg_shipping_cost_14 !== null ? `$${s.avg_shipping_cost_14.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.sample_size}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {new Date(s.last_updated).toLocaleDateString('en-AU')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] h-4 border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20">
                PAC estimate
              </Badge>
              <span className="text-[10px] text-muted-foreground">Calculated from Australia Post PAC API — analytics only</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
