import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw, FileSpreadsheet, TrendingUp, Database, Trash2, ExternalLink, Settings } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import ForecastEngine from './ForecastEngine';
import InteractiveInventoryTable from './InteractiveInventoryTable';
import SupplierManager from './SupplierManager';
import SimpleForecastSettings from './SimpleForecastSettings';
import { ForecastResultsPreview } from './ForecastResultsPreview';
import { ForecastStatusIndicator } from './ForecastStatusIndicator';
import { ForecastWorkflowProgress } from './ForecastWorkflowProgress';
import { useInventoryDatabase } from '@/hooks/use-inventory-database';
import { useForecastSettings, ForecastSettings } from '@/hooks/useForecastSettings';
import { supabase } from "@/integrations/supabase/client";

const InventoryReport = () => {
  const [activeTab, setActiveTab] = useState<string>('upload');
  const [spreadsheetId, setSpreadsheetId] = useState<string>('1U9PtFyNHo_50rIbmffxlvMDQFNsOLgYsl9-N-m5vMKs');
  const [sheetRange, setSheetRange] = useState<string>('Sheet1!A:AM');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    'ASIN', 'SKU', 'Title', 'ROI, %', 'FBA/FBM Stock', 'Stock value', 
    'Estimated Sales Velocity', 'Days  of stock  left', 'Recommended quantity for  reordering', 
    'Running  out of stock', 'Reserved', 'Sent  to FBA', 'Ordered', 'Time to  reorder', 
    'Margin', 'Profit forecast (30 days)', 'Comment', 'Marketplace', 'Manuf. time days',
    'FNSKU', 'Supplier SKU'
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastForecastGenerated, setLastForecastGenerated] = useState<string | null>(null);

  const allAvailableColumns = [
    'ASIN', 'SKU', 'Title', 'ROI, %', 'FBA/FBM Stock', 'Stock value', 
    'Estimated Sales Velocity', 'Days  of stock  left', 'Recommended quantity for  reordering', 
    'Running  out of stock', 'Reserved', 'Sent  to FBA', 'Ordered', 'Time to  reorder', 
    'Margin', 'Profit forecast (30 days)', 'Comment', 'Marketplace', 'Target stock range after new order days',
    'FBA buffer days', 'Manuf. time days', 'Use a Prep Center', 'Shipping to Prep Center days',
    'Shipping to FBA days', 'Box param length', 'Box param width', 'Box param height',
    'Box param Units In Box', 'Color', 'Size', 'Multipack size', 'Item number', 'FNSKU',
    'Recommended ship-in quantity (by Amazon)', 'Recommended ship-in date (by Amazon)', 
    'Historical days of supply', 'Supplier SKU', 'FBA prep. stock Gold Coast', 'FBA prep. stock Prep center 2 stock',
    'FBA prep. stock Prep center 4 stock', 'Missed profit (est)'
  ];
  
  const {
    loading,
    uploadedData,
    forecastData,
    saveInventoryData,
    calculateAndSaveForecast,
    loadUserInventoryData,
    loadForecastData,
    clearUserData,
    updateInventoryItem,
  } = useInventoryDatabase();

  const { settings } = useForecastSettings();

  // Load existing data on component mount
  useEffect(() => {
    loadUserInventoryData();
    if (uploadedData.length > 0) {
      loadForecastData(settings.forecastPeriodMonths);
    }
  }, [loadUserInventoryData, settings.forecastPeriodMonths]);

  // Reload forecast when period changes
  useEffect(() => {
    if (uploadedData.length > 0) {
      loadForecastData(settings.forecastPeriodMonths);
    }
  }, [settings.forecastPeriodMonths, loadForecastData]);

  const syncFromGoogleSheets = async () => {
    if (!spreadsheetId.trim()) {
      toast({
        title: "Missing Spreadsheet ID",
        description: "Please enter a Google Spreadsheet ID.",
        variant: "destructive",
      });
      return;
    }

    setSyncing(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Please log in to sync data');
      }

      const response = await supabase.functions.invoke('sync-google-sheets', {
        body: {
          spreadsheetId: spreadsheetId.trim(),
          range: sheetRange.trim() || 'Sheet1!A:AM',
          selectedColumns: selectedColumns
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to sync from Google Sheets');
      }

      toast({
        title: "Sync Successful",
        description: response.data.message,
      });

      // Reload the data
      await loadUserInventoryData();
      
    } catch (error) {
      console.error('Error syncing from Google Sheets:', error);
      toast({
        title: "Sync Failed",
        description: error.message || "Could not sync from Google Sheets. Please check your configuration.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const extractSpreadsheetId = (url: string) => {
    // Extract spreadsheet ID from Google Sheets URL
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : url;
  };

  const clearData = async () => {
    await clearUserData();
    setSpreadsheetId('');
  };

  const toggleColumn = (column: string) => {
    setSelectedColumns(prev => 
      prev.includes(column) 
        ? prev.filter(c => c !== column)
        : [...prev, column]
    );
  };

  const generateForecast = async (forecastSettings: ForecastSettings) => {
    if (uploadedData.length === 0) {
      toast({
        title: "No Data",
        description: "Please upload inventory data first.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const settings = {
        leadTimeDays: forecastSettings.leadTimeDays,
        bufferDays: forecastSettings.bufferDays,
        safetyStockMultiplier: forecastSettings.safetyStockMultiplier,
        calculationMode: forecastSettings.calculationMode
      };

      await calculateAndSaveForecast(uploadedData, forecastSettings.forecastPeriodMonths, settings);
      
      // Update last generated timestamp
      setLastForecastGenerated(new Date().toISOString());
      
      toast({
        title: "Forecast Generated",
        description: `Successfully generated ${forecastSettings.forecastPeriodMonths}-month forecast. Switching to results view...`,
      });

      // Auto-navigate to forecast analysis tab after successful generation
      setTimeout(() => {
        setActiveTab('forecast');
      }, 1500);
      
    } catch (error: any) {
      toast({
        title: "Forecast Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSwitchToForecastTab = async () => {
    setActiveTab('forecast');
  };

  return (
    <div className="space-y-6">
      {/* Workflow Progress Indicator */}
      <ForecastWorkflowProgress 
        currentStep={activeTab as any}
        hasData={uploadedData.length > 0}
        hasResults={forecastData.length > 0}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Google Sheets
          </TabsTrigger>
          <TabsTrigger value="manage" disabled={uploadedData.length === 0} className="flex items-center gap-2 relative">
            <Database className="h-4 w-4" />
            Manage Data
            <ForecastStatusIndicator 
              hasData={forecastData.length > 0}
              isGenerating={isGenerating}
              lastGenerated={lastForecastGenerated}
            />
          </TabsTrigger>
          <TabsTrigger value="suppliers" disabled={uploadedData.length === 0} className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Supplier Orders
          </TabsTrigger>
          <TabsTrigger value="forecast" disabled={uploadedData.length === 0} className="flex items-center gap-2 relative">
            <TrendingUp className="h-4 w-4" />
            Forecast Analysis
            <ForecastStatusIndicator 
              hasData={forecastData.length > 0}
              isGenerating={isGenerating}
              lastGenerated={lastForecastGenerated}
            />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Google Sheets Integration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Database Status */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="h-4 w-4 text-blue-600" />
                  <span className="font-medium text-blue-900">Database Status</span>
                </div>
                <p className="text-sm text-blue-700">
                  {uploadedData.length > 0 
                    ? `${uploadedData.length} inventory items in database. Data syncs from Google Sheets.`
                    : 'No inventory data in database. Configure Google Sheets sync to get started.'
                  }
                </p>
                {uploadedData.length > 0 && (
                  <p className="text-xs text-blue-600 mt-1">
                    Last sync: {new Date(uploadedData[0]?.created_at).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Google Sheets Configuration */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">Configure Google Sheets</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Connect your Amazon FBA data from Google Sheets. Your sheet should have columns like: SKU, Title, Stock, Sales Velocity, etc.
                  </p>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="spreadsheet-id">Google Sheets URL or ID</Label>
                      <Input
                        id="spreadsheet-id"
                        placeholder="https://docs.google.com/spreadsheets/d/your-sheet-id/edit or just the ID"
                        value={spreadsheetId}
                        onChange={(e) => setSpreadsheetId(extractSpreadsheetId(e.target.value))}
                        disabled={syncing}
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="sheet-range">Sheet Range (optional)</Label>
                      <Input
                        id="sheet-range"
                        placeholder="Sheet1!A:AM"
                        value={sheetRange}
                        onChange={(e) => setSheetRange(e.target.value)}
                        disabled={syncing}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Specify the sheet name and range (e.g., "Sheet1!A:AM" for columns A through AM)
                      </p>
                    </div>

                    <div>
                      <Label className="flex items-center gap-2">
                        <Settings className="h-4 w-4" />
                        Select Columns to Import (Essential for Forecasting)
                      </Label>
                      <div className="mt-2 max-h-48 overflow-y-auto border rounded p-3 space-y-2 bg-gray-50">
                        {allAvailableColumns.map((column) => (
                          <div key={column} className="flex items-center space-x-2">
                            <Checkbox
                              id={column}
                              checked={selectedColumns.includes(column)}
                              onCheckedChange={() => toggleColumn(column)}
                            />
                            <Label 
                              htmlFor={column} 
                              className={`text-xs cursor-pointer ${
                                selectedColumns.includes(column) 
                                  ? 'font-medium text-green-700' 
                                  : 'text-gray-500'
                              }`}
                            >
                              {column}
                            </Label>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {selectedColumns.length} columns selected. Focus on essential forecasting data only.
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <Button 
                        onClick={syncFromGoogleSheets} 
                        disabled={syncing || !spreadsheetId.trim()}
                        className="flex items-center gap-2"
                      >
                        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? 'Syncing...' : 'Sync Selected Columns'}
                      </Button>
                      
                      <Button 
                        variant="outline" 
                        onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')}
                        className="flex items-center gap-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        API Setup Guide
                      </Button>
                    </div>
                    
                    {uploadedData.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={clearData} disabled={syncing}>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Clear All Data
                        </Button>
                        <span className="text-sm text-green-600">
                          {uploadedData.length} items in database
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Setup Instructions */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h4 className="font-medium text-yellow-900 mb-2">Setup Required</h4>
                <p className="text-sm text-yellow-700 mb-2">
                  To use Google Sheets integration, you need to:
                </p>
                <ol className="text-sm text-yellow-700 list-decimal list-inside space-y-1">
                  <li>Enable Google Sheets API in Google Cloud Console</li>
                  <li>Create an API key with Sheets API access</li>
                  <li>Configure the API key in Supabase secrets as "GOOGLE_SHEETS_API_KEY"</li>
                  <li>Make your Google Sheet publicly readable or share it properly</li>
                </ol>
              </div>

              {/* Data Preview Section */}
              {uploadedData.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Database Preview</h3>
                  <div className="border rounded-lg overflow-auto max-h-96">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">SKU</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Title</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Stock</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Stock Value</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Sales Velocity</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Margin</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-700 border-b">Upload Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadedData.slice(0, 10).map((row, index) => (
                          <tr key={index} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs">{row.sku}</td>
                            <td className="px-3 py-2 truncate max-w-48" title={row.title}>
                              {row.title || 'N/A'}
                            </td>
                            <td className="px-3 py-2 text-right">{row.fba_fbm_stock}</td>
                            <td className="px-3 py-2 text-right">${row.stock_value?.toFixed(2) || '0.00'}</td>
                            <td className="px-3 py-2 text-right">{row.estimated_sales_velocity?.toFixed(1) || '0.0'}</td>
                            <td className="px-3 py-2 text-right">{row.margin?.toFixed(1) || '0.0'}%</td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {new Date(row.created_at).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {uploadedData.length > 10 && (
                      <div className="px-3 py-2 text-center text-sm text-gray-500 bg-gray-50">
                        ... and {uploadedData.length - 10} more items
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manage">
          <div className="space-y-6">
            {/* Forecast Results Preview */}
            <ForecastResultsPreview
              forecastData={forecastData}
              lastGenerated={lastForecastGenerated}
              onViewFullAnalysis={() => setActiveTab('forecast')}
              isOutdated={false} // TODO: Implement logic to detect if settings changed
            />
            
            <InteractiveInventoryTable
              data={uploadedData}
              onDataUpdate={loadUserInventoryData}
              onGenerateForecast={(customSettings) => generateForecast(customSettings || settings)}
              onSwitchToForecastTab={handleSwitchToForecastTab}
              isGenerating={isGenerating}
            />
          </div>
        </TabsContent>

        <TabsContent value="suppliers">
          <SupplierManager
            inventoryData={uploadedData}
            onDataUpdate={loadUserInventoryData}
          />
        </TabsContent>

        <TabsContent value="forecast">
          <div className="space-y-4">
            {/* Quick Action Bar */}
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
              <div className="flex items-center gap-4">
                <div>
                  <h3 className="font-medium">Forecast Analysis</h3>
                  <p className="text-sm text-muted-foreground">
                    {forecastData.length > 0 
                      ? `Viewing ${forecastData.length} products with ${settings.forecastPeriodMonths}-month forecast`
                      : 'No forecast data available'
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setActiveTab('manage')}
                  size="sm"
                >
                  Back to Data
                </Button>
                <Button 
                  onClick={() => generateForecast(settings)}
                  disabled={isGenerating || uploadedData.length === 0}
                  size="sm"
                >
                  {isGenerating ? "Generating..." : "Regenerate Forecast"}
                </Button>
              </div>
            </div>

            <SimpleForecastSettings
              onGenerate={generateForecast}
              isGenerating={isGenerating}
            />
            
            {forecastData.length > 0 && (
              <ForecastEngine
                inventoryData={uploadedData}
                forecastData={forecastData}
                forecastPeriodMonths={settings.forecastPeriodMonths}
                onForecastPeriodChange={() => {}} // Handled by settings component now
                onGenerateForecast={() => {}} // Handled by settings component now
                loading={loading}
                defaultActiveTab="forecast"
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InventoryReport;