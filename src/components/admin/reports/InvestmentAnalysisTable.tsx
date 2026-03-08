import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  DollarSign, 
  TrendingUp, 
  Package, 
  AlertTriangle, 
  Calculator,
  Download,
  Eye,
  EyeOff,
  Settings2
} from "lucide-react";
import { InventoryRawData, ForecastWithInventory } from '@/hooks/use-inventory-database';

interface InvestmentAnalysisProps {
  inventoryData: InventoryRawData[];
  forecastData: ForecastWithInventory[];
  forecastPeriodMonths: number;
  defaultLeadTime: number;
  defaultBufferDays: number;
  safetyStockMultiplier: number;
}

interface InvestmentRow {
  id: string;
  sku: string;
  title: string;
  currentStock: number;
  salesVelocity: number;
  daysToDeliver: number;
  stockNeededForPeriod: number;
  currentStockValue: number;
  reorderQuantity: number;
  investmentRequired: number;
  forecastedProfit: number;
  roi: number;
  urgencyLevel: 'critical' | 'warning' | 'good' | 'inactive';
  margin: number;
  costPerUnit: number;
}

const InvestmentAnalysisTable: React.FC<InvestmentAnalysisProps> = ({
  inventoryData,
  forecastData,
  forecastPeriodMonths,
  defaultLeadTime,
  defaultBufferDays,
  safetyStockMultiplier
}) => {
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string>('investmentRequired');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterUrgency, setFilterUrgency] = useState<string>('all');
  const [showUnprofitable, setShowUnprofitable] = useState(false);
  
  // Column visibility state
  const [columnVisibility, setColumnVisibility] = useState({
    status: true,
    sku: true,
    product: true,
    currentStock: true,
    stockNeeded: true,
    reorderQty: true,
    investment: true,
    profit: true,
    roi: true,
  });

  const analysisData = useMemo(() => {
    const DAYS_PER_MONTH = 30.4;
    const totalLeadTime = defaultLeadTime + defaultBufferDays;
    
    return inventoryData.map(item => {
      const currentStock = item.fba_fbm_stock || 0;
      const salesVelocity = item.estimated_sales_velocity || 0;
      const stockValue = item.stock_value || 0;
      const margin = item.margin || 0;
      
      // Cost calculations
      const costPerUnit = currentStock > 0 && stockValue > 0 ? stockValue / currentStock : 0;
      
      // Calculate reorder point (when to trigger reorder)
      const reorderPoint = Math.ceil(salesVelocity * totalLeadTime * safetyStockMultiplier);
      
      // Calculate target stock for forecast period
      const forecastPeriodDays = DAYS_PER_MONTH * forecastPeriodMonths;
      const targetStockForPeriod = Math.ceil(salesVelocity * forecastPeriodDays * safetyStockMultiplier);
      
      // Reorder quantity calculation - order enough to reach target stock level
      const reorderQuantity = Math.max(0, targetStockForPeriod - currentStock);
      
      // Financial calculations
      const investmentRequired = reorderQuantity * costPerUnit;
      const forecastedSales = salesVelocity * forecastPeriodDays;
      const forecastedProfit = forecastedSales * margin;
      const roi = investmentRequired > 0 ? (forecastedProfit / investmentRequired) * 100 : 0;
      
      // Urgency level based on reorder point logic
      let urgencyLevel: 'critical' | 'warning' | 'good' | 'inactive' = 'good';
      const daysRemaining = salesVelocity > 0 ? currentStock / salesVelocity : 999;
      
      if (salesVelocity === 0 || currentStock === 0 || margin <= 0) {
        urgencyLevel = 'inactive';
      } else if (currentStock <= reorderPoint) {
        urgencyLevel = 'critical';
      } else if (daysRemaining <= totalLeadTime + 15) {
        urgencyLevel = 'warning';
      }

      return {
        id: item.id,
        sku: item.sku,
        title: item.title || 'N/A',
        currentStock,
        salesVelocity,
        daysToDeliver: totalLeadTime,
        stockNeededForPeriod: targetStockForPeriod,
        currentStockValue: stockValue,
        reorderQuantity,
        investmentRequired,
        forecastedProfit,
        roi,
        urgencyLevel,
        margin,
        costPerUnit
      } as InvestmentRow;
    });
  }, [inventoryData, forecastPeriodMonths, defaultLeadTime, defaultBufferDays, safetyStockMultiplier]);

  const filteredAndSortedData = useMemo(() => {
    let filtered = analysisData;
    
    // Filter by urgency
    if (filterUrgency !== 'all') {
      filtered = filtered.filter(row => row.urgencyLevel === filterUrgency);
    }
    
    // Filter unprofitable items
    if (!showUnprofitable) {
      filtered = filtered.filter(row => row.roi > 0 && row.margin > 0);
    }
    
    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortBy as keyof InvestmentRow] as number;
      const bVal = b[sortBy as keyof InvestmentRow] as number;
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });
    
    return filtered;
  }, [analysisData, filterUrgency, showUnprofitable, sortBy, sortOrder]);

  const summaryStats = useMemo(() => {
    const selectedData = selectedRows.length > 0 
      ? filteredAndSortedData.filter(row => selectedRows.includes(row.id))
      : filteredAndSortedData;
      
    return {
      totalInvestment: selectedData.reduce((sum, row) => sum + row.investmentRequired, 0),
      totalProfit: selectedData.reduce((sum, row) => sum + row.forecastedProfit, 0),
      averageROI: selectedData.length > 0 
        ? selectedData.reduce((sum, row) => sum + row.roi, 0) / selectedData.length 
        : 0,
      criticalItems: selectedData.filter(row => row.urgencyLevel === 'critical').length,
      warningItems: selectedData.filter(row => row.urgencyLevel === 'warning').length,
      itemCount: selectedData.length
    };
  }, [filteredAndSortedData, selectedRows]);

  const getUrgencyBadge = (urgency: string) => {
    switch (urgency) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'warning':
        return <Badge variant="outline">Warning</Badge>;
      case 'good':
        return <Badge variant="default">Good</Badge>;
      default:
        return <Badge variant="secondary">Inactive</Badge>;
    }
  };

  const toggleRowSelection = (rowId: string) => {
    setSelectedRows(prev => 
      prev.includes(rowId)
        ? prev.filter(id => id !== rowId)
        : [...prev, rowId]
    );
  };

  const toggleAllSelection = () => {
    setSelectedRows(
      selectedRows.length === filteredAndSortedData.length 
        ? [] 
        : filteredAndSortedData.map(row => row.id)
    );
  };

  const exportSelectedData = () => {
    const dataToExport = selectedRows.length > 0 
      ? filteredAndSortedData.filter(row => selectedRows.includes(row.id))
      : filteredAndSortedData;
      
    const csvContent = [
      ['SKU', 'Title', 'Current Stock', 'Reorder Qty', 'Investment Required', 'Forecasted Profit', 'ROI %', 'Urgency'],
      ...dataToExport.map(row => [
        row.sku,
        row.title,
        row.currentStock,
        row.reorderQuantity,
        row.investmentRequired.toFixed(2),
        row.forecastedProfit.toFixed(2),
        row.roi.toFixed(1),
        row.urgencyLevel
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-investment-analysis-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const toggleColumnVisibility = (column: keyof typeof columnVisibility) => {
    setColumnVisibility(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-600" />
              <div>
                <div className="text-xs text-muted-foreground">Total Investment</div>
                <div className="font-bold">${summaryStats.totalInvestment.toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              <div>
                <div className="text-xs text-muted-foreground">Forecasted Profit</div>
                <div className="font-bold">${summaryStats.totalProfit.toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-purple-600" />
              <div>
                <div className="text-xs text-muted-foreground">Average ROI</div>
                <div className="font-bold">{summaryStats.averageROI.toFixed(1)}%</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <div>
                <div className="text-xs text-muted-foreground">Critical Items</div>
                <div className="font-bold">{summaryStats.criticalItems}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analysis Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Investment Analysis for {forecastPeriodMonths} Month{forecastPeriodMonths > 1 ? 's' : ''}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={filterUrgency} onValueChange={setFilterUrgency}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Filter by urgency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Items</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUnprofitable(!showUnprofitable)}
                className="flex items-center gap-2"
              >
                {showUnprofitable ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {showUnprofitable ? 'Show All' : 'Hide Unprofitable'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.status}
                    onCheckedChange={() => toggleColumnVisibility('status')}
                  >
                    Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.sku}
                    onCheckedChange={() => toggleColumnVisibility('sku')}
                  >
                    SKU
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.product}
                    onCheckedChange={() => toggleColumnVisibility('product')}
                  >
                    Product
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.currentStock}
                    onCheckedChange={() => toggleColumnVisibility('currentStock')}
                  >
                    Current Stock
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.stockNeeded}
                    onCheckedChange={() => toggleColumnVisibility('stockNeeded')}
                  >
                    Stock Needed
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.reorderQty}
                    onCheckedChange={() => toggleColumnVisibility('reorderQty')}
                  >
                    Reorder Qty
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.investment}
                    onCheckedChange={() => toggleColumnVisibility('investment')}
                  >
                    Investment Required
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.profit}
                    onCheckedChange={() => toggleColumnVisibility('profit')}
                  >
                    Forecasted Profit
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.roi}
                    onCheckedChange={() => toggleColumnVisibility('roi')}
                  >
                    ROI %
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={exportSelectedData}
                className="flex items-center gap-2"
                disabled={filteredAndSortedData.length === 0}
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Comprehensive investment analysis showing stock requirements, investment needs, and profitability projections.
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-auto max-h-[600px]">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedRows.length === filteredAndSortedData.length && filteredAndSortedData.length > 0}
                      onCheckedChange={toggleAllSelection}
                     />
                   </TableHead>
                   {columnVisibility.status && (
                     <TableHead className="w-20">Status</TableHead>
                   )}
                   {columnVisibility.sku && (
                     <TableHead className="w-32">SKU</TableHead>
                   )}
                   {columnVisibility.product && (
                     <TableHead className="min-w-48">Product</TableHead>
                   )}
                   {columnVisibility.currentStock && (
                     <TableHead className="w-20 text-right cursor-pointer" onClick={() => {
                       setSortBy('currentStock');
                       setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                     }}>
                       Current Stock
                     </TableHead>
                   )}
                   {columnVisibility.stockNeeded && (
                     <TableHead className="w-24 text-right cursor-pointer" onClick={() => {
                       setSortBy('stockNeededForPeriod');
                       setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                     }}>
                       Stock Needed
                     </TableHead>
                   )}
                   {columnVisibility.reorderQty && (
                     <TableHead className="w-24 text-right cursor-pointer" onClick={() => {
                       setSortBy('reorderQuantity');
                       setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                     }}>
                       Reorder Qty
                     </TableHead>
                   )}
                   {columnVisibility.investment && (
                     <TableHead className="w-32 text-right cursor-pointer" onClick={() => {
                       setSortBy('investmentRequired');
                       setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                     }}>
                       Investment Required
                     </TableHead>
                   )}
                    {columnVisibility.profit && (
                      <TableHead className="w-32 text-right cursor-pointer" onClick={() => {
                        setSortBy('forecastedProfit');
                        setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                      }}>
                        Forecast ({forecastPeriodMonths} mo)
                      </TableHead>
                    )}
                   {columnVisibility.roi && (
                     <TableHead className="w-20 text-right cursor-pointer" onClick={() => {
                       setSortBy('roi');
                       setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
                     }}>
                       ROI %
                     </TableHead>
                   )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedData.map((row) => (
                  <TableRow 
                    key={row.id} 
                    className={`hover:bg-muted/50 ${selectedRows.includes(row.id) ? 'bg-muted/30' : ''}`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedRows.includes(row.id)}
                        onCheckedChange={() => toggleRowSelection(row.id)}
                       />
                     </TableCell>
                     {columnVisibility.status && (
                       <TableCell>
                         {getUrgencyBadge(row.urgencyLevel)}
                       </TableCell>
                     )}
                     {columnVisibility.sku && (
                       <TableCell className="font-mono text-xs">
                         {row.sku}
                       </TableCell>
                     )}
                     {columnVisibility.product && (
                       <TableCell className="max-w-48">
                         <div className="truncate" title={row.title}>
                           {row.title}
                         </div>
                       </TableCell>
                     )}
                     {columnVisibility.currentStock && (
                       <TableCell className="text-right">
                         {row.currentStock.toLocaleString()}
                       </TableCell>
                     )}
                     {columnVisibility.stockNeeded && (
                       <TableCell className="text-right">
                         {row.stockNeededForPeriod.toLocaleString()}
                       </TableCell>
                     )}
                     {columnVisibility.reorderQty && (
                       <TableCell className="text-right font-medium">
                         {row.reorderQuantity > 0 ? row.reorderQuantity.toLocaleString() : '-'}
                       </TableCell>
                     )}
                     {columnVisibility.investment && (
                       <TableCell className="text-right font-medium">
                         {row.investmentRequired > 0 ? `$${row.investmentRequired.toLocaleString()}` : '-'}
                       </TableCell>
                     )}
                     {columnVisibility.profit && (
                       <TableCell className="text-right font-medium text-green-600">
                         ${row.forecastedProfit.toLocaleString()}
                       </TableCell>
                     )}
                     {columnVisibility.roi && (
                       <TableCell className="text-right font-medium">
                         <span className={row.roi > 50 ? 'text-green-600' : row.roi > 20 ? 'text-yellow-600' : 'text-red-600'}>
                           {row.roi.toFixed(1)}%
                         </span>
                       </TableCell>
                     )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          
          {filteredAndSortedData.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No items match your current filters.
            </div>
          )}
          
          <div className="mt-4 text-sm text-muted-foreground">
            <p><strong>Analysis Details:</strong></p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Target Stock:</strong> Sales Velocity × Forecast Days × Safety Multiplier ({safetyStockMultiplier}x)</li>
              <li><strong>Reorder Point:</strong> Sales Velocity × Total Lead Time × Safety Multiplier</li>
              <li><strong>Total Lead Time:</strong> Manufacturing ({defaultLeadTime}d) + Buffer ({defaultBufferDays}d) = {defaultLeadTime + defaultBufferDays}d</li>
              <li><strong>Reorder Quantity:</strong> Target Stock - Current Stock (if positive)</li>
              <li><strong>Investment Required:</strong> Reorder Quantity × Cost Per Unit</li>
              <li><strong>ROI:</strong> (Forecasted Profit ÷ Investment Required) × 100</li>
              <li><strong>Urgency:</strong> Critical = Below Reorder Point, Warning = Near Lead Time</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InvestmentAnalysisTable;