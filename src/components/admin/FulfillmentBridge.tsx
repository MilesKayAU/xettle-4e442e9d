import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RefreshCw, Trash2, Plus, ChevronDown, Play, FlaskConical, AlertTriangle, Search } from 'lucide-react';
import LoadingSpinner from '@/components/ui/loading-spinner';

const STORE_KEY = 'primary';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-300',
  creating: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  created: 'bg-blue-100 text-blue-800 border-blue-300',
  manual_review: 'bg-orange-100 text-orange-800 border-orange-300',
  failed: 'bg-red-100 text-red-800 border-red-300',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-300',
};

// ═══════════════════════════════════════════════════════════════
// Input Parsing Helpers (future-proof: marketplace/store_key ready)
// ═══════════════════════════════════════════════════════════════
interface AmazonParsed { sku?: string; asin?: string }

function parseAmazonInput(input: string): AmazonParsed {
  const trimmed = input.trim();
  if (!trimmed) return {};
  // URL with /dp/ASIN or /product/ASIN
  const dpMatch = trimmed.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dpMatch) return { asin: dpMatch[1].toUpperCase() };
  const prodMatch = trimmed.match(/\/product\/([A-Z0-9]{10})/i);
  if (prodMatch) return { asin: prodMatch[1].toUpperCase() };
  // Standalone 10-char alphanumeric → ASIN
  if (/^[A-Z0-9]{10}$/i.test(trimmed)) return { asin: trimmed.toUpperCase() };
  // Everything else → SKU
  return { sku: trimmed };
}

interface ShopifyParsed { variantId?: string; sku?: string; handle?: string }

function parseShopifyInput(input: string): ShopifyParsed {
  const trimmed = input.trim();
  if (!trimmed) return {};
  // URL with /variants/ID
  const variantMatch = trimmed.match(/\/variants\/(\d+)/);
  if (variantMatch) return { variantId: variantMatch[1] };
  // Pure numeric → variant id
  if (/^\d+$/.test(trimmed)) return { variantId: trimmed };
  // URL with /products/handle
  const handleMatch = trimmed.match(/\/products\/([a-z0-9\-]+)/i);
  if (handleMatch) return { handle: handleMatch[1] };
  // Everything else → SKU
  return { sku: trimmed };
}

// ═══════════════════════════════════════════════════════════════
// Tab 1: Product Links
// ═══════════════════════════════════════════════════════════════
function ProductLinksTab() {
  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Smart input fields
  const [amazonInput, setAmazonInput] = useState('');
  const [shopifyInput, setShopifyInput] = useState('');

  // Resolved fields (editable)
  const [amazonSku, setAmazonSku] = useState('');
  const [amazonAsin, setAmazonAsin] = useState('');
  const [shopifyVariantId, setShopifyVariantId] = useState('');
  const [shopifySku, setShopifySku] = useState('');
  const [enabled, setEnabled] = useState(true);

  const [adding, setAdding] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('product_links').select('*').order('created_at', { ascending: false });
    setLinks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const handleLoadDetails = async () => {
    setLoadingDetails(true);

    // Parse Amazon input → fill empty fields only
    if (amazonInput.trim()) {
      const parsed = parseAmazonInput(amazonInput);
      if (parsed.asin && !amazonAsin) setAmazonAsin(parsed.asin);
      if (parsed.sku && !amazonSku) setAmazonSku(parsed.sku);
    }

    // Parse Shopify input
    if (shopifyInput.trim()) {
      const parsed = parseShopifyInput(shopifyInput);
      if (parsed.variantId && !shopifyVariantId) setShopifyVariantId(parsed.variantId);
      if (parsed.sku && !shopifySku) setShopifySku(parsed.sku);

      // If handle detected, resolve via edge function (avoids CORS + token exposure)
      if (parsed.handle && !shopifyVariantId) {
        try {
          const { data, error } = await supabase.functions.invoke('resolve-shopify-handle', {
            body: { handle: parsed.handle },
          });

          if (error) {
            toast({ title: 'Handle lookup failed', description: error.message || 'Enter Variant ID manually.', variant: 'destructive' });
          } else if (data?.error) {
            toast({ title: 'Handle not resolved', description: data.error + '. Enter Variant ID manually.' });
          } else if (data?.variant_id) {
            if (!shopifyVariantId) setShopifyVariantId(data.variant_id);
            if (!shopifySku && data.sku) setShopifySku(data.sku);
            toast({ title: 'Shopify product loaded', description: `${data.title || 'Product'} — Variant ${data.variant_id}` });
          }
        } catch {
          toast({ title: 'Could not resolve handle', description: 'Enter Variant ID manually.', variant: 'destructive' });
        }
      }
    }

    setLoadingDetails(false);
  };

  const handleAdd = async () => {
    const hasAmazonId = amazonSku.trim() || amazonAsin.trim();
    const hasShopifyId = shopifyVariantId.trim();

    if (!hasAmazonId || !hasShopifyId) {
      toast({
        title: 'Missing required fields',
        description: 'Need: Amazon SKU or ASIN, and Shopify Variant ID',
        variant: 'destructive',
      });
      return;
    }

    setAdding(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('product_links').insert({
      user_id: user!.id,
      amazon_sku: amazonSku.trim() || amazonAsin.trim(),
      amazon_asin: amazonAsin.trim() || null,
      shopify_variant_id: parseInt(shopifyVariantId.trim()),
      shopify_sku: shopifySku.trim() || null,
    } as any);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Link added' });
      setAmazonInput(''); setShopifyInput('');
      setAmazonSku(''); setAmazonAsin(''); setShopifyVariantId(''); setShopifySku('');
      setEnabled(true);
      loadLinks();
    }
    setAdding(false);
  };

  const toggleEnabled = async (id: string, currentEnabled: boolean) => {
    await supabase.from('product_links').update({ enabled: !currentEnabled } as any).eq('id', id);
    loadLinks();
  };

  const deleteLink = async (id: string) => {
    await supabase.from('product_links').delete().eq('id', id);
    loadLinks();
  };

  return (
    <div className="space-y-4">
      {links.length === 0 && !loading && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">Add product mappings before enabling polling</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Product Link</CardTitle>
          <CardDescription>Paste a URL, SKU, ASIN, or Variant ID — or type values manually below</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Smart input row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Amazon (URL / SKU / ASIN)</Label>
              <Input
                placeholder="Paste URL, SKU, or ASIN"
                value={amazonInput}
                onChange={e => setAmazonInput(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Shopify (URL / Variant ID / SKU)</Label>
              <Input
                placeholder="Paste URL, Variant ID, SKU, or handle"
                value={shopifyInput}
                onChange={e => setShopifyInput(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={handleLoadDetails}
                disabled={loadingDetails || (!amazonInput.trim() && !shopifyInput.trim())}
                className="w-full"
              >
                <Search className="h-4 w-4 mr-1" />
                {loadingDetails ? 'Parsing...' : 'Load Details'}
              </Button>
            </div>
          </div>

          {/* Resolved fields */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2 border-t">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Amazon SKU</Label>
              <Input
                placeholder="SKU"
                value={amazonSku}
                onChange={e => setAmazonSku(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Amazon ASIN</Label>
              <Input
                placeholder="ASIN"
                value={amazonAsin}
                onChange={e => setAmazonAsin(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Shopify Variant ID *</Label>
              <Input
                placeholder="Variant ID (numeric)"
                value={shopifyVariantId}
                onChange={e => setShopifyVariantId(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Shopify SKU</Label>
              <Input
                placeholder="SKU"
                value={shopifySku}
                onChange={e => setShopifySku(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex items-center gap-1.5 pb-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label className="text-xs">Enabled</Label>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleAdd} disabled={adding}>
              <Plus className="h-4 w-4 mr-1" />
              Save Link
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Product Links</CardTitle>
            <Button variant="ghost" size="sm" onClick={loadLinks}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner size="sm" text="Loading..." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Amazon SKU</TableHead>
                  <TableHead>Amazon ASIN</TableHead>
                  <TableHead>Shopify Variant ID</TableHead>
                  <TableHead>Shopify SKU</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map(link => (
                  <TableRow key={link.id}>
                    <TableCell className="font-mono text-sm">{link.amazon_sku}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{link.amazon_asin || '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{link.shopify_variant_id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{link.shopify_sku || '—'}</TableCell>
                    <TableCell>
                      <Switch checked={link.enabled} onCheckedChange={() => toggleEnabled(link.id, link.enabled)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => deleteLink(link.id)} className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {links.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No product links yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab 2: Order Monitor
// ═══════════════════════════════════════════════════════════════
function OrderMonitorTab() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('amazon_fbm_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const runSync = async (dryRun: boolean) => {
    setSyncing(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.functions.invoke('sync-amazon-fbm-orders', {
      body: { user_id: user!.id, store_key: STORE_KEY, dry_run: dryRun },
    });
    if (error) {
      toast({ title: 'Sync failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: dryRun ? 'Dry run completed' : 'Sync completed', description: JSON.stringify(data) });
      loadOrders();
    }
    setSyncing(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button onClick={() => runSync(false)} disabled={syncing} size="sm">
          <Play className="h-4 w-4 mr-1" />
          Run Sync Now
        </Button>
        <Button onClick={() => runSync(true)} disabled={syncing} variant="outline" size="sm">
          <FlaskConical className="h-4 w-4 mr-1" />
          Dry Run
        </Button>
        <Button variant="ghost" size="sm" onClick={loadOrders}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <LoadingSpinner size="sm" text="Loading orders..." />
          ) : orders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No FBM orders yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>Amazon Order ID</TableHead>
                  <TableHead>Shopify Order ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(order => (
                  <Collapsible key={order.id} asChild open={expandedId === order.id} onOpenChange={open => setExpandedId(open ? order.id : null)}>
                    <>
                      <TableRow className="cursor-pointer">
                        <TableCell>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <ChevronDown className={`h-4 w-4 transition-transform ${expandedId === order.id ? 'rotate-180' : ''}`} />
                            </Button>
                          </CollapsibleTrigger>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{order.amazon_order_id}</TableCell>
                        <TableCell className="font-mono text-sm">{order.shopify_order_id || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_COLORS[order.status] || ''}>
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(order.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {order.error_detail || '—'}
                        </TableCell>
                      </TableRow>
                      <CollapsibleContent asChild>
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/50 p-4">
                            <div className="space-y-3">
                              {order.error_detail && (
                                <div>
                                  <Label className="text-xs font-semibold">Error Detail</Label>
                                  <pre className="text-xs bg-background rounded p-2 mt-1 whitespace-pre-wrap">{order.error_detail}</pre>
                                </div>
                              )}
                              {order.raw_amazon_payload && (
                                <div>
                                  <Label className="text-xs font-semibold">Amazon Payload</Label>
                                  <pre className="text-xs bg-background rounded p-2 mt-1 max-h-48 overflow-auto whitespace-pre-wrap">
                                    {JSON.stringify(order.raw_amazon_payload, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {order.raw_shopify_payload && (
                                <div>
                                  <Label className="text-xs font-semibold">Shopify Payload</Label>
                                  <pre className="text-xs bg-background rounded p-2 mt-1 max-h-48 overflow-auto whitespace-pre-wrap">
                                    {JSON.stringify(order.raw_shopify_payload, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab 3: Settings
// ═══════════════════════════════════════════════════════════════
function SettingsTab() {
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [alertEmail, setAlertEmail] = useState('');
  const [financialStatus, setFinancialStatus] = useState('paid');
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('app_settings')
      .select('key, value')
      .eq('user_id', user.id)
      .in('key', [
        `fbm:${STORE_KEY}:polling_enabled`,
        `fbm:${STORE_KEY}:alert_email`,
        `fbm:${STORE_KEY}:shopify_financial_status`,
        `fbm:${STORE_KEY}:last_poll_at`,
      ]);

    const settings = new Map((data || []).map((s: any) => [s.key, s.value]));
    setPollingEnabled(settings.get(`fbm:${STORE_KEY}:polling_enabled`) === 'true');
    setAlertEmail(settings.get(`fbm:${STORE_KEY}:alert_email`) || '');
    setFinancialStatus(settings.get(`fbm:${STORE_KEY}:shopify_financial_status`) || 'paid');
    setLastPollAt(settings.get(`fbm:${STORE_KEY}:last_poll_at`) || null);
    setLoading(false);
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const saveSetting = async (key: string, value: string) => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const fullKey = `fbm:${STORE_KEY}:${key}`;
    const { data: existing } = await supabase
      .from('app_settings')
      .select('id')
      .eq('user_id', user.id)
      .eq('key', fullKey)
      .maybeSingle();

    if (existing) {
      await supabase.from('app_settings').update({ value } as any).eq('id', existing.id);
    } else {
      await supabase.from('app_settings').insert({ user_id: user.id, key: fullKey, value } as any);
    }
    toast({ title: 'Setting saved' });
    setSaving(false);
  };

  if (loading) return <LoadingSpinner size="sm" text="Loading settings..." />;

  return (
    <div className="space-y-6">
      {!pollingEnabled && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">FBM polling is currently disabled</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">FBM Polling Settings</CardTitle>
          <CardDescription>Store: {STORE_KEY}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable FBM Polling</Label>
              <p className="text-xs text-muted-foreground">Poll Amazon for new MFN orders every hour</p>
            </div>
            <Switch
              checked={pollingEnabled}
              onCheckedChange={async (checked) => {
                setPollingEnabled(checked);
                await saveSetting('polling_enabled', checked ? 'true' : 'false');
              }}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label>Shopify Financial Status</Label>
            <Select
              value={financialStatus}
              onValueChange={async (value) => {
                setFinancialStatus(value);
                await saveSetting('shopify_financial_status', value);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Alert Email (optional)</Label>
            <div className="flex gap-2">
              <Input
                value={alertEmail}
                onChange={e => setAlertEmail(e.target.value)}
                placeholder="alerts@example.com"
                className="max-w-sm"
              />
              <Button variant="outline" size="sm" onClick={() => saveSetting('alert_email', alertEmail)} disabled={saving}>
                Save
              </Button>
            </div>
          </div>

          <div className="pt-2 border-t">
            <Label className="text-xs text-muted-foreground">Last Poll</Label>
            <p className="text-sm font-mono">
              {lastPollAt ? new Date(lastPollAt).toLocaleString() : 'Never'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tab 4: Event Log
// ═══════════════════════════════════════════════════════════════
function EventLogTab() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('system_events')
      .select('*')
      .like('event_type', 'fbm_%')
      .order('created_at', { ascending: false })
      .limit(100);
    setEvents(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={loadEvents}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <LoadingSpinner size="sm" text="Loading events..." />
          ) : events.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No FBM events yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map(evt => (
                  <TableRow key={evt.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(evt.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{evt.event_type}</TableCell>
                    <TableCell>
                      <Badge variant={evt.severity === 'error' ? 'destructive' : 'secondary'}>
                        {evt.severity || 'info'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[400px]">
                      <pre className="whitespace-pre-wrap">{evt.details ? JSON.stringify(evt.details, null, 2) : '—'}</pre>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export default function FulfillmentBridge() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Fulfillment Bridge</h2>
        <p className="text-sm text-muted-foreground">Amazon FBM → Shopify order sync (Store: {STORE_KEY})</p>
      </div>

      <Tabs defaultValue="links" className="space-y-4">
        <TabsList>
          <TabsTrigger value="links">Product Links</TabsTrigger>
          <TabsTrigger value="orders">Order Monitor</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="events">Event Log</TabsTrigger>
        </TabsList>

        <TabsContent value="links">
          <ProductLinksTab />
        </TabsContent>
        <TabsContent value="orders">
          <OrderMonitorTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
        <TabsContent value="events">
          <EventLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
