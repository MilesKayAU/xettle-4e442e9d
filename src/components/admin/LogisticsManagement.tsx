import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useLogistics, LogisticsShipment } from '@/hooks/use-logistics';
import { parseLogisticsFile } from '@/utils/logistics-parser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, ExternalLink, Ship, Plane, Trash2, Package, Filter, Copy, CheckSquare, Clock, ScanSearch, Eraser, ArrowUpDown, ArrowUp, ArrowDown, PackageCheck, Search, X, CalendarIcon, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { format, differenceInDays, isAfter, isBefore, addDays } from 'date-fns';
import ArrivalDateReviewDialog, { type ReviewItem } from './ArrivalDateReviewDialog';

const DEFAULT_TRANSIT_DAYS: Record<string, Record<string, number>> = {
  air: { AU: 7, UK: 7, US: 7 },
  sea: { AU: 35, UK: 30, US: 28 },
};

const DEFAULT_AMAZON_CLEARANCE_DAYS: Record<string, Record<string, number>> = {
  air: { AU: 7, UK: 7, US: 7 },
  sea: { AU: 7, UK: 7, US: 7 },
};

// CNY February buffers (total days including Amazon clearance)
// These are planning defaults; actual Feb averages will override once data is collected
const CNY_FEB_BUFFER_DAYS: Record<string, number> = {
  AU: 17,  // Normal 7 + 10 extra delay
  US: 10,  // Normal 7 + 3 extra delay
  UK: 12,  // Normal 7 + 5 extra delay
};

function isFebruaryShipment(s: LogisticsShipment, routeAvgs?: Record<string, number>): boolean {
  // Check actual arrival or ETA first
  const directDate = s.actual_arrival || s.eta;
  if (directDate) return new Date(directDate).getMonth() === 1;
  // Fall back to forecasted ETA (computed from ship_date + route average)
  if (routeAvgs && s.ship_date && s.shipping_method && s.destination_country) {
    const forecasted = getForecastedEta(s, routeAvgs);
    if (forecasted) return new Date(forecasted.date).getMonth() === 1;
  }
  // Last resort: ship_date itself
  if (s.ship_date) return new Date(s.ship_date).getMonth() === 1;
  return false;
}

function computeFebruaryClearanceAverages(shipments: LogisticsShipment[]) {
  const groups: Record<string, { total: number; count: number }> = {};
  shipments.forEach(s => {
    if (!s.amazon_clearance_date || !s.actual_arrival || !s.shipping_method || !s.destination_country) return;
    // Only include shipments that arrived in January or February (CNY impact window)
    const arrivalMonth = new Date(s.actual_arrival).getMonth();
    if (arrivalMonth !== 0 && arrivalMonth !== 1) return; // Jan or Feb only
    const days = differenceInDays(new Date(s.amazon_clearance_date), new Date(s.actual_arrival));
    if (days <= 0 || days > 180) return; // Cap to exclude bad data
    const key = `${s.shipping_method}-${s.destination_country}`;
    if (!groups[key]) groups[key] = { total: 0, count: 0 };
    groups[key].total += days;
    groups[key].count++;
  });
  const result: Record<string, number> = {};
  for (const [key, { total, count }] of Object.entries(groups)) {
    result[key] = Math.round(total / count);
  }
  return result;
}

function computeRouteAverages(shipments: LogisticsShipment[]) {
  const groups: Record<string, { total: number; count: number }> = {};
  shipments.forEach(s => {
    if (s.status !== 'delivered' || !s.actual_arrival || !s.ship_date || !s.shipping_method || !s.destination_country) return;
    const days = differenceInDays(new Date(s.actual_arrival), new Date(s.ship_date));
    if (days <= 0 || days > 365) return; // Cap at 365 days to exclude bad data
    const key = `${s.shipping_method}-${s.destination_country}`;
    if (!groups[key]) groups[key] = { total: 0, count: 0 };
    groups[key].total += days;
    groups[key].count++;
  });
  const result: Record<string, number> = {};
  for (const [key, { total, count }] of Object.entries(groups)) {
    result[key] = Math.round(total / count);
  }
  return result;
}

function computeAmazonClearanceAverages(shipments: LogisticsShipment[]) {
  const groups: Record<string, { total: number; count: number }> = {};
  shipments.forEach(s => {
    if (!s.amazon_clearance_date || !s.actual_arrival || !s.shipping_method || !s.destination_country) return;
    const days = differenceInDays(new Date(s.amazon_clearance_date), new Date(s.actual_arrival));
    if (days <= 0 || days > 180) return; // Cap to exclude bad data
    const key = `${s.shipping_method}-${s.destination_country}`;
    if (!groups[key]) groups[key] = { total: 0, count: 0 };
    groups[key].total += days;
    groups[key].count++;
  });
  const result: Record<string, number> = {};
  for (const [key, { total, count }] of Object.entries(groups)) {
    result[key] = Math.round(total / count);
  }
  return result;
}

function getForecastedEta(s: LogisticsShipment, routeAvgs: Record<string, number>): { date: string; isEstimate: boolean } | null {
  if (s.eta) return { date: s.eta, isEstimate: false };
  if (!s.ship_date || !s.shipping_method || !s.destination_country) return null;
  const key = `${s.shipping_method}-${s.destination_country}`;
  const avgDays = routeAvgs[key] ?? DEFAULT_TRANSIT_DAYS[s.shipping_method]?.[s.destination_country];
  if (!avgDays) return null;
  const est = addDays(new Date(s.ship_date), avgDays);
  return { date: est.toISOString(), isEstimate: true };
}

function getAmazonClearanceDays(s: LogisticsShipment, clearanceAvgs: Record<string, number>, febAvgs: Record<string, number> = {}, routeAvgs: Record<string, number> = {}): number {
  if (!s.shipping_method || !s.destination_country) return 7;
  const key = `${s.shipping_method}-${s.destination_country}`;
  
  // Use February-specific averages during CNY period
  if (isFebruaryShipment(s, routeAvgs)) {
    // Prefer actual Feb data, then CNY defaults
    return febAvgs[key] ?? CNY_FEB_BUFFER_DAYS[s.destination_country] ?? 17;
  }
  
  return clearanceAvgs[key] ?? DEFAULT_AMAZON_CLEARANCE_DAYS[s.shipping_method]?.[s.destination_country] ?? 7;
}

type SortColumn = 'goods_name' | 'ship_date' | 'eta' | 'destination_country' | 'status' | 'actual_arrival' | 'amazon_eta';
type SortDirection = 'asc' | 'desc';

function SortableHeader({ column, label, sortColumn, sortDirection, onSort, className }: {
  column: SortColumn;
  label: React.ReactNode;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (col: SortColumn) => void;
  className?: string;
}) {
  const isActive = sortColumn === column;
  return (
    <TableHead className={className}>
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors text-left w-full"
        onClick={() => onSort(column)}
      >
        {label}
        {isActive ? (
          sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    </TableHead>
  );
}

function getAmazonEta(s: LogisticsShipment, routeAverages: Record<string, number>, clearanceAvgs: Record<string, number>, febAvgs: Record<string, number> = {}): { date: Date; isEstimate: boolean } | null {
  const isAmazon = s.destination_detail?.toLowerCase().includes('amazon');
  if (!isAmazon) return null;
  // If already cleared at Amazon, show that date
  if (s.amazon_clearance_date) {
    return { date: new Date(s.amazon_clearance_date), isEstimate: false };
  }
  const clearanceDays = getAmazonClearanceDays(s, clearanceAvgs, febAvgs, routeAverages);
  if (s.actual_arrival) {
    return { date: addDays(new Date(s.actual_arrival), clearanceDays), isEstimate: true };
  }
  const forecasted = getForecastedEta(s, routeAverages);
  if (forecasted) {
    return { date: addDays(new Date(forecasted.date), clearanceDays), isEstimate: true };
  }
  return null;
}

export default function LogisticsManagement() {
  const { shipments, loading, fetchShipments, uploadShipments, updateShipment, deleteShipment, bulkUpdateStatus, rescanArrivalDates, deduplicateShipments } = useLogistics();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [deduplicating, setDeduplicating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArrivalDate, setBulkArrivalDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('ship_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => { fetchShipments(); }, [fetchShipments]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const parsed = await parseLogisticsFile(file);
      if (parsed.length === 0) {
        toast.error('No shipment records found in file');
        return;
      }
      const result = await uploadShipments(parsed);
      if (result.reviewItems.length > 0) {
        setReviewItems(result.reviewItems);
        setShowReview(true);
      }
    } catch (err: any) {
      toast.error('Parse error: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReviewApprove = async (approvals: Array<{ id: string; date: string }>) => {
    for (const { id, date } of approvals) {
      await updateShipment(id, { actual_arrival: date, status: 'delivered' });
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const result = await rescanArrivalDates();
      if (result.reviewItems.length > 0) {
        setReviewItems(result.reviewItems);
        setShowReview(true);
      }
    } finally {
      setRescanning(false);
    }
  };

  const handleDeduplicate = async () => {
    setDeduplicating(true);
    try {
      await deduplicateShipments();
    } finally {
      setDeduplicating(false);
    }
  };

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const years = useMemo(() => {
    const s = new Set<number>();
    shipments.forEach(sh => { if (sh.source_year) s.add(sh.source_year); });
    return Array.from(s).sort((a, b) => b - a);
  }, [shipments]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return shipments.filter(s =>
        s.reference_number?.toLowerCase().includes(q) ||
        s.tracking_number?.toLowerCase().includes(q) ||
        s.goods_name?.toLowerCase().includes(q) ||
        s.destination_detail?.toLowerCase().includes(q) ||
        s.notes?.toLowerCase().includes(q)
      );
    }
    return shipments.filter(s => {
      if (statusFilter === 'in_transit' && s.status !== 'waiting' && s.status !== 'in_transit') return false;
      if (statusFilter !== 'all' && statusFilter !== 'in_transit' && s.status !== statusFilter) return false;
      if (countryFilter !== 'all' && s.destination_country !== countryFilter) return false;
      if (yearFilter !== 'all' && String(s.source_year) !== yearFilter) return false;
      if (methodFilter !== 'all' && s.shipping_method !== methodFilter) return false;
      return true;
    });
  }, [shipments, statusFilter, countryFilter, yearFilter, methodFilter, searchQuery]);

  const routeAverages = useMemo(() => computeRouteAverages(shipments), [shipments]);
  const clearanceAverages = useMemo(() => computeAmazonClearanceAverages(shipments), [shipments]);
  const febClearanceAverages = useMemo(() => computeFebruaryClearanceAverages(shipments), [shipments]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let valA: string | number | null = null;
      let valB: string | number | null = null;

      switch (sortColumn) {
        case 'goods_name':
          valA = a.goods_name?.toLowerCase() ?? null;
          valB = b.goods_name?.toLowerCase() ?? null;
          break;
        case 'ship_date':
          valA = a.ship_date ?? null;
          valB = b.ship_date ?? null;
          break;
        case 'eta': {
          const etaA = getForecastedEta(a, routeAverages);
          const etaB = getForecastedEta(b, routeAverages);
          valA = etaA?.date ?? null;
          valB = etaB?.date ?? null;
          break;
        }
        case 'destination_country':
          valA = a.destination_country ?? null;
          valB = b.destination_country ?? null;
          break;
        case 'status':
          valA = a.status ?? null;
          valB = b.status ?? null;
          break;
        case 'actual_arrival':
          valA = a.actual_arrival ?? null;
          valB = b.actual_arrival ?? null;
          break;
        case 'amazon_eta': {
          const amzA = getAmazonEta(a, routeAverages, clearanceAverages, febClearanceAverages);
          const amzB = getAmazonEta(b, routeAverages, clearanceAverages, febClearanceAverages);
          valA = amzA?.date.toISOString() ?? null;
          valB = amzB?.date.toISOString() ?? null;
          break;
        }
      }

      // Nulls always go to bottom
      if (valA === null && valB === null) return 0;
      if (valA === null) return 1;
      if (valB === null) return -1;

      const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortColumn, sortDirection, routeAverages]);

  const statusCounts = useMemo(() => {
    const counts = { in_transit: 0, delivered: 0 };
    shipments.forEach(s => {
      if (s.status === 'waiting' || s.status === 'in_transit') counts.in_transit++;
      else if (s.status === 'delivered') counts.delivered++;
    });
    return counts;
  }, [shipments]);

  // Selection helpers
  const allFilteredSelected = sorted.length > 0 && sorted.every(s => selectedIds.has(s.id));
  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map(s => s.id)));
    }
  };
  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (action: 'delivered' | 'in_transit' | 'delete') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (action === 'delete') {
      for (const id of ids) await deleteShipment(id);
    } else {
      const arrivalDate = action === 'delivered' ? bulkArrivalDate : undefined;
      await bulkUpdateStatus(ids, action, arrivalDate);
    }
    setSelectedIds(new Set());
  };

  // Route averages for display
  const routeAvgEntries = useMemo(() => {
    const combined: Record<string, number> = {};
    for (const [method, countries] of Object.entries(DEFAULT_TRANSIT_DAYS)) {
      for (const [country, days] of Object.entries(countries)) {
        combined[`${method}-${country}`] = days;
      }
    }
    for (const [key, days] of Object.entries(routeAverages)) {
      combined[key] = days;
    }
    return Object.entries(combined).map(([key, days]) => {
      const [method, country] = key.split('-');
      const hasData = key in routeAverages;
      return { method, country, days, hasData };
    });
  }, [routeAverages]);

  // Amazon clearance averages for display
  const clearanceAvgEntries = useMemo(() => {
    const combined: Record<string, number> = {};
    for (const [method, countries] of Object.entries(DEFAULT_AMAZON_CLEARANCE_DAYS)) {
      for (const [country, days] of Object.entries(countries)) {
        combined[`${method}-${country}`] = days;
      }
    }
    for (const [key, days] of Object.entries(clearanceAverages)) {
      combined[key] = days;
    }
    return Object.entries(combined).map(([key, days]) => {
      const [method, country] = key.split('-');
      const hasData = key in clearanceAverages;
      return { method, country, days, hasData };
    });
  }, [clearanceAverages]);

  // CNY February buffer entries for display
  const febBufferEntries = useMemo(() => {
    const countries = ['AU', 'US', 'UK'];
    return countries.map(country => {
      const febDataAir = febClearanceAverages[`air-${country}`];
      const febDataSea = febClearanceAverages[`sea-${country}`];
      const defaultDays = CNY_FEB_BUFFER_DAYS[country] ?? 17;
      const actualDays = febDataAir ?? febDataSea ?? null;
      return { country, defaultDays, actualDays, hasData: actualDays !== null };
    });
  }, [febClearanceAverages]);

  const sortProps = { sortColumn, sortDirection, onSort: handleSort };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Logistics & Shipping</h2>
          <p className="text-muted-foreground text-sm">Track manufacturer shipments, ETAs, and Amazon references.</p>
        </div>
        <div>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
            id="logistics-upload"
          />
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? 'Uploading...' : 'Upload Shipping Excel/CSV'}
            </Button>
            <Button variant="outline" onClick={handleRescan} disabled={rescanning}>
              <ScanSearch className="mr-2 h-4 w-4" />
              {rescanning ? 'Scanning...' : 'Re-scan Notes for Arrivals'}
            </Button>
            <Button variant="outline" onClick={handleDeduplicate} disabled={deduplicating}>
              <Eraser className="mr-2 h-4 w-4" />
              {deduplicating ? 'Removing...' : 'Remove Duplicates'}
            </Button>
          </div>
        </div>
      </div>

      {/* Status summary cards + route averages */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
             <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">In Transit / Waiting</p>
                <p className="text-2xl font-bold text-blue-600">{statusCounts.in_transit}</p>
              </div>
              <Ship className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
             <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Delivered</p>
                <p className="text-2xl font-bold text-green-600">{statusCounts.delivered}</p>
              </div>
              <PackageCheck className="h-8 w-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1"><Clock className="h-3 w-3" /> Avg Transit Days</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {routeAvgEntries.map(({ method, country, days, hasData }) => (
                  <div key={`${method}-${country}`} className="flex items-center gap-1">
                    {method === 'air' ? <Plane className="h-3 w-3 text-blue-500" /> : <Ship className="h-3 w-3 text-cyan-600" />}
                    <span>{country}</span>
                    <span className={`ml-auto font-mono ${hasData ? 'font-semibold' : 'text-muted-foreground'}`}>
                      {days}d{!hasData && '*'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">* = default estimate</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1"><PackageCheck className="h-3 w-3" /> Amazon Clearance Days</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {clearanceAvgEntries.map(({ method, country, days, hasData }) => (
                  <div key={`${method}-${country}`} className="flex items-center gap-1">
                    {method === 'air' ? <Plane className="h-3 w-3 text-blue-500" /> : <Ship className="h-3 w-3 text-cyan-600" />}
                    <span>{country}</span>
                    <span className={`ml-auto font-mono ${hasData ? 'font-semibold' : 'text-muted-foreground'}`}>
                      {days}d{!hasData && '*'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">* = default (adapts as you enter dates)</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-200">
          <CardContent className="pt-4 pb-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1">🧧 CNY Feb Buffer</p>
              <div className="space-y-1 text-xs">
                {febBufferEntries.map(({ country, defaultDays, actualDays, hasData }) => {
                  const flag = country === 'AU' ? '🇦🇺' : country === 'US' ? '🇺🇸' : '🇬🇧';
                  return (
                    <div key={country} className="flex items-center justify-between">
                      <span>{flag} {country}</span>
                      <span className={`font-mono ${hasData ? 'font-semibold' : 'text-muted-foreground'}`}>
                        {hasData ? actualDays : defaultDays}d{!hasData && '*'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">* = planning default (adapts with data)</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search ID, tracking, product..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 w-[220px] h-9"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-2.5">
                  <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
            {searchQuery ? (
              <Badge variant="secondary" className="text-xs">Search active — filters bypassed</Badge>
            ) : (
              <>
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="in_transit">In Transit / Waiting</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={countryFilter} onValueChange={setCountryFilter}>
                  <SelectTrigger className="w-[130px]"><SelectValue placeholder="Country" /></SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="all">All Countries</SelectItem>
                    <SelectItem value="AU">🇦🇺 Australia</SelectItem>
                    <SelectItem value="UK">🇬🇧 UK</SelectItem>
                    <SelectItem value="US">🇺🇸 USA</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={methodFilter} onValueChange={setMethodFilter}>
                  <SelectTrigger className="w-[120px]"><SelectValue placeholder="Method" /></SelectTrigger>
                  <SelectContent className="bg-background z-50">
                    <SelectItem value="all">All Methods</SelectItem>
                    <SelectItem value="air">✈️ Air</SelectItem>
                    <SelectItem value="sea">🚢 Sea</SelectItem>
                  </SelectContent>
                </Select>
                {years.length > 0 && (
                  <Select value={yearFilter} onValueChange={setYearFilter}>
                    <SelectTrigger className="w-[110px]"><SelectValue placeholder="Year" /></SelectTrigger>
                    <SelectContent className="bg-background z-50">
                      <SelectItem value="all">All Years</SelectItem>
                      {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </>
            )}
            <span className="text-sm text-muted-foreground ml-auto">{sorted.length} shipments</span>
          </div>
        </CardContent>
      </Card>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <Card className="border-primary">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CheckSquare className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={bulkArrivalDate}
                  onChange={e => setBulkArrivalDate(e.target.value)}
                  className="w-[150px] h-8 text-sm"
                />
                <Button size="sm" variant="outline" onClick={() => handleBulkAction('delivered')}>
                  ✅ Mark Delivered
                </Button>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleBulkAction('in_transit')}>
                🚢 Mark In Transit
              </Button>
              <Button size="sm" variant="destructive" onClick={() => handleBulkAction('delete')}>
                <Trash2 className="h-3 w-3 mr-1" /> Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="ml-auto">
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shipments table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                   <TableHead className="w-8 px-1">
                    <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <SortableHeader column="goods_name" label="Product" {...sortProps} className="px-2" />
                  <SortableHeader column="ship_date" label="Date" {...sortProps} className="px-2" />
                  <TableHead className="px-1">Ctns</TableHead>
                  <TableHead className="px-1">Method</TableHead>
                  <SortableHeader column="destination_country" label="Dest" {...sortProps} className="px-2" />
                  <TableHead className="px-2">Tracking</TableHead>
                  <TableHead className="px-1">Ref</TableHead>
                  <SortableHeader column="status" label="Status" {...sortProps} className="px-1" />
                  <TableHead className="px-1">Timeline</TableHead>
                  <SortableHeader column="eta" label="ETA" {...sortProps} className="px-1" />
                  <SortableHeader column="amazon_eta" label={<TooltipProvider><Tooltip><TooltipTrigger asChild><span className="flex items-center gap-1 text-xs cursor-help"><PackageCheck className="h-3 w-3" />Amz Cleared <Info className="h-2.5 w-2.5 opacity-50" /></span></TooltipTrigger><TooltipContent><p className="text-xs">Date Amazon received & cleared the shipment into FBA inventory</p></TooltipContent></Tooltip></TooltipProvider>} {...sortProps} className="px-1" />
                  <SortableHeader column="actual_arrival" label={<TooltipProvider><Tooltip><TooltipTrigger asChild><span className="flex items-center gap-1 text-xs cursor-help">Arrived in Country <Info className="h-2.5 w-2.5 opacity-50" /></span></TooltipTrigger><TooltipContent><p className="text-xs">Date the shipment physically arrived in the destination country (not yet at Amazon)</p></TooltipContent></Tooltip></TooltipProvider>} {...sortProps} className="px-1" />
                  <TableHead className="px-1">Notes</TableHead>
                  <TableHead className="px-0 w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={15} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : sorted.length === 0 ? (
                  <TableRow><TableCell colSpan={15} className="text-center py-8 text-muted-foreground">No shipments found. Upload a manufacturer shipping spreadsheet to get started.</TableCell></TableRow>
                ) : sorted.map(s => (
                  <ShipmentRow
                    key={s.id}
                    shipment={s}
                    onUpdate={updateShipment}
                    onDelete={deleteShipment}
                    selected={selectedIds.has(s.id)}
                    onToggle={() => toggleOne(s.id)}
                    routeAverages={routeAverages}
                    clearanceAverages={clearanceAverages}
                    febClearanceAverages={febClearanceAverages}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {showReview && reviewItems.length > 0 && (
        <ArrivalDateReviewDialog
          open={showReview}
          onClose={() => setShowReview(false)}
          items={reviewItems}
          onApprove={handleReviewApprove}
        />
      )}
    </div>
  );
}

function ShipmentRow({ shipment: s, onUpdate, onDelete, selected, onToggle, routeAverages, clearanceAverages, febClearanceAverages }: {
  shipment: LogisticsShipment;
  onUpdate: (id: string, u: Partial<LogisticsShipment>) => void;
  onDelete: (id: string) => void;
  selected: boolean;
  onToggle: () => void;
  routeAverages: Record<string, number>;
  clearanceAverages: Record<string, number>;
  febClearanceAverages: Record<string, number>;
}) {
  const statusColor = s.status === 'delivered' ? 'bg-green-100 text-green-800'
    : s.status === 'in_transit' ? 'bg-blue-100 text-blue-800'
    : 'bg-gray-100 text-gray-800';

  const forecastedEta = useMemo(() => getForecastedEta(s, routeAverages), [s, routeAverages]);

  const amazonEta = useMemo(() => getAmazonEta(s, routeAverages, clearanceAverages, febClearanceAverages), [s, routeAverages, clearanceAverages, febClearanceAverages]);

  const timelineProgress = useMemo(() => {
    if (s.status === 'delivered') return 100;
    if (!s.ship_date) return 0;
    const start = new Date(s.ship_date);
    const end = forecastedEta ? new Date(forecastedEta.date) : s.etd ? new Date(s.etd) : null;
    if (!end) return s.status === 'in_transit' ? 50 : 0;
    const now = new Date();
    if (isBefore(now, start)) return 0;
    if (isAfter(now, end)) return 95;
    const total = differenceInDays(end, start) || 1;
    const elapsed = differenceInDays(now, start);
    return Math.min(95, Math.round((elapsed / total) * 100));
  }, [s, forecastedEta]);

  const progressColor = s.status === 'delivered' ? 'bg-green-500' : s.status === 'in_transit' ? 'bg-blue-500' : 'bg-gray-300';

  const countryFlag = s.destination_country === 'AU' ? '🇦🇺' : s.destination_country === 'UK' ? '🇬🇧' : s.destination_country === 'US' ? '🇺🇸' : '';

  const handleStatusChange = (newStatus: string) => {
    const updates: Partial<LogisticsShipment> = { status: newStatus };
    if (newStatus === 'delivered' && !s.actual_arrival) {
      updates.actual_arrival = new Date().toISOString().split('T')[0];
    }
    onUpdate(s.id, updates);
  };

  const handleArrivalDate = (date: string) => {
    const updates: Partial<LogisticsShipment> = { actual_arrival: date || null };
    onUpdate(s.id, updates);
  };

  const isAmazon = s.destination_detail?.toLowerCase().includes('amazon');

  return (
    <TableRow className={`text-xs ${selected ? 'bg-muted/50' : ''}`}>
      <TableCell className="px-1">
        <Checkbox checked={selected} onCheckedChange={onToggle} />
      </TableCell>
      <TableCell className="font-medium max-w-[110px] truncate px-1">{s.goods_name}</TableCell>
      <TableCell className="whitespace-nowrap px-1 text-[10px]">
        {s.ship_date ? format(new Date(s.ship_date), 'd MMM yy') : '—'}
      </TableCell>
      <TableCell className="px-1">{s.cartons ?? '—'}</TableCell>
      <TableCell className="px-1">
        {s.shipping_method === 'air' ? <Plane className="h-3.5 w-3.5 inline text-blue-500" /> : s.shipping_method === 'sea' ? <Ship className="h-3.5 w-3.5 inline text-cyan-600" /> : '—'}
        {s.vessel_name && <span className="ml-1 text-[10px] text-muted-foreground">{s.vessel_name}</span>}
      </TableCell>
      <TableCell className="px-1">
        <span className="text-[10px]">{countryFlag} {s.destination_country || ''}</span>
        {s.destination_detail && <span className="block text-[9px] text-muted-foreground truncate max-w-[60px]">{s.destination_detail}</span>}
      </TableCell>
      <TableCell className="px-2">
        {s.tracking_number ? (
          <div className="flex items-center gap-0.5">
            {s.tracking_url ? (
              <a href={s.tracking_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5 text-[11px]">
                {s.tracking_number.length > 10 ? s.tracking_number.slice(0, 10) + '…' : s.tracking_number}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ) : (
              <span className="font-mono text-[10px]">{s.tracking_number.length > 10 ? s.tracking_number.slice(0, 10) + '…' : s.tracking_number}</span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              title="Copy tracking number"
              onClick={() => {
                navigator.clipboard.writeText(s.tracking_number!);
                toast.success('Tracking number copied');
              }}
            >
              <Copy className="h-2.5 w-2.5" />
            </Button>
          </div>
        ) : '—'}
      </TableCell>
      <TableCell className="px-1">
        {s.reference_number ? (
          <Badge variant="outline" className="font-mono text-[10px] px-1 py-0">{s.reference_number}</Badge>
        ) : '—'}
      </TableCell>
      <TableCell className="px-1">
        <Select value={s.status} onValueChange={handleStatusChange}>
          <SelectTrigger className={`w-[90px] h-6 text-[11px] ${statusColor} border-0`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-background z-50">
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="in_transit">In Transit</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="min-w-[90px] px-1">
        <div className="space-y-0.5">
          <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={`absolute left-0 top-0 h-full rounded-full transition-all ${progressColor}`} style={{ width: `${timelineProgress}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground">
            {s.etd && <span>ETD: {format(new Date(s.etd), 'd/M')}</span>}
            {forecastedEta && (
              <span className={forecastedEta.isEstimate ? 'italic' : ''}>
                {forecastedEta.isEstimate ? '~' : ''}ETA: {format(new Date(forecastedEta.date), 'd/M')}
              </span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap px-1">
        {forecastedEta ? (
          <span className={forecastedEta.isEstimate ? 'italic text-muted-foreground' : ''}>
            {forecastedEta.isEstimate ? '~' : ''}{format(new Date(forecastedEta.date), 'd MMM')}
          </span>
        ) : '—'}
      </TableCell>
      {/* Amazon ETA / Clearance column */}
      <TableCell className="px-1">
        {isAmazon ? (
          <div className="space-y-0.5">
            {amazonEta ? (
              <span className={`flex items-center gap-0.5 text-[11px] ${s.amazon_clearance_date ? 'text-green-600 font-medium' : amazonEta.isEstimate ? 'italic text-muted-foreground' : 'text-orange-600 font-medium'}`}>
                <PackageCheck className="h-3 w-3 shrink-0" />
                {s.amazon_clearance_date ? '' : amazonEta.isEstimate ? '~' : ''}{format(amazonEta.date, 'd MMM')}
                {s.amazon_clearance_date && <span className="text-[9px] text-muted-foreground">✓</span>}
              </span>
            ) : '—'}
            <div className="flex items-center gap-0.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-5 text-[10px] w-[80px] px-1 justify-start font-normal" title="Actual Amazon clearance date">
                    <CalendarIcon className="h-3 w-3 mr-0.5 shrink-0" />
                    {s.amazon_clearance_date ? format(new Date(s.amazon_clearance_date + 'T00:00:00'), 'd MMM yy') : <span className="text-muted-foreground">Set</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={s.amazon_clearance_date ? new Date(s.amazon_clearance_date + 'T00:00:00') : undefined}
                    onSelect={(date) => {
                      if (date) {
                        const updates: any = { amazon_clearance_date: format(date, 'yyyy-MM-dd') };
                        if (s.status !== 'delivered') updates.status = 'delivered';
                        onUpdate(s.id, updates);
                      }
                    }}
                    captionLayout="dropdown-buttons"
                    fromYear={2018}
                    toYear={2030}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              {s.amazon_clearance_date && (
                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" title="Clear date" onClick={() => {
                  const updates: any = { amazon_clearance_date: null };
                  if (s.status === 'delivered') updates.status = 'in_transit';
                  onUpdate(s.id, updates);
                }}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="px-1">
        <div className="flex items-center gap-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-6 text-[10px] w-[80px] px-1 justify-start font-normal">
                <CalendarIcon className="h-3 w-3 mr-0.5 shrink-0" />
                {s.actual_arrival ? format(new Date(s.actual_arrival + 'T00:00:00'), 'd MMM yy') : <span className="text-muted-foreground">Set</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={s.actual_arrival ? new Date(s.actual_arrival + 'T00:00:00') : undefined}
                onSelect={(date) => {
                  if (date) handleArrivalDate(format(date, 'yyyy-MM-dd'));
                }}
                captionLayout="dropdown-buttons"
                fromYear={2018}
                toYear={2030}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {s.actual_arrival && (
            <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" title="Clear date" onClick={() => handleArrivalDate('')}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell className="text-[10px] text-muted-foreground max-w-[80px] truncate px-1" title={s.notes || ''}>
        {s.notes || '—'}
      </TableCell>
      <TableCell className="px-0">
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => onDelete(s.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
