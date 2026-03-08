
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calculator, Filter, BarChart3, Download, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface DataManipulationToolsProps {
  data: any[];
  headers: string[];
  onDataUpdate: (newData: any[]) => void;
}

interface FilterRule {
  id: string;
  column: string;
  operator: string;
  value: string;
}

interface CalculatedColumn {
  id: string;
  name: string;
  formula: string;
  description: string;
}

export default function DataManipulationTools({ data, headers, onDataUpdate }: DataManipulationToolsProps) {
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [calculatedColumns, setCalculatedColumns] = useState<CalculatedColumn[]>([]);
  const [activeView, setActiveView] = useState<'filters' | 'calculations' | 'summary'>('filters');
  const { toast } = useToast();

  // Apply filters to data
  const filteredData = useMemo(() => {
    let result = [...data];
    
    filterRules.forEach(rule => {
      if (rule.column && rule.operator && rule.value) {
        result = result.filter(row => {
          const cellValue = row[rule.column];
          const filterValue = rule.value;
          
          switch (rule.operator) {
            case 'equals':
              return String(cellValue).toLowerCase() === filterValue.toLowerCase();
            case 'contains':
              return String(cellValue).toLowerCase().includes(filterValue.toLowerCase());
            case 'greater':
              return Number(cellValue) > Number(filterValue);
            case 'less':
              return Number(cellValue) < Number(filterValue);
            case 'not_empty':
              return cellValue && String(cellValue).trim() !== '';
            default:
              return true;
          }
        });
      }
    });

    return result;
  }, [data, filterRules]);

  // Apply calculated columns
  const processedData = useMemo(() => {
    return filteredData.map(row => {
      const newRow = { ...row };
      
      calculatedColumns.forEach(calc => {
        try {
          // Simple formula evaluation for common metrics
          if (calc.formula.includes('CTR')) {
            const clicks = Number(row['Clicks'] || row['clicks'] || 0);
            const impressions = Number(row['Impressions'] || row['impressions'] || 0);
            newRow[calc.name] = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) + '%' : '0%';
          } else if (calc.formula.includes('CPC')) {
            const spend = Number(row['Spend'] || row['Cost'] || row['spend'] || row['cost'] || 0);
            const clicks = Number(row['Clicks'] || row['clicks'] || 0);
            newRow[calc.name] = clicks > 0 ? (spend / clicks).toFixed(2) : '0';
          } else if (calc.formula.includes('ROAS')) {
            const revenue = Number(row['Revenue'] || row['revenue'] || row['Sales'] || row['sales'] || 0);
            const spend = Number(row['Spend'] || row['Cost'] || row['spend'] || row['cost'] || 0);
            newRow[calc.name] = spend > 0 ? (revenue / spend).toFixed(2) : '0';
          }
        } catch (error) {
          newRow[calc.name] = 'Error';
        }
      });
      
      return newRow;
    });
  }, [filteredData, calculatedColumns]);

  const processedHeaders = [...headers, ...calculatedColumns.map(calc => calc.name)];

  const addFilterRule = () => {
    const newRule: FilterRule = {
      id: Math.random().toString(36).substr(2, 9),
      column: '',
      operator: 'equals',
      value: ''
    };
    setFilterRules([...filterRules, newRule]);
  };

  const updateFilterRule = (id: string, field: keyof FilterRule, value: string) => {
    setFilterRules(rules => rules.map(rule => 
      rule.id === id ? { ...rule, [field]: value } : rule
    ));
  };

  const removeFilterRule = (id: string) => {
    setFilterRules(rules => rules.filter(rule => rule.id !== id));
  };

  const addCalculatedColumn = (type: 'CTR' | 'CPC' | 'ROAS' | 'custom') => {
    const calculations = {
      CTR: { name: 'CTR', formula: 'CTR = (Clicks / Impressions) * 100', description: 'Click-through rate percentage' },
      CPC: { name: 'CPC', formula: 'CPC = Spend / Clicks', description: 'Cost per click' },
      ROAS: { name: 'ROAS', formula: 'ROAS = Revenue / Spend', description: 'Return on ad spend' }
    };

    const calc = calculations[type];
    if (calc) {
      const newColumn: CalculatedColumn = {
        id: Math.random().toString(36).substr(2, 9),
        name: calc.name,
        formula: calc.formula,
        description: calc.description
      };
      setCalculatedColumns([...calculatedColumns, newColumn]);
    }
  };

  const removeCalculatedColumn = (id: string) => {
    setCalculatedColumns(cols => cols.filter(col => col.id !== id));
  };

  const applyChanges = () => {
    onDataUpdate(processedData);
  };

  const exportProcessedData = () => {
    // Ensure Amazon-compatible format with operation column
    const amazonCompatibleData = processedData.map(row => {
      const newRow = { ...row };
      
      // Add or preserve operation column for Amazon bulk operations
      if (!newRow.operation && !newRow.Operation) {
        newRow.operation = 'update'; // Default Amazon operation
      }
      
      // Ensure operation column is first (Amazon requirement)
      const { operation, Operation, ...otherData } = newRow;
      const operationValue = operation || Operation || 'update';
      
      return {
        operation: operationValue,
        ...otherData
      };
    });

    const ws = XLSX.utils.json_to_sheet(amazonCompatibleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Amazon Upload');
    
    const fileName = `amazon_upload_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    toast({
      title: "Amazon-Compatible Export",
      description: "File exported with proper operation column for Amazon bulk upload",
    });
  };

  const createSummaryData = () => {
    if (processedData.length === 0) return [];

    const numericColumns = processedHeaders.filter(header => {
      const sample = processedData[0][header];
      return !isNaN(Number(sample)) && sample !== '';
    });

    return numericColumns.map(column => {
      const values = processedData.map(row => Number(row[column]) || 0);
      return {
        Column: column,
        Total: values.reduce((sum, val) => sum + val, 0).toFixed(2),
        Average: (values.reduce((sum, val) => sum + val, 0) / values.length).toFixed(2),
        Max: Math.max(...values).toFixed(2),
        Min: Math.min(...values).toFixed(2),
        Count: processedData.length
      };
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Data Manipulation Tools
        </CardTitle>
        <div className="flex gap-2">
          <Button 
            variant={activeView === 'filters' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveView('filters')}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters ({filterRules.length})
          </Button>
          <Button 
            variant={activeView === 'calculations' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveView('calculations')}
          >
            <Calculator className="h-4 w-4 mr-2" />
            Calculations ({calculatedColumns.length})
          </Button>
          <Button 
            variant={activeView === 'summary' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setActiveView('summary')}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Summary
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {activeView === 'filters' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-medium">Data Filters</h4>
              <Button onClick={addFilterRule} size="sm">Add Filter</Button>
            </div>
            
            {filterRules.map(rule => (
              <div key={rule.id} className="flex gap-2 items-center p-3 border rounded-lg">
                <Select value={rule.column} onValueChange={(value) => updateFilterRule(rule.id, 'column', value)}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {headers.map(header => (
                      <SelectItem key={header} value={header}>{header}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select value={rule.operator} onValueChange={(value) => updateFilterRule(rule.id, 'operator', value)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equals">Equals</SelectItem>
                    <SelectItem value="contains">Contains</SelectItem>
                    <SelectItem value="greater">Greater than</SelectItem>
                    <SelectItem value="less">Less than</SelectItem>
                    <SelectItem value="not_empty">Not empty</SelectItem>
                  </SelectContent>
                </Select>
                
                <Input 
                  placeholder="Value"
                  value={rule.value}
                  onChange={(e) => updateFilterRule(rule.id, 'value', e.target.value)}
                  className="flex-1"
                />
                
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => removeFilterRule(rule.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            
            <div className="text-sm text-muted-foreground">
              Filtered data: {filteredData.length} of {data.length} rows
            </div>
          </div>
        )}

        {activeView === 'calculations' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-medium">Calculated Columns</h4>
              <div className="flex gap-2">
                <Button onClick={() => addCalculatedColumn('CTR')} size="sm" variant="outline">
                  Add CTR
                </Button>
                <Button onClick={() => addCalculatedColumn('CPC')} size="sm" variant="outline">
                  Add CPC
                </Button>
                <Button onClick={() => addCalculatedColumn('ROAS')} size="sm" variant="outline">
                  Add ROAS
                </Button>
              </div>
            </div>
            
            {calculatedColumns.map(calc => (
              <div key={calc.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <div className="font-medium">{calc.name}</div>
                  <div className="text-sm text-muted-foreground">{calc.description}</div>
                  <Badge variant="outline" className="text-xs mt-1">{calc.formula}</Badge>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => removeCalculatedColumn(calc.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {activeView === 'summary' && (
          <div className="space-y-4">
            <h4 className="font-medium">Data Summary</h4>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border">
                <thead>
                  <tr className="bg-muted">
                    {['Column', 'Total', 'Average', 'Max', 'Min', 'Count'].map(header => (
                      <th key={header} className="border p-2 text-left font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {createSummaryData().map((row, index) => (
                    <tr key={index}>
                      {Object.values(row).map((value, i) => (
                        <td key={i} className="border p-2">
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t">
          <Button onClick={applyChanges}>
            Apply Changes
          </Button>
          <Button onClick={exportProcessedData} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export for Amazon Upload
          </Button>
          <div className="ml-auto text-sm text-muted-foreground">
            {processedData.length} rows, {processedHeaders.length} columns
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
