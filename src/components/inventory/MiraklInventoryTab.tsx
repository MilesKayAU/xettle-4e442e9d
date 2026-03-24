/**
 * Mirakl (Bunnings / Baby Bunting / JB Hi-Fi etc.) Inventory Tab.
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useEffect } from 'react';
import { useInventoryFetch } from './useInventoryFetch';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import InventoryRefreshBar from './InventoryRefreshBar';
import InventoryEmptyState from './InventoryEmptyState';
import { Badge } from '@/components/ui/badge';

interface MiraklOffer {
  sku: string;
  title: string;
  quantity: number;
  price: number;
  offer_status: string;
  marketplace_label: string;
  updated_at?: string;
}

const columns: InventoryColumn[] = [
  { key: 'sku', label: 'SKU', sortable: true },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'quantity', label: 'Qty', sortable: true },
  {
    key: 'price',
    label: 'Price',
    sortable: true,
    render: (val) => val != null ? `$${Number(val).toFixed(2)}` : '—',
  },
  { key: 'offer_status', label: 'Status' },
  {
    key: 'marketplace_label',
    label: 'Marketplace',
    render: (val) => <Badge variant="outline" className="text-[10px]">{val}</Badge>,
  },
  { key: 'updated_at', label: 'Last Updated' },
];

export default function MiraklInventoryTab({ connected, onNavigateToSettings }: { connected: boolean; onNavigateToSettings: () => void }) {
  const { data, loading, loadingMore, hasMore, partial, error, lastFetched, fetch, loadMore } = useInventoryFetch<MiraklOffer>('fetch-mirakl-inventory');

  useEffect(() => { if (connected) fetch(); }, [connected]);

  if (!connected) {
    return (
      <InventoryEmptyState
        platform="Bunnings / Mirakl"
        onNavigateToSettings={onNavigateToSettings}
      />
    );
  }

  return (
    <div className="space-y-4">
      <InventoryRefreshBar lastFetched={lastFetched} loading={loading} partial={partial} error={error} onRefresh={fetch} />
      <InventoryTable
        columns={columns}
        data={data}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />
    </div>
  );
}
