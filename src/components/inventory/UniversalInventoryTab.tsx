/**
 * Universal Inventory Tab — cross-channel SKU view.
 * Total Real Stock = Shopify Qty + Amazon FBA Qty only (prevents double-counting).
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Info, PackageOpen, AlertTriangle, ShoppingBag, Tag } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import PriceVarianceTooltip from './PriceVarianceTooltip';

interface PlatformData {
  shopify: any[];
  amazon: any[];
  kogan: any[];
  ebay: any[];
  mirakl: any[];
}

interface UniversalInventoryTabProps {
  platformData: PlatformData;
  loading: boolean;
}

interface UnifiedSku {
  sku: string;
  title: string;
  shopify_qty: number | null;
  amazon_fba_qty: number | null;
  amazon_fbm_qty: number | null;
  kogan_qty: number | null;
  ebay_qty: number | null;
  bunnings_qty: number | null;
  total_real_stock: number;
  prices: { platform: string; price: number | null }[];
  has_variance: boolean;
  _muted: boolean;
}

function StatusDot({ active }: { active: boolean | null }) {
  if (active === null) return <span className="h-2 w-2 rounded-full bg-muted-foreground/30 inline-block" title="Not listed" />;
  return active
    ? <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" title="Active" />
    : <span className="h-2 w-2 rounded-full bg-destructive inline-block" title="Inactive" />;
}

export default function UniversalInventoryTab({ platformData, loading }: UniversalInventoryTabProps) {
  const unified = useMemo(() => {
    const skuMap = new Map<string, UnifiedSku>();

    const getOrCreate = (sku: string, title: string): UnifiedSku => {
      if (!skuMap.has(sku)) {
        skuMap.set(sku, {
          sku,
          title,
          shopify_qty: null,
          amazon_fba_qty: null,
          amazon_fbm_qty: null,
          kogan_qty: null,
          ebay_qty: null,
          bunnings_qty: null,
          total_real_stock: 0,
          prices: [],
          has_variance: false,
          _muted: false,
        });
      }
      return skuMap.get(sku)!;
    };

    // Shopify
    for (const item of platformData.shopify) {
      if (!item.sku) continue;
      const u = getOrCreate(item.sku, item.product_title || item.title);
      u.shopify_qty = (u.shopify_qty ?? 0) + (item.quantity ?? 0);
      u.prices.push({ platform: 'Shopify', price: item.price });
    }

    // Amazon
    for (const item of platformData.amazon) {
      if (!item.sku) continue;
      const u = getOrCreate(item.sku, item.title);
      if (item.fulfilment_type === 'FBA') {
        u.amazon_fba_qty = (u.amazon_fba_qty ?? 0) + (item.quantity ?? 0);
      } else {
        u.amazon_fbm_qty = (u.amazon_fbm_qty ?? 0) + (item.quantity ?? 0);
      }
      if (item.price) u.prices.push({ platform: `Amazon ${item.fulfilment_type}`, price: item.price });
    }

    // Kogan
    for (const item of platformData.kogan) {
      if (!item.sku) continue;
      const u = getOrCreate(item.sku, item.title);
      u.kogan_qty = (u.kogan_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: 'Kogan', price: item.price });
    }

    // eBay
    for (const item of platformData.ebay) {
      if (!item.sku) continue;
      const u = getOrCreate(item.sku, item.title);
      u.ebay_qty = (u.ebay_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: 'eBay', price: item.price });
    }

    // Mirakl
    for (const item of platformData.mirakl) {
      if (!item.sku) continue;
      const u = getOrCreate(item.sku, item.title);
      u.bunnings_qty = (u.bunnings_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: item.marketplace_label || 'Bunnings', price: item.price });
    }

    // Calculate totals and variance
    for (const u of skuMap.values()) {
      // Total Real Stock = Shopify + Amazon FBA only
      u.total_real_stock = (u.shopify_qty ?? 0) + (u.amazon_fba_qty ?? 0);
      u._muted = u.total_real_stock === 0;

      // Price variance
      const valid = u.prices.filter(p => p.price != null && p.price > 0);
      if (valid.length >= 2) {
        const min = Math.min(...valid.map(p => p.price!));
        const max = Math.max(...valid.map(p => p.price!));
        u.has_variance = min > 0 && ((max - min) / min) > 0.05;
      }
    }

    return Array.from(skuMap.values()).sort((a, b) => b.total_real_stock - a.total_real_stock);
  }, [platformData]);

  const totalRealStock = unified.reduce((s, u) => s + u.total_real_stock, 0);
  const totalSkus = unified.length;
  const varianceCount = unified.filter(u => u.has_variance).length;
  const outOfStock = unified.filter(u => u.total_real_stock === 0).length;

  const columns: InventoryColumn[] = [
    { key: 'sku', label: 'SKU', sortable: true },
    { key: 'title', label: 'Product', sortable: true },
    {
      key: 'shopify_qty', label: 'Shopify', sortable: true,
      render: (val, row) => <span className="flex items-center gap-1"><StatusDot active={val != null ? val > 0 : null} /> {val ?? '—'}</span>,
    },
    {
      key: 'amazon_fba_qty', label: 'FBA', sortable: true,
      render: (val, row) => <span className="flex items-center gap-1"><StatusDot active={val != null ? val > 0 : null} /> {val ?? '—'}</span>,
    },
    {
      key: 'amazon_fbm_qty', label: 'FBM', sortable: true,
      render: (val) => val ?? '—',
    },
    { key: 'kogan_qty', label: 'Kogan', sortable: true, render: (val) => val ?? '—' },
    { key: 'ebay_qty', label: 'eBay', sortable: true, render: (val) => val ?? '—' },
    { key: 'bunnings_qty', label: 'Bunnings', sortable: true, render: (val) => val ?? '—' },
    { key: 'total_real_stock', label: 'Total Real Stock', sortable: true },
    {
      key: 'has_variance',
      label: '',
      render: (_, row) => row.has_variance ? <PriceVarianceTooltip prices={row.prices} /> : null,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={<ShoppingBag className="h-4 w-4 text-primary" />} label="Total Real Stock" value={totalRealStock.toLocaleString()} tooltip="Counts Shopify and Amazon FBA inventory only. Kogan, eBay and Bunnings are fed from Shopify so adding them would double count." />
        <SummaryCard icon={<Tag className="h-4 w-4 text-primary" />} label="Total SKUs" value={totalSkus.toLocaleString()} />
        <SummaryCard icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Price Variance Alerts" value={String(varianceCount)} />
        <SummaryCard icon={<PackageOpen className="h-4 w-4 text-destructive" />} label="Out of Stock" value={String(outOfStock)} />
      </div>

      <InventoryTable
        columns={columns}
        data={unified}
        loading={loading}
        searchPlaceholder="Search by SKU or product title..."
        emptyMessage="No inventory data loaded yet. Switch to a platform tab to fetch data."
      />
    </div>
  );
}

function SummaryCard({ icon, label, value, tooltip }: { icon: React.ReactNode; label: string; value: string; tooltip?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs text-muted-foreground">{label}</span>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
