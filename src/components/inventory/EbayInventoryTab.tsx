/**
 * eBay Inventory Tab — Trading API (GetMyeBaySelling).
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useEffect, useState } from 'react';
import { useInventoryFetch } from './useInventoryFetch';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import InventoryRefreshBar from './InventoryRefreshBar';
import InventoryEmptyState from './InventoryEmptyState';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';

interface EbayItem {
  item_id: string;
  sku: string;
  has_sku: boolean;
  title: string;
  quantity: number;
  price: number | null;
  listing_status: string;
  url: string | null;
  thumbnail: string | null;
  updated_at: string | null;
}

const columns: InventoryColumn[] = [
  {
    key: 'thumbnail',
    label: '',
    render: (val) =>
      val ? (
        <img src={val as string} alt="" className="w-10 h-10 rounded object-cover" />
      ) : (
        <div className="w-10 h-10 rounded bg-muted" />
      ),
  },
  {
    key: 'sku',
    label: 'SKU',
    sortable: true,
    render: (val, row: any) =>
      row.has_sku ? (
        <span className="font-mono text-sm">{val}</span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-sm text-muted-foreground">{row.item_id}</span>
          <Badge variant="outline" className="text-xs">No SKU</Badge>
        </span>
      ),
  },
  {
    key: 'title',
    label: 'Title',
    sortable: true,
    render: (val, row: any) =>
      row.url ? (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          {val}
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
      ) : (
        <span>{val}</span>
      ),
  },
  { key: 'quantity', label: 'Qty', sortable: true },
  {
    key: 'price',
    label: 'Price',
    sortable: true,
    render: (val) => (val != null ? `$${Number(val).toFixed(2)}` : '—'),
  },
  { key: 'listing_status', label: 'Status' },
];

export default function EbayInventoryTab({
  connected,
  onNavigateToSettings,
  initialData,
  lastFetched: initialLastFetched,
}: {
  connected: boolean;
  onNavigateToSettings: () => void;
  initialData?: any[];
  lastFetched?: Date | null;
}) {
  const { data, loading, loadingMore, hasMore, partial, error, lastFetched, fetch, loadMore, loadFromCache } =
    useInventoryFetch<EbayItem>('fetch-ebay-inventory');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!connected || seeded) return;
    if (initialData && initialData.length > 0) {
      loadFromCache({ items: initialData, has_more: false, partial: false, error: null, fetched_at: initialLastFetched?.toISOString() || new Date().toISOString() });
    } else {
      fetch();
    }
    setSeeded(true);
  }, [connected, seeded]);

  if (!connected) {
    return <InventoryEmptyState platform="eBay" onNavigateToSettings={onNavigateToSettings} />;
  }

  const displayData = data.length > 0 ? data : (initialData as EbayItem[] || []);
  const displayLastFetched = lastFetched || initialLastFetched || null;

  return (
    <div className="space-y-4">
      <InventoryRefreshBar lastFetched={displayLastFetched} loading={loading} partial={partial} error={error} onRefresh={fetch} />
      <InventoryTable
        columns={columns}
        data={displayData}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />
    </div>
  );
}
