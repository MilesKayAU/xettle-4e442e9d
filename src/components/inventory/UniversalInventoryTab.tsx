/**
 * Universal Inventory Tab — cross-channel SKU view with configurable rules.
 * Total Real Stock = sum(qty from physical_sources only).
 * Smart SKU matching: exact → normalised → title fallback (>20 chars).
 * Clickable summary filters + linked product detection with similarity guard.
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useMemo, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Info, PackageOpen, AlertTriangle, ShoppingBag, Tag, Link2, Check } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import PriceVarianceTooltip from './PriceVarianceTooltip';
import type { InventoryRules, SkuLink } from '@/hooks/useInventoryRules';
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
  onSaveSkuLink?: (link: SkuLink) => void;
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
  match_sources: string[];
  match_method: 'exact' | 'normalised' | 'title' | 'manual' | null;
}

interface PossibleLink {
  skuA: string;
  skuB: string;
  titleA: string;
  titleB: string;
  similarity: number;
  platformA: string;
  platformB: string;
}

type ActiveFilter = null | 'out_of_stock' | 'variance';

/** Normalise SKU for fuzzy matching — applied to BOTH sides */
const normalise = (sku: string) => sku.toLowerCase().replace(/[-\s_]/g, '');

/** Character overlap similarity (0-1). Used for possible-link detection. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  let matches = 0;
  const used = new Set<number>();
  for (const c of shorter) {
    const idx = [...longer].findIndex((ch, i) => ch === c && !used.has(i));
    if (idx >= 0) { matches++; used.add(idx); }
  }
  return matches / longer.length;
}

const PLATFORM_SHORT: Record<string, string> = {
  shopify: 'S',
  amazon_fba: 'A',
  amazon_fbm: 'F',
  kogan: 'K',
  ebay: 'E',
  mirakl: 'B',
};

const PLATFORM_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  amazon_fba: 'Amazon FBA',
  amazon_fbm: 'Amazon FBM',
  kogan: 'Kogan',
  ebay: 'eBay',
  mirakl: 'Bunnings',
};

function StatusDot({ active }: { active: boolean | null }) {
  if (active === null) return <span className="h-2 w-2 rounded-full bg-muted-foreground/30 inline-block" title="Not listed" />;
  return active
    ? <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" title="Active" />
    : <span className="h-2 w-2 rounded-full bg-destructive inline-block" title="Inactive" />;
}

function LinkBadge({ sources, method }: { sources: string[]; method: string | null }) {
  if (sources.length < 2) return null;
  const chips = sources.map(s => PLATFORM_SHORT[s] || s.charAt(0).toUpperCase()).join(' + ');
  const methodLabel = method === 'exact' ? 'SKU match' : method === 'normalised' ? 'Normalised match' : method === 'title' ? 'Title match' : method === 'manual' ? 'Manual link' : '';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 cursor-help">
          <Link2 className="h-3 w-3" />
          {chips}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        Linked: {sources.map(s => PLATFORM_LABEL[s] || s).join(', ')}
        {methodLabel && <span className="block text-muted-foreground">Method: {methodLabel}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export default function UniversalInventoryTab({ platformData, loading, inventoryRules, onSaveSkuLink }: UniversalInventoryTabProps) {
  const rules = inventoryRules ?? DEFAULT_INVENTORY_RULES;
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null);
  const [confirmLink, setConfirmLink] = useState<PossibleLink | null>(null);

  const { unified, possibleLinks } = useMemo(() => {
    const skuMap = new Map<string, UnifiedSku>();
    const normSkuIndex = new Map<string, string>();
    const titleIndex = new Map<string, string>();

    // Pre-seed manual links
    const manualLinks = rules.sku_links ?? [];
    for (const link of manualLinks) {
      const canonNorm = normalise(link.canonical);
      if (canonNorm) {
        for (const linked of link.linked) {
          normSkuIndex.set(normalise(linked), `__manual__${canonNorm}`);
        }
        normSkuIndex.set(canonNorm, `__manual__${canonNorm}`);
      }
    }

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
      match_sources: [],
      match_method: null,
    });

    const resolve = (sku: string, title: string, platform: string): UnifiedSku => {
      // 1. Exact SKU match
      if (sku && skuMap.has(sku)) {
        const entry = skuMap.get(sku)!;
        if (!entry.match_sources.includes(platform)) entry.match_sources.push(platform);
        if (entry.match_method === null) entry.match_method = 'exact';
        return entry;
      }

      // 2. Normalised SKU match (includes manual links)
      if (sku) {
        const norm = normalise(sku);
        if (norm && normSkuIndex.has(norm)) {
          const canonKey = normSkuIndex.get(norm)!;
          const entry = skuMap.get(canonKey);
          if (entry) {
            if (!entry.match_sources.includes(platform)) entry.match_sources.push(platform);
            if (entry.match_method === null || entry.match_method === 'exact') {
              entry.match_method = canonKey.startsWith('__manual__') ? 'manual' : 'normalised';
            }
            return entry;
          }
        }
      }

      // 3. Title fallback — only if title > 20 chars
      if (title && title.length > 20) {
        const lowerTitle = title.toLowerCase();
        if (titleIndex.has(lowerTitle)) {
          const canonKey = titleIndex.get(lowerTitle)!;
          const entry = skuMap.get(canonKey);
          if (entry) {
            if (!entry.match_sources.includes(platform)) entry.match_sources.push(platform);
            if (entry.match_method === null || entry.match_method === 'exact') entry.match_method = 'title';
            return entry;
          }
        }
      }

      // 4. Create new entry
      const key = sku || `_title_${title}`;
      const entry = makeEntry(key, title);
      entry.match_sources = [platform];
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
      const u = resolve(item.sku || '', item.product_title || item.title || '', 'shopify');
      u.shopify_qty = (u.shopify_qty ?? 0) + (item.quantity ?? 0);
      u.prices.push({ platform: 'Shopify', price: item.price });
    }

    // Amazon
    for (const item of platformData.amazon) {
      if (!item.sku && !item.title) continue;
      const plat = item.fulfilment_type === 'FBA' ? 'amazon_fba' : 'amazon_fbm';
      const u = resolve(item.sku || '', item.title || '', plat);
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
      const u = resolve(item.sku || '', item.title || '', 'kogan');
      u.kogan_qty = (u.kogan_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: 'Kogan', price: item.price });
    }

    // eBay
    for (const item of platformData.ebay) {
      const itemSku = item.sku || item.item_id || '';
      if (!itemSku && !item.title) continue;
      const u = resolve(itemSku, item.title || '', 'ebay');
      u.ebay_qty = (u.ebay_qty ?? 0) + (item.quantity ?? 0);
      if (item.price) u.prices.push({ platform: 'eBay', price: item.price });
    }

    // Mirakl
    for (const item of platformData.mirakl) {
      if (!item.sku && !item.title) continue;
      const u = resolve(item.sku || '', item.title || '', 'mirakl');
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

    // Detect possible links: single-source entries that are similar to another single-source entry
    const singleSourceEntries = Array.from(skuMap.values()).filter(u => u.match_sources.length === 1 && u.sku && !u.sku.startsWith('_title_'));
    const candidates: PossibleLink[] = [];
    const confirmedNorms = new Set<string>();
    for (const link of manualLinks) {
      confirmedNorms.add(normalise(link.canonical));
      for (const l of link.linked) confirmedNorms.add(normalise(l));
    }

    for (let i = 0; i < singleSourceEntries.length && candidates.length < 5; i++) {
      const a = singleSourceEntries[i];
      const normA = normalise(a.sku);
      if (normA.length < 3 || confirmedNorms.has(normA)) continue;

      for (let j = i + 1; j < singleSourceEntries.length && candidates.length < 5; j++) {
        const b = singleSourceEntries[j];
        if (a.match_sources[0] === b.match_sources[0]) continue; // same platform, not interesting
        const normB = normalise(b.sku);
        if (normB.length < 3 || confirmedNorms.has(normB)) continue;
        if (normA === normB) continue; // already matched

        const sim = similarity(normA, normB);
        if (sim >= 0.7) {
          candidates.push({
            skuA: a.sku,
            skuB: b.sku,
            titleA: a.title,
            titleB: b.title,
            similarity: sim,
            platformA: a.match_sources[0],
            platformB: b.match_sources[0],
          });
        }
      }
    }

    candidates.sort((a, b) => b.similarity - a.similarity);

    return {
      unified: Array.from(skuMap.values()).sort((a, b) => b.total_real_stock - a.total_real_stock),
      possibleLinks: candidates.slice(0, 5),
    };
  }, [platformData, rules]);

  const totalRealStock = unified.reduce((s, u) => s + u.total_real_stock, 0);
  const totalSkus = unified.length;
  const varianceCount = unified.filter(u => u.has_variance).length;
  const outOfStock = unified.filter(u => u.total_real_stock === 0).length;

  // Apply active filter
  const filteredData = useMemo(() => {
    if (!activeFilter) return unified;
    if (activeFilter === 'out_of_stock') return unified.filter(u => u.total_real_stock === 0);
    if (activeFilter === 'variance') return unified.filter(u => u.has_variance);
    return unified;
  }, [unified, activeFilter]);

  const handleConfirmLink = useCallback(() => {
    if (!confirmLink || !onSaveSkuLink) return;
    onSaveSkuLink({ canonical: confirmLink.skuA, linked: [confirmLink.skuB] });
    setConfirmLink(null);
  }, [confirmLink, onSaveSkuLink]);

  // Build tooltip describing what's included
  const sourceLabels = rules.physical_sources
    .filter(s => !(s === 'amazon_fbm' && rules.fbm_from_shopify))
    .map(s => PLATFORM_LABEL[s] || s);
  const stockTooltip = `Counts ${sourceLabels.join(' + ')} inventory only.${rules.fbm_from_shopify ? ' FBM excluded (same as Shopify warehouse).' : ''} Mirror platforms excluded from total.`;

  const mirrorKeys = new Set(Object.keys(rules.mirror_platforms));

  const toggleFilter = (f: ActiveFilter) => setActiveFilter(prev => prev === f ? null : f);

  const columns: InventoryColumn[] = [
    { key: 'sku', label: 'SKU', sortable: true },
    {
      key: 'match_sources',
      label: 'Link',
      render: (_, row) => <LinkBadge sources={row.match_sources} method={row.match_method} />,
    },
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
      {/* Summary cards — Out of Stock and Variance are clickable filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={<ShoppingBag className="h-4 w-4 text-primary" />} label="Total Real Stock" value={totalRealStock.toLocaleString()} tooltip={stockTooltip} />
        <SummaryCard icon={<Tag className="h-4 w-4 text-primary" />} label="Total SKUs" value={totalSkus.toLocaleString()} />
        <SummaryCard
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          label="Price Variance Alerts"
          value={String(varianceCount)}
          onClick={() => toggleFilter('variance')}
          active={activeFilter === 'variance'}
        />
        <SummaryCard
          icon={<PackageOpen className="h-4 w-4 text-destructive" />}
          label="Out of Stock"
          value={String(outOfStock)}
          onClick={() => toggleFilter('out_of_stock')}
          active={activeFilter === 'out_of_stock'}
        />
      </div>

      {/* Possible link suggestions */}
      {possibleLinks.length > 0 && (
        <Card className="border-dashed border-primary/30">
          <CardContent className="pt-3 pb-3 px-4">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Link2 className="h-3.5 w-3.5" /> Possible product links detected
            </p>
            <div className="space-y-1.5">
              {possibleLinks.map((pl, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">{PLATFORM_LABEL[pl.platformA] || pl.platformA}</Badge>
                  <span className="font-mono text-muted-foreground">{pl.skuA}</span>
                  <span className="text-muted-foreground">↔</span>
                  <Badge variant="outline" className="text-[10px]">{PLATFORM_LABEL[pl.platformB] || pl.platformB}</Badge>
                  <span className="font-mono text-muted-foreground">{pl.skuB}</span>
                  <span className="text-muted-foreground/60 text-[10px]">({Math.round(pl.similarity * 100)}%)</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] px-2 text-primary"
                    onClick={() => setConfirmLink(pl)}
                  >
                    Link?
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeFilter && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Showing: {activeFilter === 'out_of_stock' ? 'Out of Stock' : 'Price Variance'} ({filteredData.length})
          </Badge>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setActiveFilter(null)}>
            Clear filter
          </Button>
        </div>
      )}

      <InventoryTable
        columns={columns}
        data={filteredData}
        loading={loading}
        searchPlaceholder="Search by SKU or product title..."
        emptyMessage="No inventory data loaded yet. Switch to a platform tab to fetch data."
      />

      {/* Confirm link dialog */}
      <Dialog open={!!confirmLink} onOpenChange={(open) => !open && setConfirmLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Confirm Product Link</DialogTitle>
          </DialogHeader>
          {confirmLink && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">Are these the same product across platforms?</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{PLATFORM_LABEL[confirmLink.platformA]}</Badge>
                  <span className="font-mono text-xs">{confirmLink.skuA}</span>
                </div>
                <p className="text-xs text-muted-foreground pl-1">{confirmLink.titleA}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{PLATFORM_LABEL[confirmLink.platformB]}</Badge>
                  <span className="font-mono text-xs">{confirmLink.skuB}</span>
                </div>
                <p className="text-xs text-muted-foreground pl-1">{confirmLink.titleB}</p>
              </div>
              <p className="text-xs text-muted-foreground">Similarity: {Math.round(confirmLink.similarity * 100)}%</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmLink(null)}>Cancel</Button>
            <Button size="sm" onClick={handleConfirmLink} className="gap-1">
              <Check className="h-3.5 w-3.5" /> Confirm Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ icon, label, value, tooltip, onClick, active }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Card
      className={`${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${active ? 'ring-2 ring-primary' : ''}`}
      onClick={onClick}
    >
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
