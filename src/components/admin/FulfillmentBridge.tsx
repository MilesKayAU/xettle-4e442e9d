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
import { RefreshCw, Trash2, Plus, ChevronDown, Play, FlaskConical, AlertTriangle, Search, ShieldAlert, CheckCircle2, XCircle, Clock, Webhook, RotateCcw, Download, FileText, Camera, Upload, User, MapPin, Loader2, ExternalLink, Package, Pencil, Check, X, Link2, ClipboardPaste } from 'lucide-react';
import { AMAZON_REGIONS, DEFAULT_AMAZON_REGION } from '@/constants/amazon-regions';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/ui/loading-spinner';

const STORE_KEY = 'primary';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-300',
  pending_payment: 'bg-amber-50 text-amber-700 border-amber-200',
  creating: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  created: 'bg-blue-100 text-blue-800 border-blue-300',
  tracking_sent: 'bg-green-100 text-green-800 border-green-300',
  dry_run: 'bg-purple-100 text-purple-800 border-purple-300',
  duplicate_detected: 'bg-violet-100 text-violet-800 border-violet-300',
  manual_review: 'bg-orange-100 text-orange-800 border-orange-300',
  blocked_missing_pii: 'bg-red-100 text-red-700 border-red-300',
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
function ProductLinksTab({ defaultMode = 'fbm' }: { defaultMode?: string }) {
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
  const [fulfilmentMode, setFulfilmentMode] = useState(defaultMode);

  const [adding, setAdding] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    setFulfilmentMode(defaultMode === 'fba' ? 'fba' : 'fbm');
  }, [defaultMode]);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    const modeFilter = defaultMode === 'fba' ? 'fba' : 'fbm';
    const { data } = await supabase.from('product_links').select('*').eq('fulfilment_mode', modeFilter).order('created_at', { ascending: false });
    setLinks(data || []);
    setLoading(false);
  }, [defaultMode]);

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
      fulfilment_mode: fulfilmentMode,
    } as any);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Link added' });
      setAmazonInput(''); setShopifyInput('');
      setAmazonSku(''); setAmazonAsin(''); setShopifyVariantId(''); setShopifySku(''); setFulfilmentMode(defaultMode);
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
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 pt-2 border-t">
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
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Mode</Label>
              <Select value={fulfilmentMode} onValueChange={setFulfilmentMode}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fbm">FBM</SelectItem>
                  <SelectItem value="fba">FBA / MCF</SelectItem>
                </SelectContent>
              </Select>
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
                  <TableHead>Mode</TableHead>
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
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          link.fulfilment_mode === 'fba'
                            ? 'bg-purple-100 text-purple-800 border-purple-300'
                            : 'bg-sky-100 text-sky-800 border-sky-300'
                        }
                      >
                        {link.fulfilment_mode === 'fba' ? 'FBA' : 'FBM'}
                      </Badge>
                    </TableCell>
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
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No product links yet</TableCell>
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
// PII Access Diagnostic Card
// ═══════════════════════════════════════════════════════════════
function PiiAccessCard({ payload }: { payload: any }) {
  const piiAccess = payload.pii_access;
  const missingRequired: string[] = payload.missing_required_fields || [];
  const missingWarnings: string[] = payload.missing_warning_fields || [];
  const addr = payload.ShippingAddress || {};

  const hasBlocking = missingRequired.length > 0;

  const fieldLabels: Record<string, string> = {
    recipient_name: 'Recipient Name',
    address_line_1: 'Street Address',
    city: 'City',
    postal_code: 'Postal Code',
    country_code: 'Country',
    buyer_name: 'Buyer Name',
    buyer_email: 'Buyer Email',
    phone: 'Phone',
  };

  return (
    <div className={`rounded-md border p-3 space-y-3 ${hasBlocking ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-muted/30'}`}>
      <div className="flex items-center gap-2">
        <ShieldAlert className={`h-4 w-4 ${hasBlocking ? 'text-destructive' : 'text-muted-foreground'}`} />
        <span className="text-sm font-semibold">Amazon Protected Data Access</span>
      </div>

      {/* Access status */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          {piiAccess.buyer_info?.granted
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            : <XCircle className="h-3.5 w-3.5 text-destructive" />}
          <span>Buyer Info: {piiAccess.buyer_info?.granted ? 'Granted' : 'Denied'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {piiAccess.shipping_address?.granted
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            : <XCircle className="h-3.5 w-3.5 text-destructive" />}
          <span>Shipping Address: {piiAccess.shipping_address?.granted ? 'Granted' : 'Denied'}</span>
        </div>
      </div>

      {/* Recovered fields */}
      {(addr.City || addr.StateOrRegion || addr.PostalCode || addr.CountryCode) && (
        <div className="text-xs">
          <span className="font-medium text-muted-foreground">Recovered (non-PII):</span>
          <span className="ml-1">
            {[addr.City, addr.StateOrRegion, addr.PostalCode, addr.CountryCode].filter(Boolean).join(', ')}
          </span>
        </div>
      )}

      {/* Missing required fields */}
      {missingRequired.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-destructive">Missing (blocks Shopify sync):</span>
          <div className="flex flex-wrap gap-1">
            {missingRequired.map(f => (
              <Badge key={f} variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                {fieldLabels[f] || f}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Missing warning fields */}
      {missingWarnings.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-amber-700">Missing (optional):</span>
          <div className="flex flex-wrap gap-1">
            {missingWarnings.map(f => (
              <Badge key={f} variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                {fieldLabels[f] || f}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Permission guidance */}
      {hasBlocking && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Amazon has not returned enough protected customer data for safe Shopify fulfilment.
          Live sync is blocked until the app has <strong>Direct-to-Consumer Shipping</strong> and/or <strong>Tax Invoicing</strong> role approval in Seller Central.
          After enabling the role, re-authorise the app to generate a new refresh token.
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Screenshot Customer Extraction Modal
// ═══════════════════════════════════════════════════════════════
function ScreenshotExtractModal({ order, open, onOpenChange, onPatched, buildSellerCentralUrl }: {
  order: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatched: () => void;
  buildSellerCentralUrl: (orderId: string) => string;
}) {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<Record<string, string | null> | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [patching, setPatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resize image to max 800px wide and compress as JPEG 0.5 quality to keep payload small
  const compressImage = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 800;
        const scale = img.width > MAX_W ? MAX_W / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.5);
        // Strip data URL prefix — edge function re-adds it
        const rawBase64 = compressed.split(',')[1];
        resolve(rawBase64);
      };
      img.src = dataUrl;
    });
  };

  const processImageFile = async (file: File) => {
    setError(null);
    setExtractedData(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const compressed = await compressImage(dataUrl);
      setImagePreview(`data:image/jpeg;base64,${compressed}`);
      setImageBase64(compressed);
      const sizeKb = Math.round((compressed.length * 3) / 4 / 1024);
      console.log(`[ScreenshotExtract] compressed size: ${sizeKb} KB`);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImageFile(file);
  };

  // Global paste listener so Ctrl+V works as soon as dialog is open
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) processImageFile(file);
          return;
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  const handleExtract = async () => {
    if (!imageBase64) return;
    setExtracting(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('extract-order-customer', {
        body: { image_base64: imageBase64, action: 'extract' },
      });
      if (fnErr) {
        const detail = typeof fnErr === 'object' && fnErr.message ? fnErr.message : String(fnErr);
        throw new Error(`Request failed: ${detail}. Check that the screenshot is under 1 MB.`);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.data) throw new Error('No extraction data returned — the AI may not have recognised the screenshot.');
      setExtractedData(data.data);
    } catch (err: any) {
      setError(err.message || 'Unknown extraction error');
    }
    setExtracting(false);
  };

  const handleSave = async () => {
    if (!extractedData) return;
    setPatching(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('extract-order-customer', {
        body: { image_base64: imageBase64, fbm_order_id: order.id, action: 'save' },
      });
      if (fnErr) {
        const detail = typeof fnErr === 'object' && fnErr.message ? fnErr.message : String(fnErr);
        throw new Error(`Request failed: ${detail}`);
      }
      if (data?.status === 'saved') {
        toast({ title: 'Customer data saved!', description: `${extractedData.customer_name} saved to order. Use "Push to Shopify" to update the Shopify order.` });
        onOpenChange(false);
        onPatched();
      } else if (data?.status === 'extraction_incomplete') {
        setError(data.error || 'Could not extract enough data from the screenshot.');
        if (data.data) setExtractedData(data.data);
      } else if (data?.status === 'save_failed') {
        setError(data.error || 'Failed to save customer data.');
        if (data.data) setExtractedData(data.data);
      } else if (data?.error) {
        throw new Error(data.error);
      } else {
        throw new Error(`Unexpected: ${JSON.stringify(data)}`);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setPatching(false);
  };

  const reset = () => {
    setImagePreview(null);
    setImageBase64(null);
    setExtractedData(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Extract Customer from Screenshot
          </DialogTitle>
          <DialogDescription>
            Upload a screenshot of the Amazon order detail page. AI will extract customer name, address, and contact info. Use "Push to Shopify" afterwards to update the order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Order context with smart link */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/50 border">
            <div className="text-sm">
              <span className="text-muted-foreground">Amazon:</span>{' '}
              <span className="font-mono font-medium">{order.amazon_order_id}</span>
              {order.shopify_order_id && (
                <>
                  <span className="text-muted-foreground ml-3">Shopify:</span>{' '}
                  <span className="font-mono font-medium">#{order.shopify_order_id}</span>
                </>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => window.open(buildSellerCentralUrl(order.amazon_order_id), '_blank')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Seller Central
            </Button>
          </div>

          {/* Upload area */}
          {!imagePreview ? (
            <div className="space-y-3">
              <div
                className="flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 transition-colors"
              >
                <ClipboardPaste className="h-10 w-10 text-primary/60" />
                <div className="text-center">
                  <p className="font-medium">Press Ctrl+V to paste screenshot</p>
                  <p className="text-sm text-muted-foreground mt-1">Screenshot your Amazon order detail page and paste it here</p>
                </div>
              </div>
              <div className="flex justify-center">
                <label className="text-xs text-muted-foreground hover:text-foreground cursor-pointer underline underline-offset-2">
                  Or click to upload a file
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <img src={imagePreview} alt="Order screenshot" className="w-full rounded-md border max-h-64 object-contain bg-muted" />
                <Button variant="ghost" size="sm" className="absolute top-2 right-2 bg-background/80" onClick={reset}>
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>

              {!extractedData && (
                <Button onClick={handleExtract} disabled={extracting} className="w-full">
                  {extracting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extracting customer data…</>
                  ) : (
                    <><Search className="h-4 w-4 mr-2" /> Extract Customer Details</>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Extracted data preview */}
          {extractedData && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Extracted Customer Data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <span className="ml-2 font-medium">{extractedData.customer_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>
                    <span className="ml-2">{extractedData.email || '—'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Address:</span>
                    <span className="ml-2">
                      {[extractedData.address1, extractedData.address2].filter(Boolean).join(', ')}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">City:</span>
                    <span className="ml-2">{extractedData.city || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">State:</span>
                    <span className="ml-2">{extractedData.province || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Postcode:</span>
                    <span className="ml-2">{extractedData.zip || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Country:</span>
                    <span className="ml-2">{extractedData.country_code || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="ml-2">{extractedData.phone || '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Amazon ID:</span>
                    <span className="ml-2 font-mono text-xs">{extractedData.amazon_order_id || '—'}</span>
                  </div>
                </div>

                {extractedData.amazon_order_id && extractedData.amazon_order_id !== order.amazon_order_id && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Wrong screenshot — order ID mismatch</p>
                      <p className="text-xs mt-1">
                        Screenshot shows <strong className="font-mono">{extractedData.amazon_order_id}</strong> but this row is <strong className="font-mono">{order.amazon_order_id}</strong>.
                        Please upload the correct order screenshot.
                      </p>
                    </div>
                  </div>
                )}
                {!extractedData.amazon_order_id && (
                  <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Could not detect an Amazon Order ID in the screenshot. Verify this is the correct order before patching.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {extractedData && (
            <Button
              onClick={handleSave}
              disabled={
                patching ||
                (!!extractedData.amazon_order_id && extractedData.amazon_order_id !== order.amazon_order_id)
              }
            >
              {patching ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              ) : (
                <><Download className="h-4 w-4 mr-2" /> Save Customer Data</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [screenshotOrder, setScreenshotOrder] = useState<any | null>(null);
  const [sellerCentralDomain, setSellerCentralDomain] = useState(DEFAULT_AMAZON_REGION.sellerCentralDomain);

  // Smart URL template learning
  const URL_TEMPLATE_KEY = 'amazon_seller_central_url_template';
  const [savedUrlTemplate, setSavedUrlTemplate] = useState<string | null>(null);
  const [editingUrlOrderId, setEditingUrlOrderId] = useState<string | null>(null);
  const [editUrlValue, setEditUrlValue] = useState('');
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Build URL from template or default
  const buildSellerCentralUrl = useCallback((amazonOrderId: string) => {
    if (savedUrlTemplate) {
      return savedUrlTemplate.replace('{orderId}', amazonOrderId);
    }
    return `https://${sellerCentralDomain}/orders-v3/order/${amazonOrderId}`;
  }, [savedUrlTemplate, sellerCentralDomain]);

  // Extract template from a pasted URL by finding the order ID within it
  const extractTemplate = (url: string, amazonOrderId: string): string | null => {
    if (!url.includes(amazonOrderId)) return null;
    return url.replace(amazonOrderId, '{orderId}');
  };

  // Handle URL edit submission
  const handleUrlEditSubmit = (amazonOrderId: string) => {
    const url = editUrlValue.trim();
    if (!url) { setEditingUrlOrderId(null); return; }

    // Try to extract a reusable template
    const template = extractTemplate(url, amazonOrderId);
    if (template && template !== `https://${sellerCentralDomain}/orders-v3/order/{orderId}`) {
      setPendingTemplate(template);
    }
    // Open the URL immediately regardless
    window.open(url, '_blank', 'noopener,noreferrer');
    setEditingUrlOrderId(null);
  };

  // Save template to app_settings
  const saveUrlTemplate = async (template: string) => {
    setSavingTemplate(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upsert the template
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('user_id', user.id)
        .eq('key', URL_TEMPLATE_KEY)
        .maybeSingle();

      if (existing) {
        await supabase.from('app_settings').update({ value: template }).eq('id', existing.id);
      } else {
        await supabase.from('app_settings').insert({ user_id: user.id, key: URL_TEMPLATE_KEY, value: template });
      }

      setSavedUrlTemplate(template);
      setPendingTemplate(null);
      toast({ title: 'URL pattern saved', description: 'All order links will now use this format.' });
    } catch (err: any) {
      toast({ title: 'Failed to save URL pattern', description: err.message, variant: 'destructive' });
    }
    setSavingTemplate(false);
  };

  // Reset template back to auto-detected default
  const resetUrlTemplate = async () => {
    setSavingTemplate(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('app_settings').delete().eq('user_id', user.id).eq('key', URL_TEMPLATE_KEY);
      setSavedUrlTemplate(null);
      toast({ title: 'URL pattern reset', description: 'Links will use the default region-based format.' });
    } catch (err: any) {
      toast({ title: 'Failed to reset', description: err.message, variant: 'destructive' });
    }
    setSavingTemplate(false);
  };

  // Load saved URL template and Seller Central domain on mount
  useEffect(() => {
    (async () => {
      const [tokenRes, settingsRes] = await Promise.all([
        supabase.from('amazon_tokens').select('marketplace_id').limit(1).maybeSingle(),
        supabase.from('app_settings').select('value').eq('key', URL_TEMPLATE_KEY).maybeSingle(),
      ]);

      if (tokenRes.data?.marketplace_id) {
        const region = AMAZON_REGIONS.find(r => r.marketplaceId === tokenRes.data!.marketplace_id);
        if (region) setSellerCentralDomain(region.sellerCentralDomain);
      }

      if (settingsRes.data?.value) {
        setSavedUrlTemplate(settingsRes.data.value);
      }
    })();
  }, []);

  const retryTracking = async (order: any) => {
    setRetryingId(order.id);
    try {
      const { data, error } = await supabase.functions.invoke('shopify-fbm-fulfillment-webhook', {
        body: { manual_retry: true, fbm_order_id: order.id },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Retry failed', description: data.error, variant: 'destructive' });
      } else if (data?.status === 'tracking_sent') {
        toast({ title: 'Tracking sent to Amazon!', description: `Tracking: ${data.tracking_number} (${data.carrier})` });
        loadOrders();
      } else if (data?.status === 'already_sent') {
        toast({ title: 'Already sent', description: 'Tracking was already pushed to Amazon.' });
        loadOrders();
      } else {
        toast({ title: 'Unexpected response', description: JSON.stringify(data) });
      }
    } catch (err: any) {
      toast({ title: 'Retry failed', description: err.message, variant: 'destructive' });
    }
    setRetryingId(null);
  };

  const pushToShopify = async (order: any) => {
    setPushingId(order.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('sync-amazon-fbm-orders', {
        body: { action: 'push_single', fbm_order_id: order.id, user_id: user!.id, store_key: STORE_KEY },
      });
      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Push failed', description: data.error, variant: 'destructive' });
      } else if (data?.status === 'updated') {
        toast({ title: 'Shopify order updated!', description: `Customer ${data.customer_name} pushed to Shopify #${data.shopify_order_id}` });
        loadOrders();
      } else {
        toast({ title: 'Unexpected response', description: JSON.stringify(data) });
      }
    } catch (err: any) {
      toast({ title: 'Push failed', description: err.message, variant: 'destructive' });
    }
    setPushingId(null);
  };

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

  const [confirmLive, setConfirmLive] = useState(false);

  const runSync = async (dryRun: boolean, forceRefetch = false) => {
    setSyncing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('sync-amazon-fbm-orders', {
        body: { user_id: user!.id, store_key: STORE_KEY, dry_run: dryRun, force_refetch: forceRefetch },
      });
      if (error) {
        toast({ title: 'Sync failed', description: error.message, variant: 'destructive' });
      } else if (data?.status === 'skipped') {
        toast({ title: 'Sync skipped', description: `Reason: ${data.reason ?? 'unknown'}. Check Settings tab.`, variant: 'destructive' });
      } else {
        const desc = data?.orders_found != null
          ? `Orders found: ${data.orders_found}, matched: ${data.matched ?? 0}, unmatched: ${data.unmatched ?? 0}`
          : data?.orders_found === 0 || data?.status === 'no_orders'
            ? 'No unshipped FBM orders found in the polling window'
            : JSON.stringify(data);
        toast({ title: dryRun ? 'Dry run completed' : 'Live sync completed', description: desc });
        loadOrders();
      }
    } catch (err: any) {
      toast({ title: 'Sync failed', description: err?.message || 'Unexpected error', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {confirmLive ? (
          <div className="flex items-center gap-2 p-2 rounded-md border border-amber-300 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm text-amber-800">This will create orders in Shopify. Continue?</span>
            <Button size="sm" variant="destructive" onClick={() => { setConfirmLive(false); runSync(false, true); }} disabled={syncing}>
              Yes, Live Sync
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmLive(false)}>Cancel</Button>
          </div>
        ) : (
          <Button onClick={() => setConfirmLive(true)} disabled={syncing} size="sm">
            {syncing ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Live Sync Now
          </Button>
        )}
        <Button onClick={() => runSync(true)} disabled={syncing} variant="outline" size="sm">
          {syncing ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-1" />}
          {syncing ? 'Syncing…' : 'Dry Run'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            setSyncing(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const { data, error } = await supabase.functions.invoke('sync-amazon-fbm-orders', {
                body: { user_id: user!.id, store_key: STORE_KEY, action: 'retry_all_failed' },
              });
              if (error) {
                toast({ title: 'Retry failed', description: error.message, variant: 'destructive' });
              } else {
                toast({ title: 'Failed orders reset', description: `${data?.count || 0} order(s) queued for retry` });
                loadOrders();
              }
            } catch (err: any) {
              toast({ title: 'Retry failed', description: err?.message || 'Unexpected error', variant: 'destructive' });
            } finally {
              setSyncing(false);
            }
          }}
          disabled={syncing || orders.filter(o => o.status === 'failed' || o.status === 'manual_review').length === 0}
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          Retry All Failed
        </Button>
        <Button variant="ghost" size="sm" onClick={loadOrders}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              const { data, error } = await supabase.functions.invoke('shopify-auth', {
                body: { action: 'register_webhooks' },
              });
              if (error) throw error;
              toast({
                title: data?.created ? 'Webhook registered' : 'Webhook already active',
                description: data?.created
                  ? 'Shopify will now notify us when you fulfill an order.'
                  : 'The fulfillment webhook is already registered.',
              });
            } catch (err: any) {
              toast({ title: 'Webhook registration failed', description: err.message, variant: 'destructive' });
            }
          }}
        >
          <Webhook className="h-4 w-4 mr-1" />
          Register Webhook
        </Button>
      </div>

      {syncing && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-primary/30 bg-primary/5">
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-foreground">Polling Amazon for unshipped MFN orders… This typically takes 30–60 seconds depending on order count.</span>
        </div>
      )}

      {/* Custom URL pattern indicator */}
      {savedUrlTemplate && (
        <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/50 text-sm">
          <Link2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-muted-foreground">Custom URL pattern active</span>
          <code className="text-xs font-mono bg-background px-1.5 py-0.5 rounded border truncate max-w-[400px]">{savedUrlTemplate}</code>
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={resetUrlTemplate} disabled={savingTemplate}>
            Reset to default
          </Button>
        </div>
      )}

      {/* Pending template prompt */}
      {pendingTemplate && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-primary/30 bg-primary/5">
          <Link2 className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium">Apply this URL format to all orders?</span>
            <code className="block text-xs font-mono text-muted-foreground mt-0.5 truncate">{pendingTemplate}</code>
          </div>
          <Button size="sm" onClick={() => saveUrlTemplate(pendingTemplate)} disabled={savingTemplate} className="h-7">
            {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingTemplate(null)} className="h-7">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

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
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(order => (
                  <Collapsible key={order.id} asChild open={expandedId === order.id} onOpenChange={open => setExpandedId(open ? order.id : null)}>
                    <>
                      <TableRow className="cursor-pointer">
                        <TableCell className="w-8 p-1">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <ChevronDown className={`h-4 w-4 transition-transform ${expandedId === order.id ? 'rotate-180' : ''}`} />
                            </Button>
                          </CollapsibleTrigger>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {editingUrlOrderId === order.id ? (
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <Input
                                  value={editUrlValue}
                                  onChange={e => setEditUrlValue(e.target.value)}
                                  placeholder="Paste Seller Central URL"
                                  className="h-7 text-xs w-[220px]"
                                  autoFocus
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleUrlEditSubmit(order.amazon_order_id);
                                    if (e.key === 'Escape') setEditingUrlOrderId(null);
                                  }}
                                />
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUrlEditSubmit(order.amazon_order_id)}>
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingUrlOrderId(null)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm">{order.amazon_order_id}</span>
                                <a
                                  href={buildSellerCentralUrl(order.amazon_order_id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  title="Open in Seller Central"
                                  className="text-primary hover:text-primary/80"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setEditUrlValue(buildSellerCentralUrl(order.amazon_order_id));
                                    setEditingUrlOrderId(order.id);
                                  }}
                                  title="Edit URL"
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            {/* Product info inline */}
                            {(() => {
                              const ap = order.raw_amazon_payload;
                              const items = ap?.orderItems || ap?.OrderItems || [];
                              const matched = ap?.matched_skus;
                              if (items.length > 0) {
                                const first = items[0];
                                const sku = first.SellerSKU || first.seller_sku;
                                return (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    {sku && <span className="font-mono">{sku}</span>}
                                    {items.length > 1 && <Badge variant="outline" className="text-[10px] py-0">+{items.length - 1}</Badge>}
                                  </div>
                                );
                              }
                              if (matched && Object.keys(matched).length > 0) {
                                return <span className="font-mono text-xs text-muted-foreground">{Object.keys(matched)[0]}</span>;
                              }
                              return null;
                            })()}
                            {/* Shopify ID inline */}
                            {order.shopify_order_id && (
                              <span className="text-xs text-muted-foreground">Shopify #{order.shopify_order_id}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {(() => {
                            const sp = order.raw_shopify_payload;
                            const shipping = sp?.order?.shipping_address || sp?.shipping_address;
                            if (shipping?.first_name || shipping?.last_name) {
                              const name = [shipping.first_name, shipping.last_name].filter(Boolean).join(' ');
                              const isPlaceholder = name.toLowerCase().includes('amazon fbm') || name.toLowerCase().includes('placeholder');
                              if (isPlaceholder) {
                                return (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground italic text-xs">Placeholder</span>
                                    <Badge variant="outline" className="text-[10px] py-0 border-amber-300 text-amber-700 bg-amber-50">
                                      <Camera className="h-2.5 w-2.5 mr-0.5" />
                                      Screenshot
                                    </Badge>
                                  </div>
                                );
                              }
                              return <span className="font-medium">{name}</span>;
                            }
                            const ap = order.raw_amazon_payload;
                            const buyerName = ap?.BuyerInfo?.BuyerName || ap?.buyerName;
                            if (buyerName) return <span className="text-muted-foreground">{buyerName}</span>;
                            return <span className="text-muted-foreground">—</span>;
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline" className={`text-xs ${STATUS_COLORS[order.status] || ''}`}>
                              {order.status}
                            </Badge>
                            {order.retry_count > 0 && order.status !== 'tracking_sent' && (
                              <span className="text-[10px] text-muted-foreground block">retry {order.retry_count}/3</span>
                            )}
                            {order.shipping_service_level && (
                              <span className="text-[10px] text-muted-foreground block">{order.shipping_service_level}</span>
                            )}
                            {order.error_detail && (
                              <span className="text-[10px] text-destructive block truncate max-w-[120px]" title={order.error_detail}>
                                {order.error_detail}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(order.created_at).toLocaleDateString()}<br />
                          {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="text-right">
                          {order.shopify_order_id && order.status !== 'tracking_sent' && (
                            <div className="flex flex-col gap-1 items-end">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7"
                                onClick={(e) => { e.stopPropagation(); setScreenshotOrder(order); }}
                                title="Extract customer from screenshot"
                              >
                                <Camera className="h-3 w-3 mr-1" />
                                Customer
                              </Button>
                              {/* Push to Shopify — visible when screenshot PII has been saved */}
                              {order.raw_amazon_payload?._screenshot_extraction && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="text-xs h-7"
                                  onClick={(e) => { e.stopPropagation(); pushToShopify(order); }}
                                  disabled={pushingId === order.id}
                                  title="Update Shopify order with saved customer data"
                                >
                                  {pushingId === order.id
                                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    : <Upload className="h-3 w-3 mr-1" />}
                                  Push to Shopify
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7"
                                onClick={(e) => { e.stopPropagation(); retryTracking(order); }}
                                disabled={retryingId === order.id}
                              >
                                {retryingId === order.id
                                  ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                  : <RotateCcw className="h-3 w-3 mr-1" />}
                                Tracking
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                      <CollapsibleContent asChild>
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/50 p-4">
                            <div className="space-y-3">
                              {/* Duplicate Detection Info */}
                              {order.status === 'pending_payment' && (
                                <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                                  <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                                  <div className="text-sm">
                                    <p className="font-medium">Awaiting Amazon payment verification</p>
                                    <p className="text-xs mt-1 text-amber-600">
                                      This order is still in Pending status on Amazon. Shipping details will become available once payment clears — the next sync will automatically pick it up.
                                    </p>
                                  </div>
                                </div>
                              )}
                              {order.status === 'duplicate_detected' && (
                                <div className="flex items-start gap-2 p-3 rounded-md bg-violet-50 border border-violet-200 text-violet-800">
                                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                  <div className="text-sm">
                                    <p className="font-medium">Duplicate Shopify order detected</p>
                                    <p className="text-xs mt-1 text-violet-600">
                                      A Shopify order for this Amazon order already exists — likely created by another app (CedCommerce, etc.). Review before proceeding.
                                      {order.shopify_order_id && <span className="block mt-1 font-mono">Shopify ID: {order.shopify_order_id}</span>}
                                    </p>
                                  </div>
                                </div>
                              )}
                              {order.status === 'tracking_sent' && (
                                <div className="flex items-start gap-2 p-3 rounded-md bg-green-50 border border-green-200 text-green-800">
                                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                                  <div className="text-sm">
                                    <p className="font-medium">Tracking sent to Amazon</p>
                                    <p className="text-xs mt-1 text-green-600">
                                      Fulfillment tracking has been pushed back to Amazon via confirmShipment. The order is now complete.
                                    </p>
                                  </div>
                                </div>
                              )}
                              {/* PII Access Diagnostic Card */}
                              {order.raw_amazon_payload?.pii_access && (
                                <PiiAccessCard payload={order.raw_amazon_payload} />
                              )}
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

      {screenshotOrder && (
        <ScreenshotExtractModal
          order={screenshotOrder}
          open={!!screenshotOrder}
          onOpenChange={(v) => { if (!v) setScreenshotOrder(null); }}
          onPatched={loadOrders}
          buildSellerCentralUrl={buildSellerCentralUrl}
        />
      )}
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
  const [dedupCheckEnabled, setDedupCheckEnabled] = useState(true);
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
        `fbm:${STORE_KEY}:dedup_check_enabled`,
      ]);

    const settings = new Map((data || []).map((s: any) => [s.key, s.value]));
    setPollingEnabled(settings.get(`fbm:${STORE_KEY}:polling_enabled`) === 'true');
    setAlertEmail(settings.get(`fbm:${STORE_KEY}:alert_email`) || '');
    setFinancialStatus(settings.get(`fbm:${STORE_KEY}:shopify_financial_status`) || 'paid');
    setDedupCheckEnabled(settings.get(`fbm:${STORE_KEY}:dedup_check_enabled`) !== 'false'); // default ON
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

          <div className="flex items-center justify-between">
            <div>
              <Label>Check for existing Shopify orders</Label>
              <p className="text-xs text-muted-foreground">Search Shopify for duplicate orders created by other apps (CedCommerce, etc.) before creating new ones</p>
            </div>
            <Switch
              checked={dedupCheckEnabled}
              onCheckedChange={async (checked) => {
                setDedupCheckEnabled(checked);
                await saveSetting('dedup_check_enabled', checked ? 'true' : 'false');
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
// Tab 5: API Audit Log
// ═══════════════════════════════════════════════════════════════
function ApiAuditTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [integrationFilter, setIntegrationFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('api_call_log' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (integrationFilter !== 'all') {
      query = query.eq('integration', integrationFilter);
    }
    if (statusFilter === 'errors') {
      query = query.or('status_code.gte.400,status_code.eq.0');
    } else if (statusFilter === 'success') {
      query = query.gte('status_code', 200).lt('status_code', 400);
    }

    const { data } = await query;
    setLogs(data || []);
    setLoading(false);
  }, [integrationFilter, statusFilter]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const exportCsv = () => {
    if (logs.length === 0) return;
    const headers = ['timestamp', 'integration', 'method', 'endpoint', 'status_code', 'latency_ms', 'rate_limit_remaining', 'error_summary', 'request_context'];
    const rows = logs.map((log: any) => [
      log.created_at,
      log.integration,
      log.method,
      log.endpoint,
      log.status_code,
      log.latency_ms,
      log.rate_limit_remaining ?? '',
      (log.error_summary || '').replace(/"/g, '""'),
      JSON.stringify(log.request_context || {}).replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...rows.map((r: any[]) => r.map((v: any) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (code: number) => {
    if (code === 0) return 'bg-gray-100 text-gray-800 border-gray-300';
    if (code < 300) return 'bg-green-100 text-green-800 border-green-300';
    if (code < 400) return 'bg-blue-100 text-blue-800 border-blue-300';
    if (code === 429) return 'bg-amber-100 text-amber-800 border-amber-300';
    if (code < 500) return 'bg-orange-100 text-orange-800 border-orange-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={integrationFilter} onValueChange={setIntegrationFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Integration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Integrations</SelectItem>
            <SelectItem value="amazon_sp_api">Amazon SP-API</SelectItem>
            <SelectItem value="amazon_lwa">Amazon LWA</SelectItem>
            <SelectItem value="shopify">Shopify</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="errors">Errors</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={logs.length === 0}>
          <Download className="h-4 w-4 mr-1" />
          Export CSV
        </Button>
        <Button variant="ghost" size="sm" onClick={loadLogs}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <LoadingSpinner size="sm" text="Loading audit log..." />
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No API calls logged yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Integration</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Rate Limit</TableHead>
                  <TableHead>Context</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log: any) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {log.integration}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.method}</TableCell>
                    <TableCell className="font-mono text-xs max-w-[250px] truncate" title={log.endpoint}>
                      {log.endpoint}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${getStatusColor(log.status_code)}`}>
                        {log.status_code || 'ERR'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.latency_ms != null ? `${log.latency_ms}ms` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.rate_limit_remaining != null ? log.rate_limit_remaining : '—'}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px]">
                      {log.error_summary ? (
                        <span className="text-destructive" title={log.error_summary}>{log.error_summary.substring(0, 60)}…</span>
                      ) : log.request_context && Object.keys(log.request_context).length > 0 ? (
                        <span className="text-muted-foreground" title={JSON.stringify(log.request_context)}>
                          {Object.entries(log.request_context).map(([k, v]) => `${k}:${String(v)}`).join(', ').substring(0, 60)}
                        </span>
                      ) : '—'}
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
// Tab: MCF Orders (Multi-Channel Fulfillment)
// ═══════════════════════════════════════════════════════════════

const MCF_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-300',
  submitted: 'bg-blue-100 text-blue-800 border-blue-300',
  processing: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  shipped: 'bg-green-100 text-green-800 border-green-300',
  delivered: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  cancelled: 'bg-gray-100 text-gray-800 border-gray-300',
  failed: 'bg-red-100 text-red-800 border-red-300',
};

function McfOrdersTab() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [polling, setPolling] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any>(null);

  // New order form
  const [orderInput, setOrderInput] = useState('');
  const [fetchingOrder, setFetchingOrder] = useState(false);
  const [orderDetails, setOrderDetails] = useState<any>(null);
  const [shippingSpeed, setShippingSpeed] = useState('Standard');
  const [submitting, setSubmitting] = useState(false);
  const [skuMappings, setSkuMappings] = useState<any[]>([]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('mcf_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Parse Shopify order URL/ID
  const parseOrderInput = (input: string): string | null => {
    const trimmed = input.trim();
    // URL: /orders/12345 or /orders/12345.json
    const urlMatch = trimmed.match(/\/orders\/(\d+)/);
    if (urlMatch) return urlMatch[1];
    // Pure number
    if (/^\d+$/.test(trimmed)) return trimmed;
    // Order name like #1042
    if (/^#?\d+$/.test(trimmed)) return trimmed.replace('#', '');
    return null;
  };

  const handleFetchOrder = async () => {
    const orderId = parseOrderInput(orderInput);
    if (!orderId) {
      toast({ title: 'Invalid input', description: 'Enter a Shopify order URL, ID, or order number', variant: 'destructive' });
      return;
    }

    setFetchingOrder(true);
    setOrderDetails(null);
    setSkuMappings([]);

    try {
      // Fetch order from Shopify via edge function
      const { data, error } = await supabase.functions.invoke('fetch-shopify-orders', {
        body: { order_id: orderId },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const order = data?.order || data;
      if (!order) throw new Error('Order not found');

      setOrderDetails(order);

      // Load product links for SKU mapping
      const { data: links } = await supabase
        .from('product_links')
        .select('*')
        .eq('enabled', true);

      // Map line items to Amazon SKUs
      const mappings = (order.line_items || []).map((item: any) => {
        const match = (links || []).find((link: any) =>
          link.shopify_variant_id === item.variant_id ||
          (link.shopify_sku && link.shopify_sku === item.sku)
        );
        return {
          shopify_title: item.title || item.name,
          shopify_sku: item.sku || '—',
          shopify_variant_id: item.variant_id,
          quantity: item.quantity || 1,
          amazon_sku: match?.amazon_sku || '',
          amazon_asin: match?.amazon_asin || '',
          mapped: !!match,
        };
      });
      setSkuMappings(mappings);

      toast({ title: 'Order loaded', description: `${order.name || `#${orderId}`} — ${mappings.length} item(s)` });
    } catch (err: any) {
      toast({ title: 'Failed to fetch order', description: err.message, variant: 'destructive' });
    }
    setFetchingOrder(false);
  };

  const handleSubmitMcf = async () => {
    if (!orderDetails) return;

    const unmapped = skuMappings.filter(m => !m.amazon_sku);
    if (unmapped.length > 0) {
      toast({ title: 'Unmapped SKUs', description: `${unmapped.length} item(s) have no Amazon SKU mapping. Add them in Product Links first.`, variant: 'destructive' });
      return;
    }

    const addr = orderDetails.shipping_address;
    if (!addr) {
      toast({ title: 'No shipping address', description: 'Order has no shipping address', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-mcf-order', {
        body: {
          shopify_order_id: orderDetails.id,
          shopify_order_name: orderDetails.name,
          items: skuMappings.map(m => ({
            amazon_sku: m.amazon_sku,
            quantity: m.quantity,
          })),
          destination_address: {
            name: `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || addr.name || 'Customer',
            address1: addr.address1,
            address2: addr.address2 || '',
            city: addr.city,
            province: addr.province || addr.province_code || '',
            zip: addr.zip,
            country_code: addr.country_code || 'AU',
            phone: addr.phone || '',
          },
          shipping_speed: shippingSpeed,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) {
        toast({ title: 'MCF submission failed', description: data.detail || data.error, variant: 'destructive' });
      } else {
        toast({ title: 'MCF order submitted', description: `Order sent to Amazon FBA — ${data.seller_fulfillment_order_id}` });
        setShowNewOrder(false);
        setOrderInput('');
        setOrderDetails(null);
        setSkuMappings([]);
        loadOrders();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSubmitting(false);
  };

  const handlePollStatus = async () => {
    setPolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('poll-mcf-status', {
        body: {},
      });
      if (error) throw new Error(error.message);
      toast({ title: 'Status refreshed', description: `${data?.updated || 0} order(s) checked` });
      loadOrders();
    } catch (err: any) {
      toast({ title: 'Poll failed', description: err.message, variant: 'destructive' });
    }
    setPolling(false);
  };

  const handleCancelOrder = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-mcf-order', {
        body: { mcf_order_id: orderId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) {
        toast({ title: 'Cancel failed', description: data.detail || data.error, variant: 'destructive' });
      } else {
        toast({ title: 'Order cancelled', description: data.note || 'MCF order has been cancelled' });
        loadOrders();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setCancellingId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-md bg-blue-50 border border-blue-200 text-blue-800">
        <Package className="h-4 w-4" />
        <span className="text-sm">Multi-Channel Fulfillment — Send Shopify orders to Amazon FBA for pick, pack & ship</span>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowNewOrder(true)}>
            <Plus className="h-4 w-4 mr-1" /> New MCF Order
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setScanning(true);
              setScanResults(null);
              try {
                const { data, error } = await supabase.functions.invoke('auto-scan-mcf-eligible', {
                  body: { dry_run: true },
                });
                if (error) throw new Error(error.message || 'Edge Function returned a non-2xx status code');
                if (data?.message && !data?.eligible?.length) {
                  toast({ title: 'No eligible orders', description: data.message });
                  setScanResults(data);
                  setScanning(false);
                  return;
                }
                setScanResults(data);
                toast({
                  title: 'Scan complete',
                  description: `Scanned ${data?.scanned || 0} orders — ${data?.eligible_count || 0} eligible for MCF`,
                });
              } catch (err: any) {
                toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
              }
              setScanning(false);
            }}
            disabled={scanning}
          >
            <Search className={`h-4 w-4 mr-1 ${scanning ? 'animate-pulse' : ''}`} />
            {scanning ? 'Scanning…' : 'Auto-Scan Orders'}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePollStatus} disabled={polling}>
            <RefreshCw className={`h-4 w-4 mr-1 ${polling ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={loadOrders}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Auto-scan results */}
      {scanResults && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                Auto-Scan Results: {scanResults.scanned} orders scanned, {scanResults.eligible_count} eligible
              </div>
              <Button variant="ghost" size="sm" onClick={() => setScanResults(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {scanResults.eligible_count > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shopify Order</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(scanResults.eligible || []).map((order: any) => (
                      <TableRow key={order.order_id}>
                        <TableCell className="font-medium text-sm">{order.order_name || `#${order.order_id}`}</TableCell>
                        <TableCell className="text-sm">
                          {order.line_items?.map((li: any) => `${li.amazon_sku} ×${li.quantity}`).join(', ')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex gap-2 justify-end">
                  <Button
                    size="sm"
                    onClick={async () => {
                      setScanning(true);
                      try {
                        const { data, error } = await supabase.functions.invoke('auto-scan-mcf-eligible', {
                          body: { dry_run: false },
                        });
                        if (error) throw new Error(error.message);
                        toast({
                          title: 'MCF orders submitted',
                          description: `${data?.submitted_count || 0} order(s) sent to Amazon FBA. ${data?.errors?.length ? `${data.errors.length} error(s).` : ''}`,
                        });
                        setScanResults(null);
                        loadOrders();
                      } catch (err: any) {
                        toast({ title: 'Submit failed', description: err.message, variant: 'destructive' });
                      }
                      setScanning(false);
                    }}
                    disabled={scanning}
                  >
                    <Package className="h-4 w-4 mr-1" />
                    {scanning ? 'Submitting…' : `Submit ${scanResults.eligible_count} to Amazon MCF`}
                  </Button>
                </div>
              </>
            )}

            {scanResults.eligible_count === 0 && (
              <div className="text-sm text-muted-foreground">
                No unfulfilled Shopify orders match your product links.
                {scanResults.skipped_count > 0 && (
                  <span> ({scanResults.skipped_count} skipped: {(scanResults.skipped || []).map((s: any) => s.reason).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(', ')})</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* New Order Dialog */}
      <Dialog open={showNewOrder} onOpenChange={setShowNewOrder}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit MCF Order</DialogTitle>
            <DialogDescription>Enter a Shopify order to fulfill via Amazon FBA</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Order input */}
            <div className="flex gap-2">
              <Input
                placeholder="Shopify order URL, ID, or #number"
                value={orderInput}
                onChange={e => setOrderInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFetchOrder()}
              />
              <Button variant="outline" onClick={handleFetchOrder} disabled={fetchingOrder || !orderInput.trim()}>
                {fetchingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {/* Order details */}
            {orderDetails && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{orderDetails.name || `Order #${orderDetails.id}`}</span>
                    <Badge variant="outline">{orderDetails.financial_status || 'unknown'}</Badge>
                  </div>
                  {orderDetails.shipping_address && (
                    <div className="text-xs text-muted-foreground flex items-start gap-1">
                      <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>
                        {[
                          orderDetails.shipping_address.name || `${orderDetails.shipping_address.first_name || ''} ${orderDetails.shipping_address.last_name || ''}`.trim(),
                          orderDetails.shipping_address.city,
                          orderDetails.shipping_address.province_code,
                          orderDetails.shipping_address.zip,
                        ].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                {/* SKU mappings */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Item Mapping</Label>
                  {skuMappings.map((item, idx) => (
                    <div key={idx} className={`flex items-center justify-between p-2 rounded text-xs border ${item.mapped ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="flex-1">
                        <span className="font-medium">{item.shopify_title}</span>
                        <span className="text-muted-foreground ml-1">×{item.quantity}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.mapped ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                            <span className="font-mono">{item.amazon_sku}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                            <span className="text-red-600">No mapping</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Shipping speed */}
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Shipping Speed</Label>
                  <Select value={shippingSpeed} onValueChange={setShippingSpeed}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Standard">Standard</SelectItem>
                      <SelectItem value="Expedited">Expedited</SelectItem>
                      <SelectItem value="Priority">Priority</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewOrder(false)}>Cancel</Button>
            <Button
              onClick={handleSubmitMcf}
              disabled={submitting || !orderDetails || skuMappings.some(m => !m.mapped)}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Package className="h-4 w-4 mr-1" />}
              Submit to Amazon FBA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Orders table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">MCF Orders</CardTitle>
          <CardDescription>Orders fulfilled via Amazon Multi-Channel Fulfillment</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingSpinner size="sm" text="Loading..." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shopify Order</TableHead>
                  <TableHead>Amazon Ref</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Shopify</TableHead>
                  <TableHead>Speed</TableHead>
                   <TableHead>Tracking</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(order => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <div>
                        <span className="font-medium text-sm">{order.shopify_order_name || `#${order.shopify_order_id}`}</span>
                        <div className="text-xs text-muted-foreground">{order.shopify_order_id}</div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {order.seller_fulfillment_order_id
                        ? order.seller_fulfillment_order_id.replace('XETTLE-', '').slice(0, 20)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={MCF_STATUS_COLORS[order.status] || ''}>
                        {order.status}
                      </Badge>
                      {order.error_detail && (
                        <div className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={order.error_detail}>
                          {order.error_detail}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {order.status === 'shipped' || order.status === 'delivered' ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Fulfilled
                        </Badge>
                      ) : order.status === 'cancelled' ? (
                        <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200 text-xs">
                          Cancelled
                        </Badge>
                      ) : order.status === 'submitted' || order.status === 'processing' ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                          <Clock className="h-3 w-3 mr-1" /> Pending
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{order.shipping_speed || '—'}</TableCell>
                    <TableCell>
                      {order.tracking_number ? (
                        <div className="text-xs">
                          <div className="font-mono">{order.tracking_number}</div>
                          {order.carrier && <div className="text-muted-foreground">{order.carrier}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>
                      {['pending', 'submitted', 'processing'].includes(order.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={cancellingId === order.id}
                          onClick={() => handleCancelOrder(order.id)}
                        >
                          {cancellingId === order.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                          )}
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No MCF orders yet — click "New MCF Order" to get started
                    </TableCell>
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

export default function FulfillmentBridge() {
  const [connectingInternal, setConnectingInternal] = useState(false);

  const handleConnectInternal = async () => {
    setConnectingInternal(true);
    try {
      const { data, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'internal_initiate' },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err: any) {
      toast({ title: 'Failed to start internal OAuth', description: err.message, variant: 'destructive' });
      setConnectingInternal(false);
    }
  };

  const [mode, setMode] = useState<'fbm' | 'fba'>('fbm');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Fulfillment Bridge</h2>
          <p className="text-sm text-muted-foreground">Amazon ↔ Shopify fulfillment (Store: {STORE_KEY})</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleConnectInternal}
          disabled={connectingInternal}
        >
          {connectingInternal ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
          Connect XettleInternal
        </Button>
      </div>

      {/* ── Mode Switcher ── */}
      <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        <button
          onClick={() => setMode('fbm')}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'fbm'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Download className="h-4 w-4" />
          <span>FBM</span>
          <span className="text-xs text-muted-foreground font-normal hidden sm:inline">Amazon → Shopify</span>
        </button>
        <button
          onClick={() => setMode('fba')}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'fba'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package className="h-4 w-4" />
          <span>MCF / FBA</span>
          <span className="text-xs text-muted-foreground font-normal hidden sm:inline">Shopify → Amazon</span>
        </button>
      </div>

      {mode === 'fbm' ? (
        <Tabs defaultValue="links" className="space-y-4">
          <TabsList>
            <TabsTrigger value="links">Product Links</TabsTrigger>
            <TabsTrigger value="orders">Order Monitor</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="events">Event Log</TabsTrigger>
            <TabsTrigger value="audit">
              <FileText className="h-3.5 w-3.5 mr-1" />
              API Audit
            </TabsTrigger>
          </TabsList>

          <TabsContent value="links"><ProductLinksTab defaultMode="fbm" /></TabsContent>
          <TabsContent value="orders"><OrderMonitorTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
          <TabsContent value="events"><EventLogTab /></TabsContent>
          <TabsContent value="audit"><ApiAuditTab /></TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue="links" className="space-y-4">
          <TabsList>
            <TabsTrigger value="links">Product Links</TabsTrigger>
            <TabsTrigger value="mcf">MCF Orders</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="events">Event Log</TabsTrigger>
            <TabsTrigger value="audit">
              <FileText className="h-3.5 w-3.5 mr-1" />
              API Audit
            </TabsTrigger>
          </TabsList>

          <TabsContent value="links"><ProductLinksTab defaultMode="fba" /></TabsContent>
          <TabsContent value="mcf"><McfOrdersTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
          <TabsContent value="events"><EventLogTab /></TabsContent>
          <TabsContent value="audit"><ApiAuditTab /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
