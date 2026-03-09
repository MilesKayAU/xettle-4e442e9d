/**
 * SmartUploadFlow — Universal file upload with 3-level detection
 * 
 * Users drop any CSV/TSV/XLSX/PDF files and Xettle:
 * 1. Detects the marketplace (fingerprint → heuristic → AI)
 * 2. Warns if it's the wrong file type
 * 3. Creates settlements automatically with one-click confirmation
 */

import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Sparkles, ArrowRight, ChevronDown, Info, Trash2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { detectFile, extractFileHeaders, detectFromHeaders, MARKETPLACE_LABELS, type FileDetectionResult, type ColumnMapping } from '@/utils/file-fingerprint-engine';
import { parseGenericCSV, parseGenericXLSX } from '@/utils/generic-csv-parser';
import { parseShopifyPayoutCSV } from '@/utils/shopify-payments-parser';
import { parseBunningsSummaryPdf } from '@/utils/bunnings-summary-parser';
import { saveSettlement, type StandardSettlement } from '@/utils/settlement-engine';
import { MARKETPLACE_CATALOG } from './MarketplaceSwitcher';

// ─── Types ──────────────────────────────────────────────────────────────────

type FileStatus = 'detecting' | 'detected' | 'wrong_file' | 'unknown' | 'ai_analyzing' | 'confirmed' | 'saving' | 'saved' | 'error';

interface DetectedFile {
  file: File;
  status: FileStatus;
  detection: FileDetectionResult | null;
  overrideMarketplace?: string;
  settlements?: StandardSettlement[];
  error?: string;
  savedCount?: number;
}

interface SmartUploadFlowProps {
  onSettlementsSaved?: () => void;
  onMarketplacesChanged?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SmartUploadFlow({ onSettlementsSaved, onMarketplacesChanged }: SmartUploadFlowProps) {
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [processingAll, setProcessingAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File detection ──
  const detectFiles = useCallback(async (newFiles: File[]) => {
    const detectedFiles: DetectedFile[] = newFiles.map(f => ({
      file: f,
      status: 'detecting' as FileStatus,
      detection: null,
    }));
    setFiles(prev => [...prev, ...detectedFiles]);

    // Detect each file in parallel
    const results = await Promise.allSettled(
      newFiles.map(async (file, idx) => {
        const result = await detectFile(file);
        return { idx, result };
      })
    );

    setFiles(prev => {
      const updated = [...prev];
      const offset = prev.length - newFiles.length;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { idx, result } = r.value;
          const fileIdx = offset + idx;
          if (fileIdx < updated.length) {
            updated[fileIdx] = {
              ...updated[fileIdx],
              detection: result,
              status: result
                ? (result.isSettlementFile ? 'detected' : 'wrong_file')
                : 'unknown',
            };
          }
        }
      }
      return updated;
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    detectFiles(Array.from(selected));
    if (inputRef.current) inputRef.current.value = '';
  }, [detectFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    detectFiles(Array.from(dropped));
  }, [detectFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const overrideMarketplace = useCallback((idx: number, code: string) => {
    setFiles(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        overrideMarketplace: code,
        status: 'detected',
        detection: {
          ...(updated[idx].detection || {
            marketplace: code,
            marketplaceLabel: MARKETPLACE_LABELS[code] || code,
            confidence: 100,
            isSettlementFile: true,
            detectionLevel: 1 as const,
          }),
          marketplace: code,
          marketplaceLabel: MARKETPLACE_LABELS[code] || code,
          isSettlementFile: true,
        },
      };
      return updated;
    });
  }, []);

  // ── AI fallback for unknown files ──
  const analyzeWithAI = useCallback(async (idx: number) => {
    setFiles(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], status: 'ai_analyzing' };
      return updated;
    });

    try {
      const file = files[idx].file;
      const extracted = await extractFileHeaders(file);
      if (!extracted) {
        setFiles(prev => {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: 'error', error: 'Could not read file headers' };
          return updated;
        });
        return;
      }

      // Strip PII from sample rows
      const sanitizedSample = extracted.sampleRows.map(row =>
        row.map(cell => {
          // Remove emails
          if (cell.includes('@')) return '[email]';
          // Remove phone numbers
          if (/^\+?\d[\d\s\-]{8,}$/.test(cell)) return '[phone]';
          return cell;
        })
      );

      const { data, error } = await supabase.functions.invoke('ai-file-interpreter', {
        body: {
          headers: extracted.headers,
          sampleRows: sanitizedSample,
          filename: file.name,
        },
      });

      if (error) throw error;

      if (data?.is_settlement_file === false) {
        setFiles(prev => {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            status: 'wrong_file',
            detection: {
              marketplace: data.marketplace_guess || 'unknown',
              marketplaceLabel: MARKETPLACE_LABELS[data.marketplace_guess] || data.marketplace_guess || 'Unknown',
              confidence: data.confidence || 50,
              isSettlementFile: false,
              wrongFileMessage: data.wrong_file_message || 'This doesn\'t appear to be a settlement/payout file.',
              correctReportPath: data.download_instructions,
              detectionLevel: 3,
            },
          };
          return updated;
        });
        return;
      }

      const mapping: ColumnMapping = data?.column_mapping || {};
      setFiles(prev => {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          status: 'detected',
          detection: {
            marketplace: data?.marketplace_guess || 'unknown',
            marketplaceLabel: MARKETPLACE_LABELS[data?.marketplace_guess] || data?.marketplace_guess || 'Unknown',
            confidence: data?.confidence || 60,
            isSettlementFile: true,
            columnMapping: mapping,
            detectionLevel: 3,
            recordCount: extracted.rowCount,
          },
        };
        return updated;
      });
    } catch (err: any) {
      const isRateLimit = err?.message?.includes('429') || err?.status === 429;
      const isPayment = err?.message?.includes('402') || err?.status === 402;
      setFiles(prev => {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          status: 'error',
          error: isRateLimit
            ? 'AI analysis rate limit reached. Please try again in a moment.'
            : isPayment
              ? 'AI analysis quota exceeded. Please try again later.'
              : `AI analysis failed: ${err.message || 'Unknown error'}`,
        };
        return updated;
      });
    }
  }, [files]);

  // ── Parse & save a single file ──
  const processFile = useCallback(async (idx: number) => {
    const df = files[idx];
    if (!df.detection || !df.detection.isSettlementFile) return;

    const marketplace = df.overrideMarketplace || df.detection.marketplace;

    setFiles(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], status: 'saving' };
      return updated;
    });

    try {
      let settlements: StandardSettlement[] = [];

      // Route to correct parser
      if (marketplace === 'amazon_au') {
        // Amazon uses its own parser in AccountingDashboard — redirect user
        toast.info('Amazon settlement files should be uploaded in the Amazon tab for full multi-line accounting support.');
        setFiles(prev => {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: 'detected' };
          return updated;
        });
        return;
      }

      if (marketplace === 'bunnings' && df.file.name.toLowerCase().endsWith('.pdf')) {
        const result = await parseBunningsSummaryPdf(df.file);
        if (!result.success) throw new Error(result.error);
        settlements = [result.settlement];
      } else if (marketplace === 'shopify_payments') {
        const text = await df.file.text();
        const result = parseShopifyPayoutCSV(text);
        if (!result.success) throw new Error(result.error);
        settlements = result.settlements;
      } else {
        // Generic parser
        const mapping = df.detection.columnMapping || {};
        const name = df.file.name.toLowerCase();
        
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
          const result = await parseGenericXLSX(df.file, {
            marketplace,
            mapping,
            gstModel: 'seller',
            gstRate: 10,
            groupBySettlement: !!mapping.settlement_id,
            fallbackSettlementId: `${marketplace}-${df.file.name.replace(/\.[^.]+$/, '')}-${Date.now()}`,
          });
          if (!result.success) throw new Error(result.error);
          settlements = result.settlements;
          if (result.warnings.length > 0) {
            result.warnings.forEach(w => toast.warning(w, { duration: 8000 }));
          }
        } else {
          const text = await df.file.text();
          const result = parseGenericCSV(text, {
            marketplace,
            mapping,
            gstModel: 'seller',
            gstRate: 10,
            groupBySettlement: !!mapping.settlement_id,
            fallbackSettlementId: `${marketplace}-${df.file.name.replace(/\.[^.]+$/, '')}-${Date.now()}`,
          });
          if (!result.success) throw new Error(result.error);
          settlements = result.settlements;
          if (result.warnings.length > 0) {
            result.warnings.forEach(w => toast.warning(w, { duration: 8000 }));
          }
        }
      }

      if (settlements.length === 0) {
        throw new Error('No settlements could be parsed from this file.');
      }

      // Auto-create marketplace connection if needed
      await ensureMarketplaceConnection(marketplace);

      // Save all settlements
      let savedCount = 0;
      let dupCount = 0;
      for (const s of settlements) {
        const result = await saveSettlement(s);
        if (result.success) {
          savedCount++;
        } else if (result.duplicate) {
          dupCount++;
        } else {
          console.error(`Failed to save settlement ${s.settlement_id}:`, result.error);
        }
      }

      const label = MARKETPLACE_LABELS[marketplace] || marketplace;
      if (savedCount > 0) {
        toast.success(`${label}: ${savedCount} settlement${savedCount > 1 ? 's' : ''} saved ✓${dupCount > 0 ? ` (${dupCount} duplicates skipped)` : ''}`);
      } else if (dupCount > 0) {
        toast.info(`${label}: All ${dupCount} settlement${dupCount > 1 ? 's' : ''} already saved (duplicates skipped).`);
      }

      setFiles(prev => {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          status: 'saved',
          settlements,
          savedCount,
        };
        return updated;
      });

      onSettlementsSaved?.();
    } catch (err: any) {
      setFiles(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], status: 'error', error: err.message };
        return updated;
      });
      toast.error(`Failed to process ${df.file.name}: ${err.message}`);
    }
  }, [files, onSettlementsSaved]);

  // ── Process all confirmed files ──
  const processAllConfirmed = useCallback(async () => {
    setProcessingAll(true);
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'detected' && files[i].detection?.isSettlementFile) {
        await processFile(i);
      }
    }
    setProcessingAll(false);
  }, [files, processFile]);

  const confirmedCount = files.filter(f => f.status === 'detected' && f.detection?.isSettlementFile).length;
  const savedCount = files.filter(f => f.status === 'saved').length;
  const hasFiles = files.length > 0;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <Card
        className={`border-2 border-dashed transition-all cursor-pointer ${
          hasFiles ? 'border-muted-foreground/25' : 'border-primary/30 hover:border-primary/60 bg-primary/5'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => inputRef.current?.click()}
      >
        <CardContent className="py-8 text-center">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Smart Upload — Drop any settlement files
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                CSV, TSV, XLSX, PDF — Xettle auto-detects the marketplace and creates settlements
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
              <Upload className="h-4 w-4 mr-1" />
              Choose Files
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* File results */}
      {hasFiles && (
        <div className="space-y-2">
          {files.map((df, idx) => (
            <FileResultCard
              key={`${df.file.name}-${idx}`}
              df={df}
              idx={idx}
              onRemove={removeFile}
              onOverride={overrideMarketplace}
              onAnalyzeAI={analyzeWithAI}
              onProcess={processFile}
            />
          ))}

          {/* Bulk action bar */}
          {confirmedCount > 0 && (
            <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3 mt-3">
              <p className="text-sm text-muted-foreground">
                {confirmedCount} file{confirmedCount > 1 ? 's' : ''} ready to process
                {savedCount > 0 && `, ${savedCount} saved`}
              </p>
              <Button
                onClick={processAllConfirmed}
                disabled={processingAll}
                size="sm"
              >
                {processingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-1" />
                )}
                Confirm & Save All
              </Button>
            </div>
          )}

          {/* Clear all */}
          {files.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setFiles([])}
            >
              Clear all files
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── File Result Card ───────────────────────────────────────────────────────

interface FileResultCardProps {
  df: DetectedFile;
  idx: number;
  onRemove: (idx: number) => void;
  onOverride: (idx: number, code: string) => void;
  onAnalyzeAI: (idx: number) => void;
  onProcess: (idx: number) => void;
}

function FileResultCard({ df, idx, onRemove, onOverride, onAnalyzeAI, onProcess }: FileResultCardProps) {
  const { file, status, detection } = df;

  const statusConfig = {
    detecting: { icon: Loader2, color: 'text-muted-foreground', label: 'Analyzing...', iconClass: 'animate-spin' },
    detected: { icon: CheckCircle2, color: 'text-green-600', label: 'Detected', iconClass: '' },
    wrong_file: { icon: AlertTriangle, color: 'text-amber-500', label: 'Wrong file type', iconClass: '' },
    unknown: { icon: Info, color: 'text-blue-500', label: 'Unknown format', iconClass: '' },
    ai_analyzing: { icon: Sparkles, color: 'text-purple-500', label: 'AI analyzing...', iconClass: 'animate-pulse' },
    confirmed: { icon: CheckCircle2, color: 'text-green-600', label: 'Confirmed', iconClass: '' },
    saving: { icon: Loader2, color: 'text-primary', label: 'Processing...', iconClass: 'animate-spin' },
    saved: { icon: CheckCircle2, color: 'text-green-600', label: 'Saved', iconClass: '' },
    error: { icon: XCircle, color: 'text-destructive', label: 'Error', iconClass: '' },
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;
  const marketplace = df.overrideMarketplace || detection?.marketplace;
  const catDef = MARKETPLACE_CATALOG.find(m => m.code === marketplace);

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
      status === 'wrong_file' ? 'border-amber-300 bg-amber-50/50' :
      status === 'error' ? 'border-destructive/30 bg-destructive/5' :
      status === 'saved' ? 'border-green-300 bg-green-50/30' :
      'border-border bg-background'
    }`}>
      <StatusIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${config.color} ${config.iconClass}`} />
      
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{file.name}</span>
          <span className="text-xs text-muted-foreground">
            ({(file.size / 1024).toFixed(1)} KB)
          </span>
          {detection?.confidence && status !== 'wrong_file' && (
            <Badge variant="outline" className="text-[10px] px-1.5">
              {detection.confidence}% match
            </Badge>
          )}
        </div>

        {/* Detection result */}
        {status === 'detected' && detection && (
          <div className="flex items-center gap-2">
            <span className="text-base">{catDef?.icon || '📋'}</span>
            <span className="text-sm text-foreground font-medium">
              {detection.marketplaceLabel}
            </span>
            {detection.recordCount && (
              <span className="text-xs text-muted-foreground">
                — {detection.recordCount} record{detection.recordCount > 1 ? 's' : ''}
              </span>
            )}
            {detection.detectionLevel === 2 && (
              <Badge variant="outline" className="text-[10px]">Heuristic</Badge>
            )}
            {detection.detectionLevel === 3 && (
              <Badge variant="outline" className="text-[10px]">AI detected</Badge>
            )}
          </div>
        )}

        {/* Wrong file warning */}
        {status === 'wrong_file' && detection && (
          <div className="space-y-1.5">
            <p className="text-sm text-amber-700">{detection.wrongFileMessage}</p>
            {detection.correctReportPath && (
              <p className="text-xs text-amber-600 bg-amber-100 rounded px-2 py-1">
                📥 {detection.correctReportPath}
              </p>
            )}
          </div>
        )}

        {/* Unknown — offer AI analysis */}
        {status === 'unknown' && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Could not identify this file.</p>
            <Button variant="outline" size="sm" className="text-xs h-6" onClick={() => onAnalyzeAI(idx)}>
              <Sparkles className="h-3 w-3 mr-1" />
              Analyze with AI
            </Button>
            <Select onValueChange={(code) => onOverride(idx, code)}>
              <SelectTrigger className="h-6 text-xs w-auto min-w-[120px]">
                <SelectValue placeholder="Set manually..." />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACE_CATALOG.map(m => (
                  <SelectItem key={m.code} value={m.code} className="text-xs">
                    {m.icon} {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* AI analyzing */}
        {status === 'ai_analyzing' && (
          <p className="text-xs text-purple-600">AI is analyzing your file structure...</p>
        )}

        {/* Saved */}
        {status === 'saved' && df.savedCount !== undefined && (
          <p className="text-xs text-green-700">
            ✓ {df.savedCount} settlement{df.savedCount !== 1 ? 's' : ''} saved successfully
          </p>
        )}

        {/* Error */}
        {status === 'error' && df.error && (
          <p className="text-xs text-destructive">{df.error}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {status === 'detected' && detection?.isSettlementFile && (
          <Button variant="default" size="sm" className="text-xs h-7" onClick={() => onProcess(idx)}>
            Save
          </Button>
        )}
        {status === 'wrong_file' && (
          <Select onValueChange={(code) => onOverride(idx, code)}>
            <SelectTrigger className="h-7 text-xs w-auto min-w-[100px]">
              <SelectValue placeholder="Override..." />
            </SelectTrigger>
            <SelectContent>
              {MARKETPLACE_CATALOG.map(m => (
                <SelectItem key={m.code} value={m.code} className="text-xs">
                  {m.icon} {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(idx)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureMarketplaceConnection(marketplaceCode: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check if connection exists
    const { data: existing } = await supabase
      .from('marketplace_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('marketplace_code', marketplaceCode)
      .maybeSingle();

    if (existing) return;

    // Auto-create connection
    const catDef = MARKETPLACE_CATALOG.find(m => m.code === marketplaceCode);
    await supabase.from('marketplace_connections').insert({
      user_id: user.id,
      marketplace_code: marketplaceCode,
      marketplace_name: catDef?.name || marketplaceCode,
      country_code: catDef?.country || 'AU',
      connection_type: 'auto_detected',
      connection_status: 'active',
    } as any);

    toast.info(`New marketplace detected: ${catDef?.name || marketplaceCode} — auto-added to your dashboard.`);
  } catch (err) {
    console.error('Failed to auto-create marketplace connection:', err);
  }
}
