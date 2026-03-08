
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface SheetInfo {
  name: string;
  data: any[];
  headers: string[];
}

interface SheetSelectorProps {
  sheets: { [key: string]: SheetInfo };
  onSheetsSelected: (selectedSheets: string[]) => void;
  onCancel: () => void;
}

export default function SheetSelector({ sheets, onSheetsSelected, onCancel }: SheetSelectorProps) {
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [previewSheet, setPreviewSheet] = useState<string | null>(null);

  const handleSheetToggle = (sheetName: string) => {
    setSelectedSheets(prev => 
      prev.includes(sheetName) 
        ? prev.filter(s => s !== sheetName)
        : [...prev, sheetName]
    );
  };

  const handleSelectAll = () => {
    setSelectedSheets(Object.keys(sheets));
  };

  const handleClearAll = () => {
    setSelectedSheets([]);
  };

  const handleConfirm = () => {
    if (selectedSheets.length > 0) {
      onSheetsSelected(selectedSheets);
    }
  };

  const getSheetPreview = (sheetName: string) => {
    const sheet = sheets[sheetName];
    return sheet.data.slice(0, 5); // First 5 rows for preview
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Select Sheets to Analyze
        </CardTitle>
        <p className="text-sm text-gray-600">
          Your Excel file contains multiple sheets. Choose which ones you'd like to analyze.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selection Controls */}
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={handleClearAll}>
              Clear All
            </Button>
          </div>
          <div className="text-sm text-gray-500">
            {selectedSheets.length} of {Object.keys(sheets).length} sheets selected
          </div>
        </div>

        {/* Sheet List */}
        <div className="space-y-3">
          {Object.entries(sheets).map(([sheetName, sheetInfo]) => (
            <div key={sheetName} className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={selectedSheets.includes(sheetName)}
                    onCheckedChange={() => handleSheetToggle(sheetName)}
                  />
                  <div>
                    <h4 className="font-medium">{sheetName}</h4>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary">
                        {sheetInfo.data.length} rows
                      </Badge>
                      <Badge variant="secondary">
                        {sheetInfo.headers.length} columns
                      </Badge>
                    </div>
                  </div>
                </div>
                
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" onClick={() => setPreviewSheet(sheetName)}>
                      <Eye className="h-4 w-4 mr-1" />
                      Preview
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
                    <DialogHeader>
                      <DialogTitle>Preview: {sheetName}</DialogTitle>
                    </DialogHeader>
                    <div className="mt-4">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {sheetInfo.headers.map((header, index) => (
                              <TableHead key={index} className="font-medium">
                                {header}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {getSheetPreview(sheetName).map((row, rowIndex) => (
                            <TableRow key={rowIndex}>
                              {sheetInfo.headers.map((header, colIndex) => (
                                <TableCell key={colIndex} className="max-w-32 truncate">
                                  {String(row[header] || '')}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {sheetInfo.data.length > 5 && (
                        <p className="text-sm text-gray-500 mt-2">
                          Showing first 5 rows of {sheetInfo.data.length} total rows
                        </p>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              
              {/* Column Headers Preview */}
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">Columns:</p>
                <div className="flex flex-wrap gap-1">
                  {sheetInfo.headers.slice(0, 8).map((header, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {header}
                    </Badge>
                  ))}
                  {sheetInfo.headers.length > 8 && (
                    <Badge variant="outline" className="text-xs">
                      +{sheetInfo.headers.length - 8} more
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={selectedSheets.length === 0}
          >
            Analyze Selected Sheets ({selectedSheets.length})
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
