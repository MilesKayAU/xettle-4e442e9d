/**
 * Kogan Inventory Tab — uses Kogan API credentials from app_settings.
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useEffect, useState } from 'react';
import { useInventoryFetch } from './useInventoryFetch';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import InventoryRefreshBar from './InventoryRefreshBar';
import InventoryEmptyState from './InventoryEmptyState';

interface KoganProduct {
  sku: string;
  title: string;
  quantity: number;
  price: number;
  status: string;
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
  { key: 'status', label: 'Status' },
  { key: 'updated_at', label: 'Last Updated' },
];

export default function KoganInventoryTab({ connected, onNavigateToSettings, initialData, lastFetched: initialLastFetched }: { connected: boolean; onNavigateToSettings: () => void; initialData?: any[]; lastFetched?: Date | null }) {
  const { data, loading, loadingMore, hasMore, partial, error, lastFetched, fetch, loadMore, loadFromCache } = useInventoryFetch<KoganProduct>('fetch-kogan-inventory');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!connected || seeded) return;
    if (initialData && initialData.length > 0) {
      loadFromCache({ items: initialData, has_more: false, partial: false, error: null, fetched_at: initialLastFetched?.toISOString() || new Date().toISOString() });
    }
    setSeeded(true);
  }, [connected, seeded]);

  if (!connected) {
    return (
      <InventoryEmptyState
        platform="Kogan"
        message="Connect your Kogan API in Settings → API Connections to see your Kogan inventory here."
        onNavigateToSettings={onNavigateToSettings}
      />
    );
  }

  const displayData = data.length > 0 ? data : (initialData as KoganProduct[] || []);
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
