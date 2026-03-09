/**
 * SmartUploadFlow — Universal file upload with 3-level detection
 * 
 * Users drop any CSV/TSV/XLSX/PDF files and Xettle:
 * 1. Detects the marketplace (fingerprint → heuristic → AI)
 * 2. Shows a settlement preview with financial breakdown
 * 3. Creates settlements with one-click confirmation
 */

import { useState, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Upload, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Sparkles, ArrowRight, Info, Trash2, FileSpreadsheet,
  DollarSign, Calendar,
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
import { detectFile, extractFileHeaders, MARKETPLACE_LABELS, type FileDetectionResult, type ColumnMapping } from '@/utils/file-fingerprint-engine';
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAUD(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateRange(start: string, end: string): string {
  try {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
    if (sameMonth) {
      return `${s.toLocaleDateString('en-AU', { day: 'numeric' })}–${e.toLocaleDateString('en-AU', opts)}`;
    }
    return `${s.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('en-AU', opts)}`;
  } catch {
    return `${start} – ${end}`;
  }
}

const MARKETPLACE_COLORS: Record<string, string> = {
  amazon_au: 'bg-amber-500',
  shopify_payments: 'bg-emerald-500',
  bunnings: 'bg-red-600',
  kogan: 'bg-blue-600',
  catch: 'bg-purple-600',
  mydeal: 'bg-cyan-600',
  woolworths: 'bg-green-700',
  bigw: 'bg-sky-600',
  ebay_au: 'bg-yellow-500',
  etsy: 'bg-orange-500',
  theiconic: 'bg-pink-600',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function SmartUploadFlow({ onSettlementsSaved, onMarketplacesChanged }: SmartUploadFlowProps) {
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [processingAll, setProcessingAll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<DetectedFile[]>([]);
  filesRef.current = files;

  // ── Pre-parse: immediately parse detected files to show preview ──
  const preParseFile = useCallback(async (file: File, detection: FileDetectionResult): Promise<StandardSettlement[]> => {
    const marketplace = detection.marketplace;
    try {
      if (marketplace === 'amazon_au') return []; // Amazon uses its own parser

      if (marketplace === 'bunnings' && file.name.toLowerCase().endsWith('.pdf')) {
        const result = await parseBunningsSummaryPdf(file);
        if (!result.success) return [];
        return [result.settlement];
      }
      
      if (marketplace === 'shopify_payments') {
        const text = await file.text();
        const result = parseShopifyPayoutCSV(text);
        if (!result.success) return [];
        return result.settlements;
      }

      // Generic parser
      const mapping = detection.columnMapping || {};
      const name = file.name.toLowerCase();
      
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const result = await parseGenericXLSX(file, {
          marketplace,
          mapping,
          gstModel: 'seller',
          gstRate: 10,
          groupBySettlement: !!mapping.settlement_id,
          fallbackSettlementId: `${marketplace}-${file.name.replace(/\.[^.]+$/, '')}-${Date.now()}`,
        });
        return result.success ? result.settlements : [];
      }
      
      const text = await file.text();
      const result = parseGenericCSV(text, {
        marketplace,
        mapping,
        gstModel: 'seller',
        gstRate: 10,
        groupBySettlement: !!mapping.settlement_id,
        fallbackSettlementId: `${marketplace}-${file.name.replace(/\.[^.]+$/, '')}-${Date.now()}`,
      });
      return result.success ? result.settlements : [];
    } catch {
      return [];
    }
  }, []);

  // ── File detection ──
  const detectFiles = useCallback(async (newFiles: File[]) => {
    // Dedup 1: skip files already in the current list (by name + size)
    const currentFiles = filesRef.current;
    const uniqueFiles = newFiles.filter(f => {
      const isDupe = currentFiles.some(
        existing => existing.file.name === f.name && existing.file.size === f.size
      );
      if (isDupe) {
        toast.warning(`"${f.name}" is already in the upload list — skipped.`, { duration: 4000 });
      }
      return !isDupe;
    });

    if (uniqueFiles.length === 0) return;

    const detectedFiles: DetectedFile[] = uniqueFiles.map(f => ({
      file: f,
      status: 'detecting' as FileStatus,
      detection: null,
    }));
    setFiles(prev => [...prev, ...detectedFiles]);

    const results = await Promise.allSettled(
      newFiles.map(async (file, idx) => {
        const result = await detectFile(file);
        // Pre-parse if detected as settlement
        let settlements: StandardSettlement[] = [];
        if (result && result.isSettlementFile) {
          settlements = await preParseFile(file, result);
        }
        return { idx, result, settlements };
      })
    );

    setFiles(prev => {
      const updated = [...prev];
      const offset = prev.length - newFiles.length;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { idx, result, settlements } = r.value;
          const fileIdx = offset + idx;
          if (fileIdx < updated.length) {
            updated[fileIdx] = {
              ...updated[fileIdx],
              detection: result,
              settlements: settlements.length > 0 ? settlements : undefined,
              status: result
                ? (result.isSettlementFile ? 'detected' : 'wrong_file')
                : 'unknown',
            };
          }
        }
      }
      return updated;
    });
  }, [preParseFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    detectFiles(Array.from(selected));
    if (inputRef.current) inputRef.current.value = '';
  }, [detectFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    detectFiles(Array.from(dropped));
  }, [detectFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
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
      const file = filesRef.current[idx]?.file;
      if (!file) return;
      const extracted = await extractFileHeaders(file);
      if (!extracted) {
        setFiles(prev => {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: 'error', error: 'Could not read file headers' };
          return updated;
        });
        return;
      }

      const sanitizedSample = extracted.sampleRows.map(row =>
        row.map(cell => {
          if (cell.includes('@')) return '[email]';
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
      const detection: FileDetectionResult = {
        marketplace: data?.marketplace_guess || 'unknown',
        marketplaceLabel: MARKETPLACE_LABELS[data?.marketplace_guess] || data?.marketplace_guess || 'Unknown',
        confidence: data?.confidence || 60,
        isSettlementFile: true,
        columnMapping: mapping,
        detectionLevel: 3,
        recordCount: extracted.rowCount,
      };

      // Pre-parse after AI detection
      const settlements = await preParseFile(file, detection);

      setFiles(prev => {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          status: 'detected',
          detection,
          settlements: settlements.length > 0 ? settlements : undefined,
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
  }, [preParseFile]);

  // ── Save a single file ──
  const processFile = useCallback(async (idx: number) => {
    const df = filesRef.current[idx];
    if (!df?.detection || !df.detection.isSettlementFile) return;

    const marketplace = df.overrideMarketplace || df.detection.marketplace;

    setFiles(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], status: 'saving' };
      return updated;
    });

    try {
      // Use pre-parsed settlements if available, otherwise parse now
      let settlements = df.settlements || [];

      if (settlements.length === 0) {
        if (marketplace === 'amazon_au') {
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
          if (!result.success) throw new Error('error' in result ? result.error : 'Bunnings parse failed');
          settlements = [result.settlement];
        } else if (marketplace === 'shopify_payments') {
          const text = await df.file.text();
          const result = parseShopifyPayoutCSV(text);
          if (!result.success) throw new Error('error' in result ? result.error : 'Shopify parse failed');
          settlements = result.settlements;
        } else {
          const mapping = df.detection.columnMapping || {};
          const name = df.file.name.toLowerCase();
          
          if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            const result = await parseGenericXLSX(df.file, {
              marketplace, mapping, gstModel: 'seller', gstRate: 10,
              groupBySettlement: !!mapping.settlement_id,
              fallbackSettlementId: `${marketplace}-${df.file.name.replace(/\.[^.]+$/, '')}-${Date.now()}`,
            });
            if (!result.success) throw new Error(result.error);
            settlements = result.settlements;
          } else {
            const text = await df.file.text();
            const result = parseGenericCSV(text, {
              marketplace, mapping, gstModel: 'seller', gstRate: 10,
              groupBySettlement: !!mapping.settlement_id,
              fallbackSettlementId: `${marketplace}-${df.file.name.replace(/\.[^.]+$/, '')}-${Date.now()}`,
            });
            if (!result.success) throw new Error(result.error);
            settlements = result.settlements;
          }
        }
      }

      if (settlements.length === 0) {
        throw new Error('No settlements could be parsed from this file.');
      }

      await ensureMarketplaceConnection(marketplace);

      let savedCount = 0;
      let dupCount = 0;
      for (const s of settlements) {
        const result = await saveSettlement(s);
        if (result.success) savedCount++;
        else if (result.duplicate) dupCount++;
        else console.error(`Failed to save settlement ${s.settlement_id}:`, result.error);
      }

      const label = MARKETPLACE_LABELS[marketplace] || marketplace;
      if (savedCount > 0) {
        toast.success(`${label}: ${savedCount} settlement${savedCount > 1 ? 's' : ''} created ✓${dupCount > 0 ? ` (${dupCount} duplicates skipped)` : ''}`);
      } else if (dupCount > 0) {
        toast.info(`${label}: All ${dupCount} settlement${dupCount > 1 ? 's' : ''} already exist (duplicates skipped).`);
      }

      setFiles(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], status: 'saved', settlements, savedCount };
        return updated;
      });

      onSettlementsSaved?.();
      onMarketplacesChanged?.();
    } catch (err: any) {
      setFiles(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], status: 'error', error: err.message };
        return updated;
      });
      toast.error(`Failed to process ${df.file.name}: ${err.message}`);
    }
  }, [onSettlementsSaved, onMarketplacesChanged]);

  // ── Process all confirmed files ──
  const processAllConfirmed = useCallback(async () => {
    setProcessingAll(true);
    const currentFiles = filesRef.current;
    for (let i = 0; i < currentFiles.length; i++) {
      if (currentFiles[i].status === 'detected' && currentFiles[i].detection?.isSettlementFile) {
        await processFile(i);
      }
    }
    setProcessingAll(false);
  }, [processFile]);

  const readyFiles = files.filter(f => f.status === 'detected' && f.detection?.isSettlementFile);
  const confirmedCount = readyFiles.length;
  const savedCount = files.filter(f => f.status === 'saved').length;
  const totalSettlements = readyFiles.reduce((sum, f) => sum + (f.settlements?.length || 0), 0);
  const hasFiles = files.length > 0;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <Card
        className={`border-2 border-dashed transition-all cursor-pointer ${
          isDragging
            ? 'border-primary bg-primary/10 scale-[1.01]'
            : hasFiles
              ? 'border-muted-foreground/25 hover:border-muted-foreground/40'
              : 'border-primary/30 hover:border-primary/60 bg-primary/5'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <CardContent className={`${hasFiles ? 'py-6' : 'py-10'} text-center`}>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-3">
            {isDragging ? (
              <>
                <div className="h-14 w-14 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
                  <Upload className="h-7 w-7 text-primary" />
                </div>
                <p className="text-sm font-medium text-primary">
                  Drop files to detect & preview
                </p>
              </>
            ) : (
              <>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Drop files here or click to upload
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Xettle auto-detects, previews settlements, and prepares for Xero
                  </p>
                </div>
                {/* Format pills */}
                <div className="flex flex-wrap justify-center gap-1.5 mt-1">
                  {[
                    { label: 'Amazon TSV', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
                    { label: 'Shopify CSV', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
                    { label: 'Bunnings PDF', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
                    { label: 'XLSX', color: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
                    { label: 'Any CSV', color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
                  ].map(fmt => (
                    <span
                      key={fmt.label}
                      className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${fmt.color}`}
                    >
                      {fmt.label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* File results */}
      {hasFiles && (
        <div className="space-y-3">
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
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {totalSettlements > 0
                        ? `${totalSettlements} settlement${totalSettlements !== 1 ? 's' : ''} ready`
                        : `${confirmedCount} file${confirmedCount !== 1 ? 's' : ''} ready`
                      }
                      {savedCount > 0 && (
                        <span className="text-muted-foreground"> · {savedCount} saved</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ✓ Ready to create settlements & prepare for Xero
                    </p>
                  </div>
                  <Button
                    onClick={processAllConfirmed}
                    disabled={processingAll}
                    className="gap-2"
                  >
                    {processingAll ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Create {totalSettlements > 1 ? `${totalSettlements} Settlements` : 'Settlement'} & Prepare for Xero
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Clear all */}
          {files.length > 1 && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setFiles([])}
              >
                Clear all files
              </Button>
            </div>
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
  const { file, status, detection, settlements } = df;
  const marketplace = df.overrideMarketplace || detection?.marketplace;
  const catDef = MARKETPLACE_CATALOG.find(m => m.code === marketplace);
  const colorDot = MARKETPLACE_COLORS[marketplace || ''] || 'bg-muted-foreground';

  // Aggregate settlement preview
  const previewData = settlements && settlements.length > 0
    ? {
        totalSales: settlements.reduce((s, x) => s + x.sales_ex_gst, 0),
        totalGstSales: settlements.reduce((s, x) => s + x.gst_on_sales, 0),
        totalFees: settlements.reduce((s, x) => s + x.fees_ex_gst, 0),
        totalGstFees: settlements.reduce((s, x) => s + x.gst_on_fees, 0),
        totalNet: settlements.reduce((s, x) => s + x.net_payout, 0),
        periodStart: settlements.reduce((a, s) => s.period_start < a ? s.period_start : a, settlements[0].period_start),
        periodEnd: settlements.reduce((a, s) => s.period_end > a ? s.period_end : a, settlements[0].period_end),
        count: settlements.length,
      }
    : null;

  return (
    <Card className={`transition-all ${
      status === 'wrong_file' ? 'border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10' :
      status === 'error' ? 'border-destructive/30 bg-destructive/5' :
      status === 'saved' ? 'border-green-400/50 bg-green-50/30 dark:bg-green-950/10' :
      status === 'detected' && previewData ? 'border-primary/30 bg-primary/[0.02]' :
      'border-border'
    }`}>
      <CardContent className="py-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Marketplace color dot + icon */}
            <div className="flex flex-col items-center gap-1 pt-0.5">
              <div className={`h-8 w-8 rounded-lg ${colorDot} flex items-center justify-center text-white text-sm`}>
                {catDef?.icon || (status === 'detecting' ? '⏳' : '📄')}
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-1.5">
              {/* File name + size */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground truncate">
                  {status === 'detected' && detection
                    ? detection.marketplaceLabel
                    : status === 'wrong_file' && detection
                      ? detection.marketplaceLabel
                      : file.name
                  }
                </span>
                <span className="text-xs text-muted-foreground">
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>

              {/* Detection info bar */}
              {status === 'detecting' && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Analyzing file structure...</span>
                </div>
              )}

              {status === 'detected' && detection && (
                <div className="space-y-3">
                  {/* Confidence + meta */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Confidence:</span>
                      <div className="flex items-center gap-1.5">
                        <Progress 
                          value={detection.confidence} 
                          className="h-1.5 w-16"
                        />
                        <span className="text-xs font-semibold text-foreground">{detection.confidence}%</span>
                      </div>
                    </div>
                    {detection.recordCount && (
                      <div className="flex items-center gap-1">
                        <FileSpreadsheet className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {detection.recordCount} records
                        </span>
                      </div>
                    )}
                    {previewData && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {formatDateRange(previewData.periodStart, previewData.periodEnd)}
                        </span>
                      </div>
                    )}
                    {detection.detectionLevel === 3 && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Sparkles className="h-2.5 w-2.5" /> AI detected
                      </Badge>
                    )}
                  </div>

                  {/* Settlement preview — the wow moment */}
                  {previewData && (
                    <div className="bg-muted/40 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 mb-2">
                        <DollarSign className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-semibold text-foreground">
                          Settlement Preview
                          {previewData.count > 1 && ` (${previewData.count} payouts)`}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Sales (ex GST)</span>
                          <span className="font-medium text-foreground">{formatAUD(previewData.totalSales)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">GST on Sales</span>
                          <span className="font-medium text-foreground">{formatAUD(previewData.totalGstSales)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Fees (ex GST)</span>
                          <span className="font-medium text-foreground">{formatAUD(previewData.totalFees)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">GST on Fees</span>
                          <span className="font-medium text-foreground">{formatAUD(previewData.totalGstFees)}</span>
                        </div>
                      </div>
                      <Separator className="my-1.5" />
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-foreground">Net Payout</span>
                        <span className="font-bold text-primary">{formatAUD(previewData.totalNet)}</span>
                      </div>
                    </div>
                  )}

                  {/* Ready badge */}
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium text-primary">
                      Ready to create settlement & prepare for Xero
                    </span>
                  </div>
                </div>
              )}

              {/* Wrong file warning */}
              {status === 'wrong_file' && detection && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <p className="text-sm">{detection.wrongFileMessage}</p>
                  </div>
                  {detection.correctReportPath && (
                    <div className="bg-amber-100/60 dark:bg-amber-900/20 rounded-md px-3 py-2">
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        📥 <span className="font-medium">Correct file:</span> {detection.correctReportPath}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Unknown — offer AI analysis */}
              {status === 'unknown' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">Could not identify this file format.</p>
                  <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => onAnalyzeAI(idx)}>
                    <Sparkles className="h-3 w-3" />
                    Analyze with AI
                  </Button>
                  <Select onValueChange={(code) => onOverride(idx, code)}>
                    <SelectTrigger className="h-7 text-xs w-auto min-w-[120px]">
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
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-purple-500 animate-pulse" />
                  <p className="text-xs text-purple-600 dark:text-purple-400">AI is analyzing your file structure...</p>
                </div>
              )}

              {/* Saving */}
              {status === 'saving' && (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">Creating settlements...</p>
                </div>
              )}

              {/* Saved */}
              {status === 'saved' && df.savedCount !== undefined && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    {df.savedCount} settlement{df.savedCount !== 1 ? 's' : ''} created & ready for Xero
                  </p>
                </div>
              )}

              {/* Error */}
              {status === 'error' && df.error && (
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{df.error}</p>
                </div>
              )}
            </div>
          </div>

          {/* Actions column */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {status === 'detected' && detection?.isSettlementFile && (
              <Button size="sm" className="text-xs h-8 gap-1" onClick={() => onProcess(idx)}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Create Settlement
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
      </CardContent>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureMarketplaceConnection(marketplaceCode: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: existing } = await supabase
      .from('marketplace_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('marketplace_code', marketplaceCode)
      .maybeSingle();

    if (existing) return;

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
