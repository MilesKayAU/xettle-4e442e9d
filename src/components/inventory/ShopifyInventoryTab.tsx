/**
 * Shopify Inventory Tab — fetches live product/variant data.
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useEffect } from 'react';
import { useInventoryFetch } from './useInventoryFetch';
import InventoryTable, { type InventoryColumn } from './InventoryTable';
import InventoryRefreshBar from './InventoryRefreshBar';
import { Badge } from '@/components/ui/badge';

interface ShopifyVariant {
  sku: string;
  title: string;
  product_title: string;
  quantity: number;
  price: number;
  status: string;
  updated_at: string;
  image_url?: string;
}

const columns: InventoryColumn[] = [
  {
    key: 'image_url',
    label: '',
    render: (val) => val ? (
      <img src={val} alt="" className="h-8 w-8 rounded object-cover" />
    ) : <div className="h-8 w-8 rounded bg-muted" />,
  },
  { key: 'sku', label: 'SKU', sortable: true },
  {
    key: 'product_title',
    label: 'Product',
    sortable: true,
    render: (_, row) => (
      <div>
        <div className="font-medium text-foreground">{row.product_title}</div>
        {row.title !== row.product_title && row.title !== 'Default Title' && (
          <div className="text-xs text-muted-foreground">{row.title}</div>
        )}
      </div>
    ),
  },
  { key: 'quantity', label: 'Qty', sortable: true },
  {
    key: 'price',
    label: 'Price',
    sortable: true,
    render: (val) => val != null ? `$${Number(val).toFixed(2)}` : '—',
  },
  {
    key: 'status',
    label: 'Status',
    render: (val) => (
      <Badge variant={val === 'active' ? 'default' : 'secondary'} className="text-[10px]">
        {val}
      </Badge>
    ),
  },
];

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

export default function ShopifyInventoryTab() {
  const { data, loading, loadingMore, hasMore, partial, error, lastFetched, fetch, loadMore } = useInventoryFetch<ShopifyVariant>('fetch-shopify-inventory');

  useEffect(() => { fetch(); }, []);

  return (
    <div className="space-y-4">
      <InventoryRefreshBar lastFetched={lastFetched} loading={loading} partial={partial} error={error} onRefresh={fetch} />
      <InventoryTable
        columns={columns}
        data={data}
        loading={loading}
        statusOptions={statusOptions}
        hasMore={hasMore}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
      />
    </div>
  );
}
