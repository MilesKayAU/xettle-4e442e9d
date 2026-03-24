/**
 * Kogan Inventory Tab — uses Kogan API credentials from app_settings.
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useEffect } from 'react';
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

export default function KoganInventoryTab({ connected, onNavigateToSettings }: { connected: boolean; onNavigateToSettings: () => void }) {
  const { data, loading, loadingMore, hasMore, partial, error, lastFetched, fetch, loadMore } = useInventoryFetch<KoganProduct>('fetch-kogan-inventory');

  useEffect(() => { if (connected) fetch(); }, [connected]);

  if (!connected) {
    return (
      <InventoryEmptyState
        platform="Kogan"
        message="Connect your Kogan API in Settings → API Connections to see your Kogan inventory here."
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
