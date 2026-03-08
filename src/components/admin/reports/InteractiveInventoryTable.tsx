import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Edit, Save, X, Calculator, Settings, Eye, EyeOff, Zap, TrendingUp, Sliders } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from '@/integrations/supabase/client';
import { InventoryRawData } from '@/hooks/use-inventory-database';
import { useForecastCalculations } from '@/hooks/use-forecast-calculations';
import { useIgnoredProducts } from '@/hooks/use-ignored-products';
import { useForecastSettings, ForecastSettings } from '@/hooks/useForecastSettings';
import { QuickSettingsModal } from './QuickSettingsModal';
import { SettingsPreviewCard } from './SettingsPreviewCard';


interface InteractiveInventoryTableProps {
  data: InventoryRawData[];
  onDataUpdate: () => void;
  onGenerateForecast: (settings?: ForecastSettings) => void;
  onSwitchToForecastTab?: (forecastMonths?: number) => void;
  isGenerating?: boolean;
}


interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  editable: boolean;
  type: 'text' | 'number' | 'currency' | 'date' | 'percentage';
  width?: string;
}

interface EditingCell {
  rowId: string;
  field: string;
  value: string;
}

const EDITABLE_FIELDS = {
  'manuf_time_days': { label: 'Lead Time (Days)', type: 'number', description: 'Days from order to arrival' },
  'fba_buffer_days': { label: 'Buffer Days', type: 'number', description: 'Safety stock buffer' },
  'estimated_sales_velocity': { label: 'Sales Velocity', type: 'number', description: 'Units sold per day' },
  'margin': { label: 'Margin', type: 'number', description: 'Profit margin per unit' },
  'supplier_name': { label: 'Supplier', type: 'text', description: 'Supplier name' },
  'supplier_sku': { label: 'Supplier SKU', type: 'text', description: 'Supplier part number' },
  'comment': { label: 'Notes', type: 'text', description: 'Internal notes' },
} as const;

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: 'urgency', label: 'Status', visible: true, editable: false, type: 'text', width: 'w-24' },
  { key: 'sku', label: 'SKU', visible: true, editable: false, type: 'text', width: 'w-32' },
  { key: 'title', label: 'Product Title', visible: true, editable: false, type: 'text', width: 'min-w-48' },
  { key: 'fba_fbm_stock', label: 'Stock', visible: true, editable: false, type: 'number', width: 'w-20' },
  { key: 'estimated_sales_velocity', label: 'Velocity', visible: true, editable: true, type: 'number', width: 'w-20' },
  { key: 'manuf_time_days', label: 'Lead Time', visible: true, editable: true, type: 'number', width: 'w-24' },
  { key: 'fba_buffer_days', label: 'Buffer Days', visible: true, editable: true, type: 'number', width: 'w-24' },
  { key: 'margin', label: 'Margin', visible: true, editable: true, type: 'percentage', width: 'w-20' },
  { key: 'supplier_name', label: 'Supplier', visible: true, editable: true, type: 'text', width: 'w-32' },
  { key: 'supplier_sku', label: 'Supplier SKU', visible: true, editable: true, type: 'text', width: 'w-32' },
  { key: 'comment', label: 'Notes', visible: true, editable: true, type: 'text', width: 'w-48' },
  { key: 'asin', label: 'ASIN', visible: false, editable: false, type: 'text', width: 'w-32' },
  { key: 'roi_percent', label: 'ROI %', visible: false, editable: false, type: 'number', width: 'w-20' },
  { key: 'stock_value', label: 'Stock Value', visible: false, editable: false, type: 'currency', width: 'w-24' },
  { key: 'days_of_stock_left', label: 'Days Left', visible: false, editable: false, type: 'number', width: 'w-20' },
  { key: 'recommended_quantity_for_reordering', label: 'Reorder Qty', visible: false, editable: false, type: 'number', width: 'w-24' },
  { key: 'running_out_of_stock', label: 'Stock Status', visible: false, editable: false, type: 'text', width: 'w-24' },
  { key: 'reserved', label: 'Reserved', visible: false, editable: false, type: 'number', width: 'w-20' },
  { key: 'sent_to_fba', label: 'Inbound (FBA)', visible: true, editable: false, type: 'number', width: 'w-24' },
  { key: 'ordered', label: 'Ordered', visible: false, editable: false, type: 'number', width: 'w-20' },
  { key: 'marketplace', label: 'Marketplace', visible: false, editable: false, type: 'text', width: 'w-24' },
  { key: 'fnsku', label: 'FNSKU', visible: false, editable: false, type: 'text', width: 'w-32' },
];

const InteractiveInventoryTable: React.FC<InteractiveInventoryTableProps> = ({
  data,
  onDataUpdate,
  onGenerateForecast,
  onSwitchToForecastTab,
  isGenerating = false
}) => {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_COLUMNS);
  const [showCustomSettings, setShowCustomSettings] = useState(false);
  
  const { calculateAndSaveForecast, forecastData, loadForecastData } = useForecastCalculations();
  const { filterInventoryData, filterForecastData } = useIgnoredProducts();
  const { settings, isLoading: settingsLoading, saveSettings } = useForecastSettings();

  const handleCustomForecast = (customSettings: ForecastSettings, saveAsDefault?: boolean) => {
    if (saveAsDefault) {
      saveSettings(customSettings);
    }
    onGenerateForecast(customSettings);
  };

  const handleStartEdit = (rowId: string, field: string, currentValue: any) => {
    setEditingCell({
      rowId,
      field,
      value: currentValue?.toString() || ''
    });
  };

  const handleSaveEdit = async () => {
    if (!editingCell) return;

    setSaving(true);
    try {
      const { field, value, rowId } = editingCell;
      
      // Parse value based on field type
      let parsedValue: any = value;
      if (EDITABLE_FIELDS[field as keyof typeof EDITABLE_FIELDS]?.type === 'number') {
        parsedValue = value === '' ? null : parseInt(value) || null;
      }

      const { error } = await supabase
        .from('uploaded_inventory_raw')
        .update({ [field]: parsedValue, updated_at: new Date().toISOString() })
        .eq('id', rowId);

      if (error) throw error;

      setEditingCell(null);
      onDataUpdate();
      
      toast({
        title: "Updated",
        description: `${EDITABLE_FIELDS[field as keyof typeof EDITABLE_FIELDS]?.label} updated successfully.`,
      });
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const formatCellValue = (value: any, column: ColumnConfig) => {
    if (value === null || value === undefined) return '-';
    
    switch (column.type) {
      case 'currency':
        return typeof value === 'number' ? `$${value.toFixed(2)}` : '-';
      case 'percentage':
        return typeof value === 'number' ? `${value.toFixed(2)}%` : '-';
      case 'number':
        return typeof value === 'number' ? value.toString() : value?.toString() || '-';
      case 'date':
        return value ? new Date(value).toLocaleDateString() : '-';
      default:
        return value?.toString() || '-';
    }
  };

  const toggleColumnVisibility = (columnKey: string) => {
    setColumns(prev => 
      prev.map(col => 
        col.key === columnKey ? { ...col, visible: !col.visible } : col
      )
    );
  };

  const resetColumns = () => {
    setColumns(DEFAULT_COLUMNS);
  };


  const visibleColumns = columns.filter(col => col.visible);

  const getUrgencyBadge = (row: InventoryRawData) => {
    const daysLeft = row.days_of_stock_left || 0;
    const salesVelocity = row.estimated_sales_velocity || 0;
    
    if (salesVelocity === 0 || row.fba_fbm_stock === 0) {
      return <Badge variant="secondary">Inactive</Badge>;
    }
    if (daysLeft < 30) {
      return <Badge variant="destructive">Critical</Badge>;
    }
    if (daysLeft < 60) {
      return <Badge variant="outline">Warning</Badge>;
    }
    return <Badge variant="default">Good</Badge>;
  };

  const renderCell = (row: InventoryRawData, column: ColumnConfig) => {
    const value = row[column.key as keyof InventoryRawData];

    // Special cases for non-data columns
    if (column.key === 'urgency') {
      return getUrgencyBadge(row);
    }

    // Handle editable columns
    if (column.editable && EDITABLE_FIELDS[column.key as keyof typeof EDITABLE_FIELDS]) {
      const isEditing = editingCell?.rowId === row.id && editingCell?.field === column.key;
      const fieldConfig = EDITABLE_FIELDS[column.key as keyof typeof EDITABLE_FIELDS];

      if (isEditing) {
        return (
          <div className="flex items-center gap-1">
            <Input
              type={fieldConfig.type}
              value={editingCell.value}
              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
              onKeyDown={handleKeyPress}
              className="h-8 text-xs"
              autoFocus
              disabled={saving}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSaveEdit}
              disabled={saving}
              className="h-8 w-8 p-0"
            >
              <Save className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancelEdit}
              disabled={saving}
              className="h-8 w-8 p-0"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      }

      return (
        <div
          className="group flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded px-2 py-1"
          onClick={() => handleStartEdit(row.id, column.key, value)}
          title={`Click to edit ${fieldConfig.label}`}
        >
          <span className="text-xs">
            {formatCellValue(value, column)}
          </span>
          <Edit className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      );
    }

    // Handle special formatting for specific columns
    if (column.key === 'title') {
      return (
        <div className="truncate" title={value?.toString()}>
          {value || 'N/A'}
        </div>
      );
    }

    if (column.key === 'sku') {
      return <span className="font-mono text-xs">{value}</span>;
    }

    // Default rendering
    return (
      <span className="text-xs">
        {formatCellValue(value, column)}
      </span>
    );
  };

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <p className="text-muted-foreground">No inventory data available. Please upload data first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Interactive Amazon FBA Data Management
          </CardTitle>
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Columns ({visibleColumns.length})
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Column Visibility</SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={resetColumns}>
                      Reset Default
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {visibleColumns.length} of {columns.length} columns visible
                    </span>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {columns.map((column) => (
                      <div key={column.key} className="flex items-center space-x-2">
                        <Checkbox
                          id={column.key}
                          checked={column.visible}
                          onCheckedChange={() => toggleColumnVisibility(column.key)}
                        />
                        <div className="flex-1">
                          <label 
                            htmlFor={column.key} 
                            className="text-sm font-medium cursor-pointer"
                          >
                            {column.label}
                          </label>
                          {column.editable && (
                            <span className="ml-2 text-xs text-green-600">(Editable)</span>
                          )}
                        </div>
                        {column.visible ? (
                          <Eye className="h-4 w-4 text-green-600" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            
            <Button 
              variant="outline" 
              size="sm" 
              className="flex items-center gap-2"
              onClick={() => {
                if (onSwitchToForecastTab) {
                  onSwitchToForecastTab();
                }
              }}
            >
              <TrendingUp className="h-4 w-4" />
              Go to Forecast Analysis
            </Button>
          </div>
        </div>
        
        {/* Settings Preview and Generate Buttons */}
        <div className="mt-4 space-y-4">
          <SettingsPreviewCard settings={settings} isLoading={settingsLoading} />
          
          <div className="flex items-center gap-2">
            <Button 
              onClick={() => onGenerateForecast(settings)} 
              className="flex items-center gap-2"
              disabled={isGenerating}
            >
              <Calculator className="h-4 w-4" />
              {isGenerating ? "Generating..." : "Generate with Saved Settings"}
            </Button>
            
            <Button 
              variant="outline"
              onClick={() => setShowCustomSettings(true)}
              className="flex items-center gap-2"
              disabled={isGenerating}
            >
              <Sliders className="h-4 w-4" />
              Custom Settings
            </Button>
          </div>
        </div>
        
        <p className="text-sm text-muted-foreground">
          Click on operational fields to edit them inline. Changes are saved automatically. Use "Custom Settings" to modify forecast parameters.
        </p>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                {visibleColumns.map((column) => (
                  <TableHead 
                    key={column.key} 
                    className={`${column.width || 'min-w-24'} ${
                      column.type === 'number' || column.type === 'currency' ? 'text-right' : ''
                    }`}
                  >
                    {column.label}
                    {column.editable && <span className="ml-1 text-xs text-green-600">✏️</span>}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/50">
                  {visibleColumns.map((column) => (
                    <TableCell 
                      key={column.key} 
                      className={`${
                        column.type === 'number' || column.type === 'currency' ? 'text-right' : ''
                      } ${column.key === 'title' ? 'max-w-48' : ''}`}
                    >
                      {renderCell(row, column)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        <div className="mt-4 text-sm text-muted-foreground">
          <p><strong>Tips:</strong></p>
          <ul className="list-disc list-inside space-y-1">
            <li>Click any operational field to edit it inline</li>
            <li>Press Enter to save or Escape to cancel</li>
            <li>Lead time affects reorder calculations</li>
            <li>Buffer days provide safety stock cushion</li>
            <li>Status badges: Critical (&lt;30 days), Warning (&lt;60 days), Good (60+ days)</li>
          </ul>
        </div>
      </CardContent>
      
      {/* Custom Settings Modal */}
      <QuickSettingsModal
        isOpen={showCustomSettings}
        onClose={() => setShowCustomSettings(false)}
        onGenerate={handleCustomForecast}
        currentSettings={settings}
        isGenerating={isGenerating}
      />
    </Card>
  );
};

export default InteractiveInventoryTable;