import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, ArrowUpDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export interface InventoryColumn {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: any) => React.ReactNode;
}

interface InventoryTableProps {
  columns: InventoryColumn[];
  data: any[];
  loading?: boolean;
  searchPlaceholder?: string;
  statusOptions?: { value: string; label: string }[];
  statusKey?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  emptyMessage?: string;
}

export default function InventoryTable({
  columns,
  data,
  loading,
  searchPlaceholder = 'Search by SKU or title...',
  statusOptions,
  statusKey = 'status',
  hasMore,
  onLoadMore,
  loadingMore,
  emptyMessage = 'No products found.',
}: InventoryTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    let result = data;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.sku?.toLowerCase().includes(q)) ||
        (r.title?.toLowerCase().includes(q)) ||
        (r.product_title?.toLowerCase().includes(q))
      );
    }
    if (statusFilter !== 'all' && statusKey) {
      result = result.filter(r => r[statusKey] === statusFilter);
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return result;
  }, [data, search, statusFilter, statusKey, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        {statusOptions && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusOptions.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(col => (
                <TableHead
                  key={col.key}
                  className={col.sortable ? 'cursor-pointer select-none' : ''}
                  onClick={() => col.sortable && toggleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && <ArrowUpDown className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={row.sku || row.id || i} className={row._muted ? 'opacity-50' : ''}>
                  {columns.map(col => (
                    <TableCell key={col.key} className="text-sm">
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && onLoadMore && (
        <div className="text-center pt-2">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
