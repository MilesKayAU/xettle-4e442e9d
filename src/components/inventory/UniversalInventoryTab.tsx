/**
 * Universal Inventory Tab — cross-channel SKU view with configurable rules.
 * Total Real Stock = sum(qty from physical_sources only).
 * Smart SKU matching: exact → normalised → title fallback (>20 chars).
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Info, PackageOpen, AlertTriangle, ShoppingBag, Tag } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import PriceVarianceTooltip from './PriceVarianceTooltip';
import type { InventoryRules } from '@/hooks/useInventoryRules';
import { DEFAULT_INVENTORY_RULES } from '@/hooks/useInventoryRules';

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
  inventoryRules?: InventoryRules;
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

/** Normalise SKU for fuzzy matching — applied to BOTH sides */
const normalise = (sku: string) => sku.toLowerCase().replace(/[-\s_]/g, '');

function StatusDot({ active }: { active: boolean | null }) {
  if (active === null) return <span className="h-2 w-2 rounded-full bg-muted-foreground/30 inline-block" title="Not listed" />;
  return active
    ? <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" title="Active" />
    : <span className="h-2 w-2 rounded-full bg-destructive inline-block" title="Inactive" />;
}

export default function UniversalInventoryTab({ platformData, loading, inventoryRules }: UniversalInventoryTabProps) {
  const rules = inventoryRules ?? DEFAULT_INVENTORY_RULES;

  const unified = useMemo(() => {
    const skuMap = new Map<string, UnifiedSku>();
    // Lookup indices for smart matching
    const normSkuIndex = new Map<string, string>(); // normalised sku → canonical sku key
    const titleIndex = new Map<string, string>();    // lowercase title → canonical sku key (only >20 chars)

    const makeEntry = (key: string, title: string): UnifiedSku => ({
      sku: key,
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

    /**
     * Smart resolve: find existing entry by (1) exact SKU, (2) normalised SKU, (3) title >20 chars.
     * Returns the canonical key or creates a new entry.
     */
    const resolve = (sku: string, title: string): UnifiedSku => {
      // 1. Exact SKU match
      if (sku && skuMap.has(sku)) return skuMap.get(sku)!;

      // 2. Normalised SKU match
      if (sku) {
        const norm = normalise(sku);
        if (norm && normSkuIndex.has(norm)) {
          const canonKey = normSkuIndex.get(norm)!;
          return skuMap.get(canonKey)!;
        }
      }

      // 3. Title fallback — only if title > 20 chars
      if (title && title.length > 20) {
        const lowerTitle = title.toLowerCase();
        if (titleIndex.has(lowerTitle)) {
          const canonKey = titleIndex.get(lowerTitle)!;
          return skuMap.get(canonKey)!;
        }
      }

      // 4. Create new entry
      const key = sku || `_title_${title}`;
      const entry = makeEntry(key, title);
      skuMap.set(key, entry);
      if (sku) {
        const norm = normalise(sku);
        if (norm) normSkuIndex.set(norm, key);
      }
      if (title && title.length > 20) {
        titleIndex.set(title.toLowerCase(), key);
      }
      return entry;
    };

    // Shopify
    for (const item of platformData.shopify) {
      if (!item.sku && !item.product_title && !item.title) continue;
      const u = resolve(item.sku || '', item.product_title || item.title || '');
      u.shopify_qty = (u.shopify_qty ?? 0) + (item.quantity ?? 0);
      u.prices.push({ platform: 'Shopify', price: item.price });
    }

    // Amazon
    for (const item of platformData.amazon) {
      if (!item.sku && !item.title) continue;
      const u = resolve(item.sku || '', item.title || '');
      if (item.fulfilment_type === 'FBA') {
        u.amazon_fba_qty = (u.amazon_fba_qty ?? 0) + (item.quantity ?? 0);
      } else {
        u.amazon_fbm_qty = (u.amazon_fbm_qty ?? 0) + (item.quantity ?? 0);
      }
      if (item.price) u.prices.push({ platform: `Amazon ${item.fulfilment_type}`, price: item.price });
    }

    // Kogan
    for (const item of platformData.kogan) {
      if (!item.sku && !item.title) continue;
      const u = resolve(item.sku || '', item.title || '');
      u.kogan_qty = (u.kogan_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: 'Kogan', price: item.price });
    }

    // eBay
    for (const item of platformData.ebay) {
      const itemSku = item.sku || item.item_id || '';
      if (!itemSku && !item.title) continue;
      const u = resolve(itemSku, item.title || '');
      u.ebay_qty = (u.ebay_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: 'eBay', price: item.price });
    }

    // Mirakl
    for (const item of platformData.mirakl) {
      if (!item.sku && !item.title) continue;
      const u = resolve(item.sku || '', item.title || '');
      u.bunnings_qty = (u.bunnings_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: item.marketplace_label || 'Bunnings', price: item.price });
    }

    // Calculate totals based on rules
    const physicalSet = new Set(rules.physical_sources);
    const isMirror = (platform: string) => platform in rules.mirror_platforms;

    for (const u of skuMap.values()) {
      let total = 0;
      if (physicalSet.has('shopify')) total += (u.shopify_qty ?? 0);
      if (physicalSet.has('amazon_fba')) total += (u.amazon_fba_qty ?? 0);
      if (physicalSet.has('amazon_fbm') && !rules.fbm_from_shopify) total += (u.amazon_fbm_qty ?? 0);
      if (physicalSet.has('kogan') && !isMirror('kogan')) total += (u.kogan_qty ?? 0);
      if (physicalSet.has('ebay') && !isMirror('ebay')) total += (u.ebay_qty ?? 0);
      if (physicalSet.has('mirakl') && !isMirror('mirakl')) total += (u.bunnings_qty ?? 0);

      u.total_real_stock = total;
      u._muted = total === 0;

      // Price variance
      const valid = u.prices.filter(p => p.price != null && p.price > 0);
      if (valid.length >= 2) {
        const min = Math.min(...valid.map(p => p.price!));
        const max = Math.max(...valid.map(p => p.price!));
        u.has_variance = min > 0 && ((max - min) / min) > 0.05;
      }
    }

    return Array.from(skuMap.values()).sort((a, b) => b.total_real_stock - a.total_real_stock);
  }, [platformData, rules]);

  const totalRealStock = unified.reduce((s, u) => s + u.total_real_stock, 0);
  const totalSkus = unified.length;
  const varianceCount = unified.filter(u => u.has_variance).length;
  const outOfStock = unified.filter(u => u.total_real_stock === 0).length;

  // Build tooltip describing what's included
  const sourceLabels = rules.physical_sources
    .filter(s => !(s === 'amazon_fbm' && rules.fbm_from_shopify))
    .map(s => {
      if (s === 'shopify') return 'Shopify';
      if (s === 'amazon_fba') return 'Amazon FBA';
      if (s === 'amazon_fbm') return 'Amazon FBM';
      if (s === 'kogan') return 'Kogan';
      if (s === 'ebay') return 'eBay';
      if (s === 'mirakl') return 'Bunnings/Mirakl';
      return s;
    });
  const stockTooltip = `Counts ${sourceLabels.join(' + ')} inventory only.${rules.fbm_from_shopify ? ' FBM excluded (same as Shopify warehouse).' : ''} Mirror platforms excluded from total.`;

  // Grey out mirror platform columns
  const mirrorKeys = new Set(Object.keys(rules.mirror_platforms));

  const columns: InventoryColumn[] = [
    { key: 'sku', label: 'SKU', sortable: true },
    { key: 'title', label: 'Product', sortable: true },
    {
      key: 'shopify_qty', label: 'Shopify', sortable: true,
      render: (val) => <span className="flex items-center gap-1"><StatusDot active={val != null ? val > 0 : null} /> {val ?? '—'}</span>,
    },
    {
      key: 'amazon_fba_qty', label: 'FBA', sortable: true,
      render: (val) => <span className="flex items-center gap-1"><StatusDot active={val != null ? val > 0 : null} /> {val ?? '—'}</span>,
    },
    {
      key: 'amazon_fbm_qty', label: 'FBM', sortable: true,
      render: (val) => (
        <span className={rules.fbm_from_shopify ? 'text-muted-foreground/50' : ''}>
          {val ?? '—'}
          {rules.fbm_from_shopify && val != null && <span className="text-[9px] ml-1">(mirror)</span>}
        </span>
      ),
    },
    {
      key: 'kogan_qty', label: 'Kogan', sortable: true,
      render: (val) => (
        <span className={mirrorKeys.has('kogan') ? 'text-muted-foreground/50' : ''}>
          {val ?? '—'}
          {mirrorKeys.has('kogan') && val != null && <span className="text-[9px] ml-1">(mirror)</span>}
        </span>
      ),
    },
    {
      key: 'ebay_qty', label: 'eBay', sortable: true,
      render: (val) => (
        <span className={mirrorKeys.has('ebay') ? 'text-muted-foreground/50' : ''}>
          {val ?? '—'}
          {mirrorKeys.has('ebay') && val != null && <span className="text-[9px] ml-1">(mirror)</span>}
        </span>
      ),
    },
    {
      key: 'bunnings_qty', label: 'Bunnings', sortable: true,
      render: (val) => (
        <span className={mirrorKeys.has('mirakl') ? 'text-muted-foreground/50' : ''}>
          {val ?? '—'}
          {mirrorKeys.has('mirakl') && val != null && <span className="text-[9px] ml-1">(mirror)</span>}
        </span>
      ),
    },
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
        <SummaryCard icon={<ShoppingBag className="h-4 w-4 text-primary" />} label="Total Real Stock" value={totalRealStock.toLocaleString()} tooltip={stockTooltip} />
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
