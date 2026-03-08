import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, TrendingUp, DollarSign, Package, AlertTriangle, RefreshCw, Settings, BarChart3, CheckCircle, Download, Filter, Percent } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { InventoryRawData, ForecastWithInventory } from '@/hooks/use-inventory-database';
import { useSupplierMapping } from '@/hooks/useSupplierMapping';

import InvestmentAnalysisTable from './InvestmentAnalysisTable';
import { ForecastIgnoreControls } from './ForecastIgnoreControls';
import { useIgnoredProducts } from '@/hooks/use-ignored-products';

interface ForecastEngineProps {
  inventoryData: InventoryRawData[];
  forecastData: ForecastWithInventory[];
  forecastPeriodMonths: number;
  onForecastPeriodChange: (months: number) => void;
  onGenerateForecast: (settings?: any) => void;
  loading: boolean;
  defaultActiveTab?: string;
}

interface ForecastColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  type: 'text' | 'number' | 'currency' | 'badge' | 'progress';
  width?: string;
}

const ForecastEngine: React.FC<ForecastEngineProps> = ({
  inventoryData,
  forecastData,
  forecastPeriodMonths,
  onForecastPeriodChange,
  onGenerateForecast,
  loading,
  defaultActiveTab = "settings"
}) => {
  // Supplier mapping hook
  const { supplierMapping, fetchSupplierMapping } = useSupplierMapping();
  
  // Enhanced settings state
  const [defaultLeadTime, setDefaultLeadTime] = useState(30);
  const [defaultBufferDays, setDefaultBufferDays] = useState(7);
  const [safetyStockMultiplier, setSafetyStockMultiplier] = useState(1.5);
  const [calculationMode, setCalculationMode] = useState<'from_today' | 'post_arrival'>('post_arrival');
  
  // Filter and sort state for forecast results
  const [filterBy, setFilterBy] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('urgency');

  // Export filter state
  const [exportMinMargin, setExportMinMargin] = useState<number>(0);
  const [exportReorderOnly, setExportReorderOnly] = useState<boolean>(false);
  const [showExportFilters, setShowExportFilters] = useState<boolean>(false);

  // Fetch supplier mapping when forecast data changes
  useEffect(() => {
    if (forecastData.length > 0) {
      const skus = forecastData.map(item => item.inventory.sku);
      fetchSupplierMapping(skus);
    }
  }, [forecastData, fetchSupplierMapping]);

  // Function to handle generate forecast with default settings
  const handleGenerateForecast = () => {
    // Prepare current settings to pass to forecast generation
    const currentSettings = {
      leadTimeDays: defaultLeadTime,
      bufferDays: defaultBufferDays,
      safetyStockMultiplier: safetyStockMultiplier,
      calculationMode: calculationMode
    };

    console.log('🔍 Generating forecast with settings:', currentSettings);

    // Load default period if available
    const stored = localStorage.getItem('forecast-settings');
    if (stored) {
      try {
        const savedSettings = JSON.parse(stored);
        if (savedSettings.defaultPeriod && savedSettings.defaultPeriod !== forecastPeriodMonths) {
          onForecastPeriodChange(savedSettings.defaultPeriod);
          
          // Brief delay to allow state update before generating
          setTimeout(() => {
            onGenerateForecast(currentSettings);
          }, 100);
          return;
        }
      } catch (error) {
        console.error('Failed to load saved settings:', error);
      }
    }
    
    // Generate with current settings
    onGenerateForecast(currentSettings);
  };

  // Ignored products hook
  const { filterForecastData, loadIgnoredProducts } = useIgnoredProducts();

  // Filter out ignored products from the forecast data
  const filteredForecastData = useMemo(() => {
    return filterForecastData(forecastData);
  }, [forecastData, filterForecastData]);

  const filteredAndSortedData = useMemo(() => {
    let filtered = filteredForecastData;

    // Apply filters
    if (filterBy !== 'all') {
      filtered = filtered.filter((item) => {
        switch (filterBy) {
          case 'reorder-needed':
            return item.reorder_quantity_required > 0;
          case 'critical':
            return item.urgency_level === 'critical';
          case 'high-missed-profit':
            return item.missed_profit > 500;
          case 'profitable':
            return item.forecasted_profit > 0;
          case 'negative-roi':
            return item.urgency_level === 'inactive';
          default:
            return true;
        }
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'urgency':
          const urgencyOrder = { critical: 0, warning: 1, good: 2, inactive: 3 };
          return urgencyOrder[a.urgency_level] - urgencyOrder[b.urgency_level];
        case 'days-left':
          return a.days_of_stock_remaining - b.days_of_stock_remaining;
        case 'profit':
          return b.forecasted_profit - a.forecasted_profit;
        case 'reorder-qty':
          return b.reorder_quantity_required - a.reorder_quantity_required;
        default:
          return 0;
      }
    });

    return filtered;
  }, [filteredForecastData, filterBy, sortBy]);

  const summaryStats = useMemo(() => {
    const total = forecastData.length;
    const critical = forecastData.filter(item => item.urgency_level === 'critical').length;
    const needReorder = forecastData.filter(item => item.reorder_quantity_required > 0).length;
    const totalMissedProfit = forecastData.reduce((sum, item) => sum + item.missed_profit, 0);
    const totalForecastedProfit = forecastData.reduce((sum, item) => sum + item.forecasted_profit, 0);

    return { total, critical, needReorder, totalMissedProfit, totalForecastedProfit };
  }, [forecastData]);

  const getUrgencyBadge = (urgencyLevel: 'critical' | 'warning' | 'good' | 'inactive') => {
    const configs = {
      critical: { label: 'Critical', variant: 'destructive' as const, icon: AlertTriangle },
      warning: { label: 'Reorder Soon', variant: 'default' as const, icon: TrendingUp },
      good: { label: 'Healthy Stock', variant: 'secondary' as const, icon: CheckCircle },
      inactive: { label: 'Negative ROI', variant: 'outline' as const, icon: AlertTriangle },
    };

    const config = configs[urgencyLevel];
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getRowClassName = (urgencyLevel: 'critical' | 'warning' | 'good' | 'inactive') => {
    const baseClass = "border-b hover:bg-gray-50";
    switch (urgencyLevel) {
      case 'critical':
        return `${baseClass} bg-red-50 border-red-200`;
      case 'warning':
        return `${baseClass} bg-orange-50 border-orange-200`;
      case 'good':
        return `${baseClass} bg-green-50 border-green-200`;
      case 'inactive':
        return `${baseClass} bg-gray-100 border-gray-300`;
      default:
        return baseClass;
    }
  };

  const exportForecastData = (reorderOnly: boolean = false) => {
    let dataToExport = reorderOnly 
      ? filteredAndSortedData.filter(item => item.reorder_quantity_required > 0)
      : filteredAndSortedData;

    // Apply export filters
    if (exportMinMargin > 0) {
      dataToExport = dataToExport.filter(item => {
        const margin = item.inventory.margin || 0;
        return margin >= exportMinMargin;
      });
    }

    if (exportReorderOnly && !reorderOnly) {
      dataToExport = dataToExport.filter(item => item.reorder_quantity_required > 0);
    }

    if (dataToExport.length === 0) {
      toast({
        title: "No Data",
        description: "No items match the current export filters. Please adjust your filter criteria.",
        variant: "destructive",
      });
      return;
    }

    const exportData = dataToExport.map((item) => {
      const sku = item.inventory.sku;
      const supplier = supplierMapping[sku];
      
      return {
        SKU: item.inventory.sku,
        Title: item.inventory.title || 'N/A',
        'Current Stock': item.inventory.fba_fbm_stock,
        'Inbound (FBA)': item.inventory.sent_to_fba || 0,
        'Sales/Day': item.inventory.estimated_sales_velocity?.toFixed(1) || '0.0',
        'Days Left': item.days_of_stock_remaining === 999999 ? 'Infinity' : Math.round(item.days_of_stock_remaining),
        [`Forecast (${forecastPeriodMonths} mo)`]: Math.round(item.forecasted_sales),
        'Reorder Qty': item.reorder_quantity_required > 0 ? item.reorder_quantity_required : 'No reorder needed',
        'COG/Unit': item.cog_per_unit > 0 ? `$${item.cog_per_unit.toFixed(2)}` : 'N/A',
        'Margin': item.inventory.margin > 0 ? `${item.inventory.margin.toFixed(1)}%` : 'N/A',
        'Urgency': item.urgency_level,
        'Updated': new Date(item.updated_at).toLocaleString(),
        // Supplier information at the end
        'Supplier': supplier?.name || supplier?.company_name || item.inventory.supplier_name || 'Unassigned',
        'Company Name': supplier?.company_name || 'N/A',
        'Contact Person': supplier?.contact_person || 'N/A',
        'Email': supplier?.email || 'N/A',
        'Phone': supplier?.phone || 'N/A',
      };
    });

    const headers = Object.keys(exportData[0]);
    const csvContent = [
      headers.join(','),
      ...exportData.map(row => headers.map(header => `"${row[header]}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    
    const filePrefix = reorderOnly ? 'reorder_required' : 'inventory_forecast';
    link.setAttribute('download', `${filePrefix}_${forecastPeriodMonths}mo_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Report Exported",
      description: `${reorderOnly ? 'Reorder' : 'Forecast'} report has been downloaded as CSV file.`,
    });
  };

  const renderCalculationModeInfo = () => (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-blue-600" />
          <div className="font-medium">Current Calculation Method:</div>
          <Badge variant="outline" className="ml-2">
            {calculationMode === 'from_today' ? '📅 From Today' : '🚀 Post Arrival Coverage'}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground mt-1">
          {calculationMode === 'from_today' 
            ? 'Calculating stock needed from today through the forecast period, accounting for stockout risks.'
            : 'Calculating stock needed for the full forecast period after new inventory arrives.'
          }
        </div>
      </CardContent>
    </Card>
  );

  const renderSummaryCards = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-600" />
            <div>
              <div className="text-xs text-muted-foreground">Total SKUs</div>
              <div className="font-bold text-lg">{summaryStats.total}</div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <div>
              <div className="text-xs text-muted-foreground">Critical Stock</div>
              <div className="font-bold text-lg text-red-600">{summaryStats.critical}</div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-orange-600" />
            <div>
              <div className="text-xs text-muted-foreground">Need Reorder</div>
              <div className="font-bold text-lg text-orange-600">{summaryStats.needReorder}</div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-600" />
            <div>
              <div className="text-xs text-muted-foreground">Forecasted Profit</div>
              <div className="font-bold text-lg text-green-600">${summaryStats.totalForecastedProfit.toFixed(0)}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderForecastTable = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Forecast Analysis Results</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filterBy} onValueChange={setFilterBy}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Items</SelectItem>
                <SelectItem value="reorder-needed">Reorder Needed</SelectItem>
                <SelectItem value="critical">Critical Stock</SelectItem>
                <SelectItem value="high-missed-profit">High Missed Profit</SelectItem>
                <SelectItem value="profitable">Profitable Items</SelectItem>
                <SelectItem value="negative-roi">Negative ROI</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="urgency">Urgency</SelectItem>
                <SelectItem value="days-left">Days Left</SelectItem>
                <SelectItem value="profit">Profit</SelectItem>
                <SelectItem value="reorder-qty">Reorder Qty</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => setShowExportFilters(!showExportFilters)}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Export Filters
            </Button>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => exportForecastData(false)}
                disabled={forecastData.length === 0}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export All
              </Button>
              <Button
                onClick={() => exportForecastData(true)}
                disabled={filteredAndSortedData.filter(item => item.reorder_quantity_required > 0).length === 0}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export Reorders
              </Button>
            </div>
          </div>
        </div>
        {showExportFilters && (
          <div className="mt-4 p-4 bg-muted/50 rounded-lg border">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  Minimum Margin (%)
                </label>
                <input
                  type="number"
                  value={exportMinMargin}
                  onChange={(e) => setExportMinMargin(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="0"
                  min="0"
                  max="100"
                />
                <p className="text-xs text-muted-foreground">
                  Exclude products below this margin percentage
                </p>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Export Options
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="reorder-only"
                    checked={exportReorderOnly}
                    onChange={(e) => setExportReorderOnly(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="reorder-only" className="text-sm">
                    Only reorder items (qty &gt; 0)
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Exclude items that don't need reordering
                </p>
              </div>
            </div>
            
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Filters will be applied to both "Export All" and "Export Reorders" buttons
              </div>
              <Button
                onClick={() => {
                  setExportMinMargin(0);
                  setExportReorderOnly(false);
                }}
                variant="ghost"
                size="sm"
              >
                Clear Filters
              </Button>
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Showing {filteredAndSortedData.length} of {forecastData.length} SKUs 
          {forecastData.length > 0 && ` • ${forecastData[0]?.forecast_period_months || forecastPeriodMonths} month forecast period`}
        </p>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-auto max-h-[600px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Status</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">SKU</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Product Title</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Stock</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Inbound</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Sales/Day</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Days Left</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Forecast ({forecastPeriodMonths} mo)</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Reorder Qty</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Margin</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedData.map((item) => (
                 <tr key={item.id} className={getRowClassName(item.urgency_level)}>
                   <td className="px-3 py-2">
                     {getUrgencyBadge(item.urgency_level)}
                   </td>
                   <td className="px-3 py-2 font-mono text-xs">{item.inventory.sku}</td>
                   <td className="px-3 py-2 max-w-48 truncate" title={item.inventory.title || 'N/A'}>
                     {item.inventory.title || 'N/A'}
                   </td>
                   <td className="px-3 py-2 text-right">{item.inventory.fba_fbm_stock}</td>
                   <td className="px-3 py-2 text-right">{item.inventory.sent_to_fba || 0}</td>
                   <td className="px-3 py-2 text-right">
                     {item.inventory.estimated_sales_velocity?.toFixed(1) || '0.0'}
                   </td>
                   <td className="px-3 py-2 text-right">
                     {item.days_of_stock_remaining === 999999 ? '∞' : 
                      item.days_of_stock_remaining === 0 ? 'N/A' : 
                      Math.round(item.days_of_stock_remaining)}
                   </td>
                   <td className="px-3 py-2 text-right">{Math.round(item.forecasted_sales)}</td>
                   <td className="px-3 py-2 text-right">
                     {item.reorder_quantity_required > 0 ? item.reorder_quantity_required : '-'}
                   </td>
                    <td className="px-3 py-2 text-right">
                      {item.inventory.margin > 0 ? `${item.inventory.margin.toFixed(1)}%` : 'N/A'}
                    </td>
                 </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  const renderForecastResults = () => (
    <>
      {renderSummaryCards()}
      {renderForecastTable()}
      <div className="mt-8">
        <ForecastIgnoreControls 
          forecastData={filteredForecastData}
          onIgnoreProducts={loadIgnoredProducts}
        />
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Advanced Inventory Forecast Engine
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Comprehensive forecasting and investment analysis for optimal inventory management.
          </p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={defaultActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="settings" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </TabsTrigger>
              <TabsTrigger value="forecast" className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Forecast Results
              </TabsTrigger>
              <TabsTrigger value="investment" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Investment Analysis
              </TabsTrigger>
            </TabsList>

            <TabsContent value="settings">
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground">
                    Forecast settings are now managed in the main configuration panel above.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="forecast">
              {filteredForecastData.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-8">
                    <p className="text-muted-foreground">
                      {forecastData.length === 0 
                        ? "No forecast data available. Generate a forecast first."
                        : "All products are currently ignored. Check the Ignored Products tab to review your settings."
                      }
                    </p>
                  </CardContent>
                </Card>
               ) : (
                <>
                  {renderCalculationModeInfo()}
                  <div className="space-y-6">{renderForecastResults()}</div>
                </>
               )}
            </TabsContent>

            <TabsContent value="investment">
              <InvestmentAnalysisTable
                inventoryData={inventoryData}
                forecastData={forecastData}
                forecastPeriodMonths={forecastPeriodMonths}
                defaultLeadTime={defaultLeadTime}
                defaultBufferDays={defaultBufferDays}
                safetyStockMultiplier={safetyStockMultiplier}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForecastEngine;