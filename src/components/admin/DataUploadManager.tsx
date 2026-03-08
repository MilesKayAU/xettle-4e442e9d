import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileSpreadsheet, Brain, Download, Trash2, AlertCircle, Layers, Bot, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import SheetSelector from './SheetSelector';
import DataTable from './DataTable';
import AIDataOrchestrator from './AIDataOrchestrator';
import DataManipulationTools from './DataManipulationTools';

interface DataUpload {
  id: string;
  filename: string;
  file_size: number;
  file_type: string;
  upload_status: string;
  created_at: string;
  raw_data?: any;
  ai_analysis?: any;
  error_message?: string;
}

interface UploadProgress {
  uploading: boolean;
  processing: boolean;
  progress: number;
  message: string;
}

export default function DataUploadManager() {
  const [uploads, setUploads] = useState<DataUpload[]>([]);
  const [selectedUpload, setSelectedUpload] = useState<DataUpload | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    uploading: false,
    processing: false,
    progress: 0,
    message: ''
  });
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [detectedSheets, setDetectedSheets] = useState<any>({});
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [manipulatedData, setManipulatedData] = useState<any>(null);
  const { toast } = useToast();

  const loadUploads = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('data_uploads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUploads(data || []);
    } catch (error) {
      console.error('Error loading uploads:', error);
      toast({
        title: "Error",
        description: "Failed to load uploads",
        variant: "destructive"
      });
    }
  }, [toast]);

  React.useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  const processFileForSheetDetection = async (file: File): Promise<any> => {
    const fileType = file.name.endsWith('.csv') ? 'csv' : 'xlsx';
    
    if (fileType === 'csv') {
      const fileData = await file.text();
      const lines = fileData.split('\n');
      const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''));
      
      const parsedData: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          const values = lines[i].split(',').map((v: string) => v.trim().replace(/"/g, ''));
          const row: any = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          parsedData.push(row);
        }
      }
      
      return { 'Sheet1': { data: parsedData, headers } };
    } else {
      // Process Excel file to detect sheets
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheets: any = {};
      
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        if (jsonData.length > 0) {
          sheets[sheetName] = {
            data: jsonData,
            headers: Object.keys(jsonData[0])
          };
        }
      });
      
      return sheets;
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileType = file.name.endsWith('.csv') ? 'csv' : 'xlsx';
    
    if (!['csv', 'xlsx'].includes(fileType)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a CSV or Excel file",
        variant: "destructive"
      });
      return;
    }

    setPendingFile(file);

    try {
      // Detect sheets
      const sheets = await processFileForSheetDetection(file);
      setDetectedSheets(sheets);
      
      // If only one sheet or it's a CSV, proceed directly
      if (Object.keys(sheets).length === 1) {
        await processUpload(file, Object.keys(sheets));
      } else {
        // Show sheet selector for multi-sheet Excel files
        setShowSheetSelector(true);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      toast({
        title: "File processing failed",
        description: "Could not read the file. Please check the format.",
        variant: "destructive"
      });
    }

    // Reset file input
    event.target.value = '';
  };

  const handleSheetsSelected = async (selectedSheets: string[]) => {
    if (!pendingFile) return;
    
    setShowSheetSelector(false);
    await processUpload(pendingFile, selectedSheets);
    setPendingFile(null);
    setDetectedSheets({});
  };

  const processUpload = async (file: File, selectedSheets: string[]) => {
    const fileType = file.name.endsWith('.csv') ? 'csv' : 'xlsx';

    setUploadProgress({
      uploading: true,
      processing: false,
      progress: 10,
      message: 'Uploading file...'
    });

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: uploadRecord, error: createError } = await supabase
        .from('data_uploads')
        .insert({
          filename: file.name,
          file_size: file.size,
          file_type: fileType,
          upload_status: 'processing',
          user_id: user.id
        })
        .select()
        .single();

      if (createError) throw createError;

      setUploadProgress(prev => ({ ...prev, progress: 30, message: 'Processing file...' }));

      // Process file content based on selected sheets
      let fileData: string;
      
      if (fileType === 'csv') {
        fileData = await file.text();
      } else {
        // For Excel, only include selected sheets
        const filteredSheets: any = {};
        selectedSheets.forEach(sheetName => {
          if (detectedSheets[sheetName]) {
            filteredSheets[sheetName] = detectedSheets[sheetName].data;
          }
        });
        fileData = JSON.stringify(filteredSheets);
      }

      setUploadProgress(prev => ({ ...prev, progress: 60, message: 'Analyzing data with AI...' }));

      const { data: processResult, error: processError } = await supabase.functions.invoke(
        'process-data-upload',
        {
          body: {
            uploadId: uploadRecord.id,
            fileData,
            fileName: file.name,
            fileType,
            selectedSheets
          }
        }
      );

      if (processError) throw processError;

      setUploadProgress(prev => ({ ...prev, progress: 100, message: 'Upload completed!' }));

      toast({
        title: "Success",
        description: `File processed successfully. Found ${processResult.recordCount} records across ${processResult.sheetsProcessed?.length || 1} sheet(s).`,
      });

      loadUploads();
      
      setTimeout(() => {
        setUploadProgress({
          uploading: false,
          processing: false,
          progress: 0,
          message: ''
        });
      }, 2000);

    } catch (error) {
      console.error('Upload error:', error);
      setUploadProgress({
        uploading: false,
        processing: false,
        progress: 0,
        message: ''
      });
      
      toast({
        title: "Upload failed",
        description: error.message || "An error occurred during upload",
        variant: "destructive"
      });
    }
  };

  const deleteUpload = async (uploadId: string) => {
    try {
      const { error } = await supabase
        .from('data_uploads')
        .delete()
        .eq('id', uploadId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Upload deleted successfully",
      });

      loadUploads();
      if (selectedUpload?.id === uploadId) {
        setSelectedUpload(null);
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: "Error",
        description: "Failed to delete upload",
        variant: "destructive"
      });
    }
  };

  const exportProcessedData = (upload: DataUpload) => {
    if (!upload.raw_data) return;

    const processAmazonFormat = (data: any[]) => {
      return data.map(row => {
        const newRow = { ...row };
        
        // Add or preserve operation column for Amazon bulk operations
        if (!newRow.operation && !newRow.Operation) {
          newRow.operation = 'update'; // Default Amazon operation: update, partial_update, delete
        }
        
        // Ensure operation column is first (Amazon requirement)
        const { operation, Operation, ...otherData } = newRow;
        const operationValue = operation || Operation || 'update';
        
        return {
          operation: operationValue,
          ...otherData
        };
      });
    };

    // Handle multi-sheet data
    const wb = XLSX.utils.book_new();
    
    if (typeof upload.raw_data === 'object' && Object.keys(upload.raw_data).length > 1) {
      // Multi-sheet export
      Object.entries(upload.raw_data).forEach(([sheetName, sheetData]: [string, any]) => {
        if (sheetData.data && Array.isArray(sheetData.data)) {
          const amazonData = processAmazonFormat(sheetData.data);
          const ws = XLSX.utils.json_to_sheet(amazonData);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
      });
    } else {
      // Single sheet or legacy format
      const dataToExport = Array.isArray(upload.raw_data) ? upload.raw_data : 
                          upload.raw_data.Sheet1?.data || upload.raw_data;
      const amazonData = processAmazonFormat(dataToExport);
      const ws = XLSX.utils.json_to_sheet(amazonData);
      XLSX.utils.book_append_sheet(wb, ws, 'Amazon Upload');
    }
    
    const fileName = upload.filename.replace(/\.[^/.]+$/, '_amazon_ready.xlsx');
    XLSX.writeFile(wb, fileName);

    toast({
      title: "Amazon-Ready Export",
      description: "File exported with proper operation column for Amazon bulk upload (update/partial_update/delete)",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
      case 'processing':
        return <Badge variant="secondary">Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getAllDataFromSheets = (rawData: any): any[] => {
    if (manipulatedData) return manipulatedData;
    if (Array.isArray(rawData)) return rawData;
    
    if (typeof rawData === 'object') {
      let allData: any[] = [];
      Object.values(rawData).forEach((sheetData: any) => {
        if (sheetData.data && Array.isArray(sheetData.data)) {
          allData = allData.concat(sheetData.data);
        }
      });
      return allData;
    }
    
    return [];
  };

  const getAllHeadersFromSheets = (rawData: any): string[] => {
    if (Array.isArray(rawData) && rawData.length > 0) {
      return Object.keys(rawData[0]);
    }
    
    if (typeof rawData === 'object') {
      let allHeaders: string[] = [];
      Object.values(rawData).forEach((sheetData: any) => {
        if (sheetData.headers && Array.isArray(sheetData.headers)) {
          allHeaders = [...new Set([...allHeaders, ...sheetData.headers])];
        }
      });
      return allHeaders;
    }
    
    return [];
  };

  const handleDataUpdate = (newData: any) => {
    console.log('DataUploadManager - Received new data:', newData);
    console.log('DataUploadManager - Data type:', typeof newData);
    console.log('DataUploadManager - Is array:', Array.isArray(newData));
    if (Array.isArray(newData)) {
      console.log('DataUploadManager - Array length:', newData.length);
      console.log('DataUploadManager - First item:', newData[0]);
    }
    setManipulatedData(newData);
  };

  if (showSheetSelector) {
    return (
      <div className="space-y-6">
        <SheetSelector
          sheets={detectedSheets}
          onSheetsSelected={handleSheetsSelected}
          onCancel={() => {
            setShowSheetSelector(false);
            setPendingFile(null);
            setDetectedSheets({});
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Data Upload & AI Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <label htmlFor="file-upload" className="cursor-pointer">
                <span className="text-sm font-medium text-gray-700">
                  Drop files here or click to upload
                </span>
                <p className="text-xs text-gray-500 mt-1">
                  Supports Excel (.xlsx) and CSV files • Multi-sheet Excel files supported
                </p>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept=".csv,.xlsx"
                  onChange={handleFileUpload}
                  disabled={uploadProgress.uploading}
                />
              </label>
              {!uploadProgress.uploading && (
                <Button className="mt-3" onClick={() => document.getElementById('file-upload')?.click()}>
                  Choose File
                </Button>
              )}
            </div>

            {uploadProgress.uploading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{uploadProgress.message}</span>
                  <span className="text-sm text-gray-500">{uploadProgress.progress}%</span>
                </div>
                <Progress value={uploadProgress.progress} className="w-full" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Uploads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {uploads.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No uploads yet</p>
            ) : (
              uploads.map((upload) => (
                <div
                  key={upload.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelectedUpload(upload)}
                >
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-8 w-8 text-blue-500" />
                    <div>
                      <p className="font-medium">{upload.filename}</p>
                      <p className="text-sm text-gray-500">
                        {new Date(upload.created_at).toLocaleDateString()} • {(upload.file_size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(upload.upload_status)}
                    {upload.upload_status === 'completed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportProcessedData(upload);
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteUpload(upload.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {selectedUpload && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI Analysis Results - {selectedUpload.filename}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedUpload.upload_status === 'failed' ? (
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                <span>Error: {selectedUpload.error_message}</span>
              </div>
            ) : selectedUpload.ai_analysis ? (
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-6">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="ai-orchestrator">
                    <Bot className="h-4 w-4 mr-1" />
                    AI Tools
                  </TabsTrigger>
                  <TabsTrigger value="manipulation">Tools</TabsTrigger>
                  <TabsTrigger value="sheets">Sheets</TabsTrigger>
                  <TabsTrigger value="insights">Insights</TabsTrigger>
                  <TabsTrigger value="data">Data</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">
                        {getAllDataFromSheets(selectedUpload.raw_data).length}
                      </p>
                      <p className="text-sm text-blue-800">Total Records</p>
                    </div>
                    <div className="p-4 bg-green-50 rounded-lg">
                      <p className="text-2xl font-bold text-green-600">
                        {getAllHeadersFromSheets(selectedUpload.raw_data).length}
                      </p>
                      <p className="text-sm text-green-800">Unique Columns</p>
                    </div>
                    <div className="p-4 bg-yellow-50 rounded-lg">
                      <p className="text-2xl font-bold text-yellow-600">
                        {selectedUpload.ai_analysis.dataQuality?.completeness || 'N/A'}
                      </p>
                      <p className="text-sm text-yellow-800">Data Completeness</p>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <p className="text-2xl font-bold text-purple-600">
                        {typeof selectedUpload.raw_data === 'object' && !Array.isArray(selectedUpload.raw_data) ? 
                          Object.keys(selectedUpload.raw_data).length : 1}
                      </p>
                      <p className="text-sm text-purple-800">Sheets Processed</p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="ai-orchestrator" className="space-y-4">
                  <AIDataOrchestrator
                    uploadId={selectedUpload.id}
                    rawData={selectedUpload.raw_data}
                    aiAnalysis={selectedUpload.ai_analysis}
                    onDataUpdate={handleDataUpdate}
                  />
                </TabsContent>

                <TabsContent value="manipulation" className="space-y-4">
                  <DataManipulationTools
                    data={getAllDataFromSheets(selectedUpload.raw_data)}
                    headers={getAllHeadersFromSheets(selectedUpload.raw_data)}
                    onDataUpdate={handleDataUpdate}
                  />
                </TabsContent>

                <TabsContent value="sheets" className="space-y-4">
                  {selectedUpload.ai_analysis.sheetAnalysis && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">Primary Sheet Recommendation</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-2">
                              <Layers className="h-5 w-5 text-blue-500" />
                              <span className="font-medium">
                                {selectedUpload.ai_analysis.sheetAnalysis.primarySheet}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                        
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-lg">Sheet Purposes</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {Object.entries(selectedUpload.ai_analysis.sheetAnalysis.sheetPurposes || {}).map(([sheet, purpose]) => (
                                <div key={sheet} className="flex justify-between items-center">
                                  <span className="font-medium">{sheet}</span>
                                  <Badge variant="outline">{String(purpose)}</Badge>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                      
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Consolidation Opportunities</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2">
                            {(selectedUpload.ai_analysis.sheetAnalysis.consolidationOpportunities || []).map((opportunity: string, index: number) => (
                              <li key={index} className="flex items-start gap-2">
                                <div className="w-2 h-2 bg-orange-500 rounded-full mt-2 flex-shrink-0" />
                                <span className="text-sm">{opportunity}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="insights" className="space-y-4">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Key Insights</h4>
                      <ul className="space-y-2">
                        {(selectedUpload.ai_analysis.insights || []).map((insight: string, index: number) => (
                          <li key={index} className="flex items-start gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0" />
                            <span className="text-sm">{insight}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Suggestions</h4>
                      <ul className="space-y-2">
                        {(selectedUpload.ai_analysis.suggestions || []).map((suggestion: string, index: number) => (
                          <li key={index} className="flex items-start gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0" />
                            <span className="text-sm">{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="data" className="space-y-4">
                  {/* Show manipulated data if available, otherwise show raw data */}
                  {manipulatedData ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <span className="text-green-800 font-medium">Showing AI-manipulated data</span>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => setManipulatedData(null)}
                          className="ml-auto"
                        >
                          Show Original Data
                        </Button>
                      </div>
                      
                      {/* Handle both array format (single dataset) and object format (multi-sheet) */}
                      {Array.isArray(manipulatedData) ? (
                        <DataTable
                          data={manipulatedData}
                          headers={Object.keys(manipulatedData[0] || {})}
                          title={`AI-Manipulated Data (${manipulatedData.length} records)`}
                          columnTypes={selectedUpload.ai_analysis?.columnTypes}
                        />
                      ) : typeof manipulatedData === 'object' ? (
                        <div className="space-y-6">
                          {Object.entries(manipulatedData).map(([sheetName, sheetData]: [string, any]) => (
                            <DataTable
                              key={sheetName}
                              data={sheetData.data || sheetData}
                              headers={sheetData.headers || Object.keys((sheetData.data || sheetData)[0] || {})}
                              title={`AI-Manipulated Data - ${sheetName} (${(sheetData.data || sheetData).length} records)`}
                              columnTypes={selectedUpload.ai_analysis?.columnTypes}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground py-8">
                          Invalid data format received from AI processing
                        </div>
                      )}
                    </div>
                  ) : typeof selectedUpload.raw_data === 'object' && !Array.isArray(selectedUpload.raw_data) ? (
                    <div className="space-y-6">
                      {Object.entries(selectedUpload.raw_data).map(([sheetName, sheetData]: [string, any]) => (
                        <DataTable
                          key={sheetName}
                          data={sheetData.data || []}
                          headers={sheetData.headers || []}
                          title={`${sheetName} (${sheetData.data?.length || 0} records)`}
                          columnTypes={selectedUpload.ai_analysis.columnTypes}
                        />
                      ))}
                    </div>
                  ) : (
                    <DataTable
                      data={getAllDataFromSheets(selectedUpload.raw_data)}
                      headers={getAllHeadersFromSheets(selectedUpload.raw_data)}
                      title={`Data Preview (${getAllDataFromSheets(selectedUpload.raw_data).length} records)`}
                      columnTypes={selectedUpload.ai_analysis.columnTypes}
                    />
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <p className="text-gray-500">Processing data...</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
