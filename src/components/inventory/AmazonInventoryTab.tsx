/**
 * Amazon Inventory Tab — FBA / FBM sub-tabs.
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useEffect, useState } from 'react';
import { useInventoryFetch } from './useInventoryFetch';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import InventoryRefreshBar from './InventoryRefreshBar';
import InventoryEmptyState from './InventoryEmptyState';
import { Badge } from '@/components/ui/badge';

interface AmazonItem {
  sku: string;
  asin?: string;
  title: string;
  quantity: number;
  price?: number;
  fulfilment_type: 'FBA' | 'FBM';
  status: string;
}

const columns: InventoryColumn[] = [
  { key: 'sku', label: 'SKU', sortable: true },
  { key: 'asin', label: 'ASIN', sortable: true },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'quantity', label: 'Qty', sortable: true },
  {
    key: 'price',
    label: 'Price',
    sortable: true,
    render: (val) => val != null ? `$${Number(val).toFixed(2)}` : '—',
  },
  {
    key: 'fulfilment_type',
    label: 'Fulfilment',
    render: (val) => (
      <Badge variant={val === 'FBA' ? 'default' : 'secondary'} className="text-[10px]">
        {val}
      </Badge>
    ),
  },
  { key: 'status', label: 'Status' },
];

export default function AmazonInventoryTab({ connected }: { connected: boolean }) {
  const [subTab, setSubTab] = useState<'FBA' | 'FBM'>('FBA');
  const { data, loading, loadingMore, hasMore, partial, error, lastFetched, fetch, loadMore } = useInventoryFetch<AmazonItem>('fetch-amazon-inventory');

  useEffect(() => { if (connected) fetch(); }, [connected]);

  if (!connected) {
    return (
      <InventoryEmptyState
        platform="Amazon"
        message="Amazon inventory will appear here once your SP-API connection is approved. You can still use Xettle for settlement reconciliation in the meantime."
      />
    );
  }

  const filtered = data.filter(d => d.fulfilment_type === subTab);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {(['FBA', 'FBM'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                subTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <InventoryRefreshBar lastFetched={lastFetched} loading={loading} partial={partial} error={error} onRefresh={fetch} />
      </div>
      <InventoryTable
        columns={columns}
        data={filtered}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />
    </div>
  );
}
