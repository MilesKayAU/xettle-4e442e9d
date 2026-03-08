
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Brain, Play, Loader2, CheckCircle, AlertCircle, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface AIOrchestatorProps {
  uploadId: string;
  rawData: any;
  aiAnalysis: any;
  onDataUpdate: (newData: any) => void;
}

interface AICommand {
  id: string;
  command: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export default function AIDataOrchestrator({ uploadId, rawData, aiAnalysis, onDataUpdate }: AIOrchestatorProps) {
  const [userPrompt, setUserPrompt] = useState('');
  const [commands, setCommands] = useState<AICommand[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastTransformedData, setLastTransformedData] = useState<any>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const { toast } = useToast();

  const executeWithPrompt = async (promptToUse: string) => {
    if (!promptToUse.trim()) return;

    setIsProcessing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('ai-data-orchestrator', {
        body: {
          uploadId,
          userPrompt: promptToUse,
          rawData,
          aiAnalysis
        }
      });

      if (error) throw error;

      const newCommands = data.commands.map((cmd: any) => ({
        ...cmd,
        id: Math.random().toString(36).substr(2, 9)
      }));

      setCommands(prev => [...prev, ...newCommands]);

      // Execute commands sequentially
      await executeCommands(newCommands);

      toast({
        title: "AI Commands Generated",
        description: `Generated ${newCommands.length} data manipulation commands`,
      });

    } catch (error) {
      console.error('AI orchestration error:', error);
      toast({
        title: "Error",
        description: "Failed to process AI request",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAIRequest = () => executeWithPrompt(userPrompt);

  const executeCommands = async (commandsToExecute: AICommand[]) => {
    for (const command of commandsToExecute) {
      setCommands(prev => prev.map(cmd => 
        cmd.id === command.id ? { ...cmd, status: 'executing' } : cmd
      ));

      try {
        const result = await executeCommand(command);
        
        setCommands(prev => prev.map(cmd => 
          cmd.id === command.id ? { ...cmd, status: 'completed', result } : cmd
        ));

        // Update the data if the command produces new data
        if (result.newData) {
          console.log('AIDataOrchestrator - Command result newData:', result.newData);
          console.log('AIDataOrchestrator - Calling onDataUpdate with:', result.newData);
          setLastTransformedData(result.newData);
          setPreviewVisible(true);
          onDataUpdate(result.newData);
          
          // Show success toast with preview option
          toast({
            title: "✅ Data Transformation Complete!",
            description: "Your data has been processed. Check the preview below or switch to the Data tab to see full results.",
            duration: 5000,
          });
        } else {
          console.log('AIDataOrchestrator - No newData in result:', result);
        }

      } catch (error) {
        setCommands(prev => prev.map(cmd => 
          cmd.id === command.id ? { 
            ...cmd, 
            status: 'failed', 
            error: error.message 
          } : cmd
        ));
      }
    }
  };

  const executeCommand = async (command: AICommand) => {
    // Call the AI Data Orchestrator edge function to actually execute the command
    const { data, error } = await supabase.functions.invoke('ai-data-orchestrator', {
      body: {
        uploadId,
        userPrompt: command.command,
        rawData,
        aiAnalysis
      }
    });

    if (error) {
      console.error('AIDataOrchestrator - Edge function error:', error);
      throw new Error(error.message);
    }
    
    console.log('AIDataOrchestrator - Edge function response:', data);
    console.log('AIDataOrchestrator - transformedData:', data.transformedData);
    
    return {
      success: true,
      message: `Executed: ${command.command}`,
      newData: data.transformedData || null
    };
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <div className="w-4 h-4 bg-gray-300 rounded-full" />;
      case 'executing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  // Helper function to render preview data
  const renderPreviewData = (data: any) => {
    if (!data) return null;

    // Handle different data structures
    let previewData = [];
    let sheetName = '';

    if (Array.isArray(data)) {
      previewData = data.slice(0, 5); // Show first 5 rows
      sheetName = 'Transformed Data';
    } else if (typeof data === 'object') {
      // Multi-sheet data - show first sheet
      const firstSheet = Object.keys(data)[0];
      if (firstSheet && data[firstSheet]?.data) {
        previewData = data[firstSheet].data.slice(0, 5);
        sheetName = firstSheet;
      }
    }

    if (previewData.length === 0) return <p className="text-muted-foreground">No preview data available</p>;

    const columns = Object.keys(previewData[0]);

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="font-medium text-sm">📊 {sheetName} (First 5 rows)</h5>
          <Badge variant="secondary">{typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).length + ' sheets' : previewData.length + ' rows shown'}</Badge>
        </div>
        
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.slice(0, 6).map((col) => (
                  <TableHead key={col} className="text-xs font-medium">{col}</TableHead>
                ))}
                {columns.length > 6 && <TableHead className="text-xs">...</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewData.map((row, index) => (
                <TableRow key={index}>
                  {columns.slice(0, 6).map((col) => (
                    <TableCell key={col} className="text-xs font-mono">
                      {String(row[col] || '').substring(0, 20)}
                      {String(row[col] || '').length > 20 && '...'}
                    </TableCell>
                  ))}
                  {columns.length > 6 && <TableCell className="text-xs text-muted-foreground">+{columns.length - 6}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        <div className="text-xs text-muted-foreground">
          💡 Switch to the "Data" tab to see the complete transformed dataset with all columns and rows.
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          AI Data Orchestrator
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Tell the AI what you want to do with your data, and it will create and execute the necessary commands.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">What would you like to do with your data?</label>
          <Textarea
            placeholder="Examples: 
- Create a table showing only high-performing campaigns
- Add a calculated column for cost per conversion
- Filter data to show campaigns with CPC > $2
- Create a summary table by campaign type
- Show me the top 10 campaigns by impressions"
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            rows={4}
          />
        </div>

        <Button 
          onClick={handleAIRequest}
          disabled={isProcessing || !userPrompt.trim()}
          className="w-full"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Execute AI Commands
            </>
          )}
        </Button>

        {/* Command History */}
        {commands.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium">Command History</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {commands.map((command) => (
                <div key={command.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  {getStatusIcon(command.status)}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{command.command}</p>
                    {command.status === 'completed' && command.result && (
                      <p className="text-xs text-green-600 mt-1">{command.result.message}</p>
                    )}
                    {command.status === 'failed' && command.error && (
                      <p className="text-xs text-red-600 mt-1">{command.error}</p>
                    )}
                  </div>
                  <Badge variant={
                    command.status === 'completed' ? 'default' :
                    command.status === 'failed' ? 'destructive' :
                    command.status === 'executing' ? 'secondary' : 'outline'
                  }>
                    {command.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Action Buttons */}
        <div className="space-y-2">
          <h4 className="font-medium">Quick Actions</h4>
          <div className="grid grid-cols-2 gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => executeWithPrompt("Create a summary table showing total impressions, clicks, and spend by campaign")}
              disabled={isProcessing}
            >
              Campaign Summary
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => executeWithPrompt("Filter to show only campaigns with CTR > 1%")}
              disabled={isProcessing}
            >
              High CTR Filter
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => executeWithPrompt("Add calculated columns for CTR, CPC, and ROAS")}
              disabled={isProcessing}
            >
              Add Metrics
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => executeWithPrompt("Create a pivot table by campaign type and ad group")}
              disabled={isProcessing}
            >
              Pivot Table
            </Button>
          </div>
        </div>

        {/* Data Preview Section */}
        {previewVisible && lastTransformedData && (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <h4 className="font-medium flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Preview Results
              </h4>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewVisible(false)}
                >
                  <EyeOff className="w-3 h-3 mr-1" />
                  Hide
                </Button>
              </div>
            </div>
            
            <div className="border rounded-lg p-4 bg-muted/30">
              {renderPreviewData(lastTransformedData)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
