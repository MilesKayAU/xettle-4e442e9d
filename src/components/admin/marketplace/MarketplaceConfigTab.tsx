import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Store, Save, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface Marketplace {
  id: string;
  marketplace_code: string;
  name: string;
  settlement_frequency: string;
  gst_model: string;
  payment_delay_days: number;
  currency: string;
  is_active: boolean;
}

interface AlertRow {
  id: string;
  user_id: string;
  marketplace_code: string;
  fee_type: string;
  expected_rate: number;
  observed_rate: number;
  deviation_pct: number;
  settlement_id: string;
  status: string;
  created_at: string;
}

export default function MarketplaceConfigTab() {
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [selected, setSelected] = useState<Marketplace | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [mpRes, alertRes] = await Promise.all([
        supabase.from('marketplaces').select('*').order('name'),
        supabase.from('marketplace_fee_alerts').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (mpRes.data) {
        setMarketplaces(mpRes.data as Marketplace[]);
        if (!selected && mpRes.data.length > 0) setSelected(mpRes.data[0] as Marketplace);
      }
      if (alertRes.data) setAlerts(alertRes.data as AlertRow[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('marketplaces')
        .update({
          settlement_frequency: selected.settlement_frequency,
          gst_model: selected.gst_model,
          payment_delay_days: selected.payment_delay_days,
          currency: selected.currency,
        })
        .eq('id', selected.id);
      if (error) throw error;
      toast({ title: 'Saved', description: `${selected.name} updated.` });
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Help Banner */}
      <Alert className="border-primary/20 bg-primary/5">
        <Info className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm">
          <strong>Marketplace Intelligence Configuration</strong>
          <p className="mt-2 text-muted-foreground">
            This page manages marketplace profiles that power Xettle's fee intelligence engine. 
            Edit settlement cycles, GST models, and payment delays to ensure accurate fee observations. 
            The system automatically learns from every uploaded settlement and flags anomalies when fees deviate by more than 15% from historical averages.
          </p>
          <p className="mt-2 text-muted-foreground">
            <strong>Fee Alerts</strong> shows cross-user anomaly detections — useful for spotting marketplace-wide rate changes.
          </p>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Marketplace list */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Marketplaces</h3>
        {marketplaces.map((mp) => (
          <Card
            key={mp.id}
            className={`cursor-pointer transition-colors ${selected?.id === mp.id ? 'border-primary bg-primary/5' : 'hover:border-primary/30'}`}
            onClick={() => setSelected(mp)}
          >
            <CardContent className="py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{mp.name}</span>
              </div>
              <Badge variant={mp.is_active ? 'default' : 'secondary'} className="text-[10px]">
                {mp.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Right: Edit + Alerts */}
      <div className="lg:col-span-2 space-y-6">
        {selected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{selected.name} Configuration</CardTitle>
              <CardDescription>Edit marketplace profile settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Settlement Frequency</Label>
                  <Select
                    value={selected.settlement_frequency}
                    onValueChange={(v) => setSelected({ ...selected, settlement_frequency: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="fortnightly">Fortnightly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">GST Model</Label>
                  <Select
                    value={selected.gst_model}
                    onValueChange={(v) => setSelected({ ...selected, gst_model: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seller">Seller Responsible</SelectItem>
                      <SelectItem value="marketplace">Marketplace Collects</SelectItem>
                      <SelectItem value="mixed">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Delay (days)</Label>
                  <Input
                    type="number"
                    value={selected.payment_delay_days}
                    onChange={(e) => setSelected({ ...selected, payment_delay_days: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Currency</Label>
                  <Input
                    value={selected.currency}
                    onChange={(e) => setSelected({ ...selected, currency: e.target.value.toUpperCase() })}
                    maxLength={3}
                  />
                </div>
              </div>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Fee Alerts (all users) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <CardTitle className="text-base">Fee Alerts (All Users)</CardTitle>
            </div>
            <CardDescription>Recent fee anomaly detections across all users</CardDescription>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No fee alerts yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Marketplace</TableHead>
                    <TableHead>Fee Type</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Observed</TableHead>
                    <TableHead>Deviation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.marketplace_code}</TableCell>
                      <TableCell className="text-xs capitalize">{a.fee_type.replace('_', ' ')}</TableCell>
                      <TableCell className="text-xs">{(a.expected_rate * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-xs">{(a.observed_rate * 100).toFixed(1)}%</TableCell>
                      <TableCell>
                        <Badge variant="destructive" className="text-[10px]">
                          {(a.deviation_pct * 100).toFixed(0)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'pending' ? 'secondary' : 'outline'} className="text-[10px]">
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
