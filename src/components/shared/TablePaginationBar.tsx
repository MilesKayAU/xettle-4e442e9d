/**
 * TablePaginationBar — Reusable pagination footer for settlement tables.
 * Drop below any table that renders a long list.
 */

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TablePaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export const DEFAULT_PAGE_SIZE = 25;

export function usePagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safeP = Math.min(page, totalPages);
  const pageItems = items.slice((safeP - 1) * pageSize, safeP * pageSize);

  return { page: safeP, setPage, totalPages, pageItems, totalItems: items.length };
}

import { useState, useEffect } from 'react';

export default function TablePaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: TablePaginationBarProps) {
  if (totalPages <= 1) return null;

  // Show up to 5 page numbers around current
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground px-4 py-3 border-t border-border/50">
      <span>
        Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, totalItems)} of {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline" size="sm" className="h-7 w-7 p-0"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {pages.map(p => (
          <Button
            key={p}
            variant={p === page ? 'default' : 'outline'}
            size="sm"
            className="h-7 w-7 p-0 text-xs"
            onClick={() => onPageChange(p)}
          >
            {p}
          </Button>
        ))}
        <Button
          variant="outline" size="sm" className="h-7 w-7 p-0"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
