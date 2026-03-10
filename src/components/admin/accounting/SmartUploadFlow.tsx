/**
 * SmartUploadFlow — Universal file upload with 3-level detection
 * 
 * Users drop any CSV/TSV/XLSX/PDF files and Xettle:
 * 1. Detects the marketplace (fingerprint → heuristic → AI)
 * 2. Shows a settlement preview with financial breakdown
 * 3. Creates settlements with one-click confirmation
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Upload, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Sparkles, ArrowRight, Info, Trash2, FileSpreadsheet, FileText,
  DollarSign, Calendar, HelpCircle, ChevronDown, ExternalLink, Eye, LayoutDashboard,
  MapPin, RefreshCw, ShoppingBag, Link2,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { detectUnknownEntities, type UnknownEntity } from '@/utils/entity-detection';
import UnknownEntityDialog from './UnknownEntityDialog';
import FirstContactModal from './FirstContactModal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { detectFile, extractFileHeaders, MARKETPLACE_LABELS, needsFirstContact, confidenceTier, scrubSampleRows, type FileDetectionResult, type ColumnMapping } from '@/utils/file-fingerprint-engine';
import type { MissingSettlement } from '@/components/dashboard/ActionCentre';
import { parseGenericCSV, parseGenericXLSX } from '@/utils/generic-csv-parser';
import { parseShopifyPayoutCSV } from '@/utils/shopify-payments-parser';
import { parseShopifyOrdersCSV } from '@/utils/shopify-orders-parser';
import { parseBunningsSummaryPdf } from '@/utils/bunnings-summary-parser';
import { parseWoolworthsMarketPlusCSV } from '@/utils/woolworths-marketplus-parser';
import { saveSettlement, type StandardSettlement } from '@/utils/settlement-engine';
import { MARKETPLACE_CATALOG } from './MarketplaceSwitcher';
import {
  detectMultiMarketplace,
  parseCSVForSplitDetection,
  saveSplitFingerprint,
  type MultiMarketplaceSplitResult,
  type MarketplaceGroup,
} from '@/utils/multi-marketplace-splitter';
import MultiMarketplaceSplitCard from './MultiMarketplaceSplitCard';

// ─── Types ──────────────────────────────────────────────────────────────────

type FileStatus = 'detecting' | 'detected' | 'reviewing' | 'wrong_file' | 'unknown' | 'first_contact' | 'ai_analyzing' | 'confirmed' | 'saving' | 'saved' | 'error' | 'multi_split';

interface DetectedFile {
  file: File;
  status: FileStatus;
  detection: FileDetectionResult | null;
  overrideMarketplace?: string;
  settlements?: StandardSettlement[];
  error?: string;
  savedCount?: number;
  /** Multi-marketplace split detection result */
  splitResult?: MultiMarketplaceSplitResult;
  /** CSV headers for caching fingerprint */
  csvHeaders?: string[];
  /** Sample rows from file (first 3 data rows) */
  sampleRows?: string[][];
  /** Whether this file was low-confidence (for post-save banner) */
  wasLowConfidence?: boolean;
}

interface SmartUploadFlowProps {
  onSettlementsSaved?: () => void;
  onMarketplacesChanged?: () => void;
  onViewSettlements?: () => void;
  missingSettlements?: MissingSettlement[];
  onReturnToDashboard?: () => void;
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
  shopify_orders: 'bg-lime-600',
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

const MARKETPLACE_SOURCE_HINTS: Record<string, string> = {
  amazon_au: 'Seller Central → Reports → Payments → All Statements → Download Flat File V2',
  shopify_payments: 'Shopify Admin → Finances → Payouts → Export CSV',
  bigw: 'Provided by Big W via email or marketplace portal',
  everyday_market: 'Provided by Everyday Market via email or marketplace portal',
  mydeal: 'Provided by MyDeal via email or marketplace portal',
  bunnings: 'Bunnings Marketplace portal → Sales Summary PDF',
  kogan: 'Provided by Kogan via email or marketplace portal',
  catch: 'Provided by Catch via email or marketplace portal',
  ebay_au: 'eBay Seller Hub → Payments → Reports → Download CSV',
  woolworths_marketplus: 'Woolworths MarketPlus portal → Reports → Download CSV',
  theiconic: 'Provided by THE ICONIC via email or marketplace portal',
  etsy: 'Etsy Shop Manager → Finances → Payment account → Download CSV',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function SmartUploadFlow({ onSettlementsSaved, onMarketplacesChanged, onViewSettlements, missingSettlements, onReturnToDashboard }: SmartUploadFlowProps) {
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [processingAll, setProcessingAll] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [unknownEntities, setUnknownEntities] = useState<UnknownEntity[]>([]);
  const [showEntityDialog, setShowEntityDialog] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [hasShopifyConnection, setHasShopifyConnection] = useState(false);
  const [shopifyTokenInvalid, setShopifyTokenInvalid] = useState(false);
  const [shopifyShopDomain, setShopifyShopDomain] = useState<string | null>(null);
  const [firstContactIdx, setFirstContactIdx] = useState<number | null>(null);
  const [showNewFormatBanner, setShowNewFormatBanner] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<DetectedFile[]>([]);
  filesRef.current = files;

  // Check if Shopify is connected and validate the token
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('shopify_tokens').select('id, scope, shop_domain').limit(1);
      if (!data || data.length === 0) {
        setHasShopifyConnection(false);
        return;
      }
      const token = data[0] as any;
      setShopifyShopDomain(token.shop_domain || null);
      
      // If scope is 'custom_app', it's a manual token that needs OAuth re-auth
      if (token.scope === 'custom_app') {
        setHasShopifyConnection(true);
        setShopifyTokenInvalid(true);
        return;
      }

      // Validate the token actually works by calling the edge function with a dry-run
      try {
        const { data: result } = await supabase.functions.invoke('fetch-shopify-payouts', {
          body: { dryRun: true },
        });
        if (result?.error === 'Shopify token invalid or expired') {
          setHasShopifyConnection(true);
          setShopifyTokenInvalid(true);
        } else {
          setHasShopifyConnection(true);
          setShopifyTokenInvalid(false);
        }
      } catch {
        // If validation fails, still show connected but mark as potentially invalid
        setHasShopifyConnection(true);
        setShopifyTokenInvalid(true);
      }
    })();
  }, []);

  const handleShopifySync = useCallback(async () => {
    setShopifySyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-shopify-payouts', {});
      if (error) throw error;
      if (data?.error) {
        // Handle invalid/expired token
        if (data.error === 'Shopify token invalid or expired') {
          setShopifyTokenInvalid(true);
          toast.error('Shopify token is invalid. Please reconnect via OAuth in Settings.');
          return;
        }
        if (data.message) {
          toast(data.message);
        } else {
          throw new Error(data.error);
        }
        return;
      }
      const synced = data?.synced || 0;
      const skipped = data?.skipped || 0;
      if (synced > 0) {
        toast.success(`Synced ${synced} Shopify payout${synced > 1 ? 's' : ''} via API`);
        onSettlementsSaved?.();
      } else {
        toast.info(`All Shopify payouts already imported (${skipped} checked)`);
      }
    } catch (err: any) {
      // Also catch 401 from the function invoke
      if (err.message?.includes('401') || err.message?.includes('invalid') || err.message?.includes('expired')) {
        setShopifyTokenInvalid(true);
        toast.error('Shopify token is invalid. Please reconnect via OAuth in Settings.');
      } else {
        toast.error(`Shopify sync failed: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setShopifySyncing(false);
    }
  }, [onSettlementsSaved]);

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

      if (marketplace === 'shopify_orders') {
        const text = await file.text();
        const result = parseShopifyOrdersCSV(text);
        if (!result.success) return [];

        // Run entity detection on all parsed orders to find unknown tags
        const allOrders = [...result.groups, ...result.unknownGroups].flatMap(g => g.orders);
        if (allOrders.length > 0) {
          try {
            const entityResult = await detectUnknownEntities(allOrders);
            if (entityResult.unknowns.length > 0) {
              setUnknownEntities(entityResult.unknowns);
              setShowEntityDialog(true);
            }
          } catch { /* silent — don't block parsing */ }
        }

        return result.settlements;
      }

      if (marketplace === 'woolworths_marketplus') {
        const text = await file.text();
        const result = parseWoolworthsMarketPlusCSV(text);
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
    // Dedup 1: skip files already in the current list (by name + size) — but allow re-upload if previous attempt was an error
    const currentFiles = filesRef.current;
    const replaceableIndices: number[] = [];
    const uniqueFiles = newFiles.filter(f => {
      const existingIdx = currentFiles.findIndex(
        existing => existing.file.name === f.name && existing.file.size === f.size
      );
      if (existingIdx >= 0) {
        const existing = currentFiles[existingIdx];
        // Allow re-upload if previous was error (e.g. stale duplicate check)
        if (existing.status === 'error') {
          replaceableIndices.push(existingIdx);
          return true;
        }
        toast.warning(`"${f.name}" is already in the upload list — skipped.`, { duration: 4000 });
        return false;
      }
      return true;
    });

    // Remove stale error entries that are being re-uploaded
    if (replaceableIndices.length > 0) {
      setFiles(prev => prev.filter((_, i) => !replaceableIndices.includes(i)));
    }

    if (uniqueFiles.length === 0) return;

    const detectedFiles: DetectedFile[] = uniqueFiles.map(f => ({
      file: f,
      status: 'detecting' as FileStatus,
      detection: null,
    }));
    setFiles(prev => [...prev, ...detectedFiles]);

    // Track which marketplaces we've already auto-created tabs for in this batch
    const createdTabs = new Set<string>();

    const results = await Promise.allSettled(
      uniqueFiles.map(async (file, idx) => {
        // ── Step 0: For CSV files, check for multi-marketplace split ──
        const isCSV = file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.tsv');
        if (isCSV) {
          try {
            const text = await file.text();
            const parsed = parseCSVForSplitDetection(text);
            if (parsed) {
              const splitResult = detectMultiMarketplace({ headers: parsed.headers, rows: parsed.rows, filename: file.name });
              if (splitResult.isMultiMarketplace && splitResult.groups.length > 1) {
                // Multi-marketplace detected — return early with split result
                return { idx, result: null, settlements: [] as StandardSettlement[], dbDupeIds: [] as string[], splitResult, csvHeaders: parsed.headers, sampleRows: parsed.rows.slice(0, 3).map((r: any) => parsed.headers.map((h: string) => String(r[h] || ''))) };
              }
            }
          } catch { /* Fall through to normal detection */ }
        }

        const result = await detectFile(file);
        let settlements: StandardSettlement[] = [];
        if (result && result.isSettlementFile) {
          settlements = await preParseFile(file, result);

          // Create the marketplace tab immediately on detection (before save)
          const mktCode = result.marketplace;
          if (mktCode && mktCode !== 'amazon_au') {
            if (mktCode === 'woolworths_marketplus' && settlements.length > 0) {
              const subCodes = new Set(settlements.map(s => {
                const subCode = s.metadata?.marketplaceCode;
                return subCode || mktCode;
              }));
              for (const code of subCodes) {
                if (!createdTabs.has(code)) {
                  createdTabs.add(code);
                  await ensureMarketplaceConnection(code);
                }
              }
              onMarketplacesChanged?.();
            } else if (mktCode === 'shopify_orders' && settlements.length > 0) {
              const subCodes = new Set(settlements.map(s => {
                const subKey = s.metadata?.marketplaceKey;
                return subKey || mktCode;
              }).filter(c => c !== 'unknown' && c !== 'shopify_orders'));
              for (const code of subCodes) {
                if (!createdTabs.has(code)) {
                  createdTabs.add(code);
                  await ensureMarketplaceConnection(code);
                }
              }
              onMarketplacesChanged?.();
            } else if (!createdTabs.has(mktCode)) {
              createdTabs.add(mktCode);
              await ensureMarketplaceConnection(mktCode);
              onMarketplacesChanged?.();
            }
          }
        }

        // Dedup 2: check if any parsed settlement already exists in DB
        let dbDupeIds: string[] = [];
        if (settlements.length > 0) {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const ids = settlements.map(s => s.settlement_id);
              const { data: existing } = await supabase
                .from('settlements')
                .select('settlement_id')
                .eq('user_id', user.id)
                .in('settlement_id', ids);
              dbDupeIds = (existing || []).map((e: any) => e.settlement_id);
            }
          } catch {}
        }

        // Extract sample rows for First Contact
        let sampleRows: string[][] = [];
        try {
          const extracted = await extractFileHeaders(file);
          if (extracted) {
            sampleRows = extracted.sampleRows;
          }
        } catch {}

        return { idx, result, settlements, dbDupeIds, splitResult: undefined as MultiMarketplaceSplitResult | undefined, csvHeaders: undefined as string[] | undefined, sampleRows };
      })
    );

    setFiles(prev => {
      const updated = [...prev];
      const offset = prev.length - uniqueFiles.length;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { idx, result, settlements, dbDupeIds, splitResult, csvHeaders, sampleRows } = r.value;
          const fileIdx = offset + idx;
          if (fileIdx < updated.length) {
            // If multi-marketplace split detected, show confirmation card
            if (splitResult?.isMultiMarketplace) {
              updated[fileIdx] = {
                ...updated[fileIdx],
                status: 'multi_split',
                splitResult,
                csvHeaders,
                sampleRows,
                detection: {
                  marketplace: 'multi_marketplace',
                  marketplaceLabel: `${splitResult.groups.length} Marketplaces`,
                  confidence: 95,
                  isSettlementFile: true,
                  detectionLevel: 1,
                },
              };
              continue;
            }

            // If ALL settlements are already in DB, mark as saved/dupe
            const allDupes = settlements.length > 0 && dbDupeIds.length === settlements.length;
            const someDupes = dbDupeIds.length > 0 && !allDupes;

            // Check if First Contact modal should be triggered
            const isFirstContact = result && result.isSettlementFile && needsFirstContact(result);

            let status: FileStatus = result
              ? (result.isSettlementFile ? (isFirstContact ? 'first_contact' : 'detected') : 'wrong_file')
              : 'unknown';

            let error: string | undefined;
            if (allDupes) {
              status = 'error';
              error = `Already saved — ${dbDupeIds.length} settlement${dbDupeIds.length > 1 ? 's' : ''} from this file already exist in your account.`;
            }

            updated[fileIdx] = {
              ...updated[fileIdx],
              detection: result,
              settlements: settlements.length > 0 ? settlements : undefined,
              status,
              error,
              csvHeaders: result ? (csvHeaders || undefined) : undefined,
              sampleRows: sampleRows || undefined,
              wasLowConfidence: isFirstContact || false,
            };

            if (someDupes) {
              toast.info(`${dbDupeIds.length} of ${settlements.length} settlements from "${uniqueFiles[idx].name}" already exist — duplicates will be skipped on save.`, { duration: 6000 });
            }
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
        confidenceReason: data?.confidence_reason || undefined,
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
        } else if (marketplace === 'shopify_orders') {
          const text = await df.file.text();
          const result = parseShopifyOrdersCSV(text);
          if (!result.success) throw new Error('error' in result ? result.error : 'Shopify Orders parse failed');
          settlements = result.settlements;
        } else if (marketplace === 'woolworths_marketplus') {
          const text = await df.file.text();
          const result = parseWoolworthsMarketPlusCSV(text);
          if (!result.success) throw new Error('error' in result ? result.error : 'Woolworths MarketPlus parse failed');
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

      // For woolworths_marketplus, ensure sub-marketplace connections exist
      if (marketplace === 'woolworths_marketplus') {
        const subCodes = new Set(settlements.map(s => s.metadata?.marketplaceCode).filter(Boolean));
        for (const code of subCodes) {
          await ensureMarketplaceConnection(code as string);
        }
      } else if (marketplace === 'shopify_orders') {
        // Shopify Orders splits into sub-marketplaces (kogan, mydeal, bunnings, etc.)
        const subCodes = new Set(settlements.map(s => s.metadata?.marketplaceKey).filter(c => c && c !== 'unknown'));
        for (const code of subCodes) {
          await ensureMarketplaceConnection(code as string);
        }
      } else {
        await ensureMarketplaceConnection(marketplace);
      }

      let savedCount = 0;
      let dupCount = 0;

      // For Woolworths MarketPlus, parse the raw rows for drill-down
      let woolworthsRows: any[] = [];
      if (marketplace === 'woolworths_marketplus' && df.settlements) {
        try {
          const text = await df.file.text();
          const { parseWoolworthsMarketPlusCSV: parse } = await import('@/utils/woolworths-marketplus-parser');
          const parsed = parse(text);
          if (parsed.success) woolworthsRows = parsed.allRows;
        } catch { /* silent */ }
      }

      const { data: { user } } = await supabase.auth.getUser();

      for (const s of settlements) {
        const result = await saveSettlement(s);
        if (result.success) {
          savedCount++;

          // Save settlement_lines for drill-down
          if (user && marketplace === 'woolworths_marketplus' && woolworthsRows.length > 0) {
            const orderSource = s.metadata?.orderSource;
            const groupRows = woolworthsRows.filter((r: any) => r.orderSource === orderSource);
            if (groupRows.length > 0) {
              const lineRows = groupRows.map((row: any) => ({
                user_id: user.id,
                settlement_id: s.settlement_id,
                order_id: row.orderId || null,
                sku: row.sku || null,
                amount: row.netAmount || 0,
                amount_type: row.totalSalePrice < 0 ? 'refund' : 'order',
                amount_description: row.product ? row.product.substring(0, 100) : null,
                transaction_type: row.totalSalePrice < 0 ? 'Refund' : (row.commissionFee !== 0 && row.totalSalePrice === 0 ? 'Fee' : 'Order'),
                posted_date: row.orderedDate || null,
                marketplace_name: s.metadata?.displayName || orderSource,
                accounting_category: row.totalSalePrice < 0 ? 'refunds' : (row.totalSalePrice === 0 ? 'fees' : 'sales'),
              }));
              for (let i = 0; i < lineRows.length; i += 500) {
                await supabase.from('settlement_lines').insert(lineRows.slice(i, i + 500) as any);
              }
            }
          }
          // ── Save settlement_lines for Shopify Orders ──
          if (user && marketplace === 'shopify_orders') {
            try {
              const text = await df.file.text();
              const soResult = parseShopifyOrdersCSV(text);
              if (soResult.success) {
                const mktKey = s.metadata?.marketplaceKey;
                const group = [...soResult.groups, ...soResult.unknownGroups].find(
                  g => g.marketplaceKey === mktKey && g.currency === (s.metadata?.currency || 'AUD')
                );
                if (group && group.orders.length > 0) {
                  const lineRows = group.orders.map(order => ({
                    user_id: user.id,
                    settlement_id: s.settlement_id,
                    order_id: order.name,
                    sku: order.lineitemSku || null,
                    amount: order.total,
                    amount_type: 'order_total',
                    amount_description: `${order.lineitemSku || 'N/A'} × ${order.lineitemQuantity}`,
                    transaction_type: 'Order',
                    posted_date: order.paidAt ? order.paidAt.split('T')[0] : null,
                    marketplace_name: s.metadata?.displayName || mktKey,
                    accounting_category: 'sales',
                  }));
                  for (let i = 0; i < lineRows.length; i += 500) {
                    await supabase.from('settlement_lines').insert(lineRows.slice(i, i + 500) as any);
                  }
                }
              }
            } catch { /* silent */ }
          }
          // ── Save settlement_lines for Shopify Payments ──
          if (user && marketplace === 'shopify_payments') {
            try {
              const text = await df.file.text();
              const spResult = parseShopifyPayoutCSV(text);
              if (spResult.success) {
                const csvFormat = s.metadata?.csvFormat;
                if (csvFormat === 'transaction_level' && spResult.rowsByPayout) {
                  const payoutRows = spResult.rowsByPayout.get(s.settlement_id) || [];
                  if (payoutRows.length > 0) {
                    const lineRows = payoutRows.map(row => ({
                      user_id: user.id,
                      settlement_id: s.settlement_id,
                      order_id: row.order || null,
                      sku: null,
                      amount: row.net,
                      amount_type: row.type === 'refund' ? 'refund' : row.type === 'charge' || row.type === 'sale' ? 'order' : 'adjustment',
                      amount_description: row.type ? `${row.type}${row.order ? ` — ${row.order}` : ''}` : null,
                      transaction_type: row.type || 'charge',
                      posted_date: row.transactionDate ? (row.transactionDate.length >= 10 ? row.transactionDate.substring(0, 10) : row.transactionDate) : null,
                      marketplace_name: 'Shopify Payments',
                      accounting_category: row.type === 'refund' ? 'refunds' : row.fee !== 0 ? 'fees' : 'sales',
                    }));
                    for (let i = 0; i < lineRows.length; i += 500) {
                      await supabase.from('settlement_lines').insert(lineRows.slice(i, i + 500) as any);
                    }
                  }
                } else if (csvFormat === 'payout_level') {
                  // Save 3 summary lines so drill-down shows something
                  const summaryLines = [
                    { user_id: user.id, settlement_id: s.settlement_id, amount: s.metadata?.grossSalesInclGst || s.sales_ex_gst, amount_type: 'order', transaction_type: 'Summary', amount_description: 'Charges total', marketplace_name: 'Shopify Payments', accounting_category: 'sales' },
                    { user_id: user.id, settlement_id: s.settlement_id, amount: s.metadata?.refundsInclGst || 0, amount_type: 'refund', transaction_type: 'Summary', amount_description: 'Refunds total', marketplace_name: 'Shopify Payments', accounting_category: 'refunds' },
                    { user_id: user.id, settlement_id: s.settlement_id, amount: s.fees_ex_gst || 0, amount_type: 'fee', transaction_type: 'Summary', amount_description: 'Fees total', marketplace_name: 'Shopify Payments', accounting_category: 'fees' },
                  ].filter(l => l.amount !== 0);
                  if (summaryLines.length > 0) {
                    await supabase.from('settlement_lines').insert(summaryLines as any);
                  }
                }
              }
            } catch { /* silent — don't fail save for line saving issues */ }
          }

          // ── Save settlement_lines for Generic CSV ──
          if (user && marketplace !== 'woolworths_marketplus' && marketplace !== 'shopify_payments' && marketplace !== 'shopify_orders' && marketplace !== 'amazon_au' && marketplace !== 'bunnings') {
            try {
              const text = await df.file.text();
              const csvLines = text.split('\n').filter(l => l.trim());
              if (csvLines.length > 1) {
                const headers = csvLines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
                const mapping = df.detection?.columnMapping || {};
                const lineRows: any[] = [];
                for (let ri = 1; ri < csvLines.length && ri <= 500; ri++) {
                  const fields = csvLines[ri].split(',').map(f => f.trim().replace(/^"|"$/g, ''));
                  if (fields.length < 2) continue;
                  const rawRow: Record<string, string> = {};
                  headers.forEach((h, hi) => { rawRow[h] = fields[hi] || ''; });
                  
                  const orderCol = mapping.order_id;
                  const dateCol = mapping.period_start;
                  const salesCol = mapping.gross_sales;
                  const netCol = mapping.net_payout;
                  const feesCol = mapping.fees;
                  
                  lineRows.push({
                    user_id: user.id,
                    settlement_id: s.settlement_id,
                    order_id: orderCol ? (rawRow[orderCol] || null) : null,
                    amount: netCol ? parseFloat((rawRow[netCol] || '0').replace(/[^0-9.\-]/g, '')) || 0 : (salesCol ? parseFloat((rawRow[salesCol] || '0').replace(/[^0-9.\-]/g, '')) || 0 : 0),
                    amount_type: 'order',
                    amount_description: Object.values(rawRow).filter(v => v && v.length < 60).slice(0, 2).join(' — ') || null,
                    transaction_type: 'Order',
                    posted_date: dateCol ? (rawRow[dateCol] || null) : null,
                    marketplace_name: MARKETPLACE_LABELS[marketplace] || marketplace,
                    accounting_category: 'sales',
                  });
                }
                if (lineRows.length > 0) {
                  for (let i = 0; i < lineRows.length; i += 500) {
                    await supabase.from('settlement_lines').insert(lineRows.slice(i, i + 500) as any);
                  }
                }
              }
            } catch { /* silent */ }
          }

          // ── Save settlement_lines for Bunnings PDF ──
          if (user && marketplace === 'bunnings') {
            try {
              const summaryLines = [
                { user_id: user.id, settlement_id: s.settlement_id, amount: s.sales_ex_gst, amount_type: 'order', transaction_type: 'Summary', amount_description: 'Bunnings sales total (ex GST)', marketplace_name: 'Bunnings Marketplace', accounting_category: 'sales' },
                { user_id: user.id, settlement_id: s.settlement_id, amount: s.fees_ex_gst, amount_type: 'fee', transaction_type: 'Summary', amount_description: 'Bunnings commission (ex GST)', marketplace_name: 'Bunnings Marketplace', accounting_category: 'fees' },
                { user_id: user.id, settlement_id: s.settlement_id, amount: s.gst_on_sales, amount_type: 'tax', transaction_type: 'Summary', amount_description: 'GST on sales', marketplace_name: 'Bunnings Marketplace', accounting_category: 'gst' },
              ].filter(l => l.amount !== 0);
              if (summaryLines.length > 0) {
                await supabase.from('settlement_lines').insert(summaryLines as any);
              }
            } catch { /* silent */ }
          }

        } else if (result.duplicate) dupCount++;
        else console.error(`Failed to save settlement ${s.settlement_id}:`, result.error);
      }

      const label = MARKETPLACE_LABELS[marketplace] || marketplace;
      if (savedCount > 0) {
        toast.success(`${label}: ${savedCount} settlement${savedCount > 1 ? 's' : ''} created ✓${dupCount > 0 ? ` (${dupCount} duplicates skipped)` : ''}`);
      } else if (dupCount > 0) {
        toast.info(`${label}: All ${dupCount} settlement${dupCount > 1 ? 's' : ''} already exist (duplicates skipped).`);
      }

      // ── Learning loop: save fingerprint for low-confidence files ──
      if (df.wasLowConfidence && savedCount > 0) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            // Extract headers for fingerprint
            const extracted = await extractFileHeaders(df.file);
            if (extracted) {
              // Save to marketplace_file_fingerprints
              await supabase.from('marketplace_file_fingerprints').insert({
                user_id: user.id,
                marketplace_code: marketplace,
                column_signature: extracted.headers as any,
                column_mapping: df.detection?.columnMapping || {} as any,
                is_multi_marketplace: false,
                file_pattern: df.file.name.replace(/\d+/g, '*'),
              } as any);

              // Create bug report for admin visibility
              const scrubbedSample = scrubSampleRows(extracted.headers, extracted.sampleRows.slice(0, 3));
              await supabase.from('bug_reports').insert({
                submitted_by: user.id,
                ai_classification: 'New marketplace saved',
                description: `User confirmed new marketplace: ${MARKETPLACE_LABELS[marketplace] || marketplace}. Column signature saved to fingerprints. File: ${df.file.name}. Confidence was ${df.detection?.confidence || 0}%.`,
                console_errors: JSON.stringify({
                  type: 'new_marketplace_saved',
                  filename: df.file.name,
                  confidence: df.detection?.confidence || 0,
                  marketplace,
                  headers: extracted.headers,
                  sampleRows: scrubbedSample,
                }),
                severity: 'low',
                status: 'open',
                page_url: window.location.pathname,
              } as any);
            }
          }
        } catch { /* silent — don't fail save for learning loop */ }

        // Show post-save validation banner
        setShowNewFormatBanner(true);
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
      const s = currentFiles[i].status;
      if ((s === 'detected' || s === 'reviewing') && currentFiles[i].detection?.isSettlementFile) {
        await processFile(i);
      }
    }
    setProcessingAll(false);
  }, [processFile]);

  // ── Set file status (for review flow) ──
  const setFileStatus = useCallback((idx: number, status: FileStatus) => {
    setFiles(prev => {
      const updated = [...prev];
      if (idx < updated.length) {
        updated[idx] = { ...updated[idx], status };
      }
      return updated;
    });
  }, []);

  const readyFiles = files.filter(f => (f.status === 'detected' || f.status === 'reviewing') && f.detection?.isSettlementFile);
  const confirmedCount = readyFiles.length;
  const savedCount = files.filter(f => f.status === 'saved').length;
  const totalSettlements = readyFiles.reduce((sum, f) => sum + (f.settlements?.length || 0), 0);
  const hasFiles = files.length > 0;

  // ── Missing settlements checklist ──
  const hasMissingChecklist = missingSettlements && missingSettlements.length > 0;
  const checkedItems = useMemo(() => {
    if (!missingSettlements || missingSettlements.length === 0) return new Set<number>();
    const matched = new Set<number>();
    const savedFiles = files.filter(f => f.status === 'saved' && f.detection);
    for (let mi = 0; mi < missingSettlements.length; mi++) {
      const ms = missingSettlements[mi];
      const isMatched = savedFiles.some(sf => {
        const mkt = sf.overrideMarketplace || sf.detection?.marketplace || '';
        if (mkt !== ms.marketplace_code) return false;
        // Check if any settlement period overlaps
        if (sf.settlements) {
          return sf.settlements.some(s => {
            const sPeriod = new Date(s.period_start + 'T00:00:00');
            const msPeriod = new Date(ms.period_start + 'T00:00:00');
            return sPeriod.getMonth() === msPeriod.getMonth() && sPeriod.getFullYear() === msPeriod.getFullYear();
          });
        }
        return true; // marketplace matched at minimum
      });
      if (isMatched) matched.add(mi);
    }
    return matched;
  }, [missingSettlements, files]);

  const allMissingUploaded = hasMissingChecklist && checkedItems.size === missingSettlements!.length;

  return (
    <div className="space-y-4">
      {/* Missing settlements checklist banner */}
      {hasMissingChecklist && (
        <Card className={`border-amber-200 dark:border-amber-800 ${allMissingUploaded ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50/50 dark:bg-amber-900/10'} sticky top-0 z-10`}>
          <CardContent className="py-4">
            {allMissingUploaded ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">All caught up!</p>
                    <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">All missing settlements have been uploaded.</p>
                  </div>
                </div>
                {onReturnToDashboard && (
                  <Button size="sm" className="gap-2" onClick={onReturnToDashboard}>
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Return to Dashboard
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-sm font-semibold text-foreground">Files needed</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasShopifyConnection && missingSettlements!.some(ms => ms.marketplace_code === 'shopify_payments') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5"
                        disabled={shopifySyncing}
                        onClick={handleShopifySync}
                      >
                        {shopifySyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        {shopifySyncing ? 'Syncing...' : 'Sync Shopify'}
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {checkedItems.size} of {missingSettlements!.length} uploaded
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {missingSettlements!.map((ms, i) => {
                    const done = checkedItems.has(i);
                    const pStart = new Date(ms.period_start + 'T00:00:00');
                    const pEnd = new Date(ms.period_end + 'T00:00:00');
                    const monthLabel = pStart.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
                    const dateRange = `${pStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${pEnd.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
                    const sourceHint = MARKETPLACE_SOURCE_HINTS[ms.marketplace_code] || 'Check your marketplace portal or email';
                    const isShopifyAutoSync = ms.marketplace_code === 'shopify_payments' && hasShopifyConnection;
                    return (
                      <div
                        key={`${ms.marketplace_code}-${ms.period_start}`}
                        className={`flex items-start gap-2 px-3 py-2 rounded-md transition-all ${
                          done
                            ? 'bg-emerald-100/80 dark:bg-emerald-900/30 opacity-70'
                            : shopifySyncing && isShopifyAutoSync
                              ? 'bg-blue-50/80 dark:bg-blue-900/20'
                              : 'bg-background/80'
                        }`}
                      >
                        {done ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                        ) : shopifySyncing && isShopifyAutoSync ? (
                          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className={`flex items-center gap-1.5 ${done ? 'line-through' : ''}`}>
                            <span className="text-xs font-medium text-foreground">{ms.marketplace_label}</span>
                            <span className="text-xs text-muted-foreground">— {monthLabel}</span>
                            {isShopifyAutoSync && !done && !shopifySyncing && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400">
                                Auto-sync
                              </Badge>
                            )}
                            {shopifySyncing && isShopifyAutoSync && (
                              <span className="text-[10px] text-blue-500">Auto-syncing...</span>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="text-muted-foreground/60 hover:text-muted-foreground" onClick={e => e.stopPropagation()}>
                                  <HelpCircle className="h-3 w-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                <p className="font-medium mb-0.5">
                                  {isShopifyAutoSync ? 'Auto-sync available:' : 'Where to find this file:'}
                                </p>
                                <p>{isShopifyAutoSync ? 'Click "Sync Shopify" above to pull payouts automatically via API. Manual CSV upload also works as fallback.' : sourceHint}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          {!done && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {ms.estimated_amount
                                ? `Est. $${ms.estimated_amount.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : 'Est. amount unknown'}
                              {' · '}
                              {dateRange}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* Shopify Connection / Sync Banners */}
      {!hasShopifyConnection && (
        <ShopifyConnectBanner />
      )}
      {hasShopifyConnection && shopifyTokenInvalid && (
        <ShopifyReconnectBanner shopDomain={shopifyShopDomain} />
      )}
      {hasShopifyConnection && !shopifyTokenInvalid && (
        <ShopifySyncBanner
          onSync={handleShopifySync}
          syncing={shopifySyncing}
        />
      )}

      {/* Where to find your files — collapsible guide, auto-collapses when files uploaded */}
      <FileGuide forceCollapsed={hasFiles} />

      {/* File results */}
      {hasFiles && (
        <div className="space-y-3">
          {/* Top bulk action — Review All or Save All depending on state */}
          {(() => {
            const reviewingFiles = files.filter(f => f.status === 'reviewing' && f.detection?.isSettlementFile);
            const detectedOnly = files.filter(f => f.status === 'detected' && f.detection?.isSettlementFile);
            const reviewingSettlements = reviewingFiles.reduce((sum, f) => sum + (f.settlements?.length || 0), 0);
            
            if (reviewingFiles.length > 0) {
              // Some files are in review — offer bulk save
              return (
                <Button
                  onClick={processAllConfirmed}
                  disabled={processingAll}
                  size="lg"
                  className="w-full gap-2 text-base py-6"
                >
                  {processingAll ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5" />
                  )}
                  Confirm & Save {reviewingSettlements > 1 ? `${reviewingSettlements} Settlements` : 'Settlement'}
                </Button>
              );
            }
            if (detectedOnly.length > 0) {
              // Files detected but not yet reviewed
              return (
                <Button
                  onClick={() => {
                    // Open all detected files for review
                    const currentFiles = filesRef.current;
                    setFiles(prev => prev.map((f, i) => 
                      f.status === 'detected' && f.detection?.isSettlementFile 
                        ? { ...f, status: 'reviewing' as FileStatus }
                        : f
                    ));
                  }}
                  size="lg"
                  variant="outline"
                  className="w-full gap-2 text-base py-6 border-primary/30 text-primary hover:bg-primary/5"
                >
                  <Eye className="h-5 w-5" />
                  Review All {totalSettlements > 1 ? `${totalSettlements} Settlements` : 'Settlement'}
                </Button>
              );
            }
            return null;
          })()}

          {files.map((df, idx) => (
            df.status === 'multi_split' && df.splitResult ? (
              <MultiMarketplaceSplitCard
                key={`${df.file.name}-${idx}`}
                filename={df.file.name}
                splitResult={df.splitResult}
                headers={df.csvHeaders || []}
                onConfirm={async (groups, rememberFormat) => {
                  // Save fingerprint if requested
                  if (rememberFormat && df.csvHeaders && df.splitResult?.splitColumn) {
                    await saveSplitFingerprint(df.csvHeaders, df.splitResult.splitColumn, groups);
                  }

                  // Now re-detect as woolworths_marketplus (the existing parser handles the actual splitting)
                  // The split confirmation just validates the user is happy with the grouping
                  // Re-run detection normally and proceed
                  const text = await df.file.text();
                  const result = await detectFile(df.file);
                  let settlements: StandardSettlement[] = [];
                  
                  if (result && result.isSettlementFile) {
                    settlements = await preParseFile(df.file, result);
                  }

                  // If the existing parser didn't handle it (generic CSV), we need to handle it ourselves
                  if (settlements.length === 0 && result) {
                    // Fall through — the file will be processed as a normal detected file
                  }

                  // Create marketplace tabs for detected groups
                  for (const g of groups) {
                    await ensureMarketplaceConnection(g.marketplaceCode);
                  }
                  onMarketplacesChanged?.();

                  setFiles(prev => {
                    const updated = [...prev];
                    updated[idx] = {
                      ...updated[idx],
                      status: 'detected',
                      detection: result || {
                        marketplace: 'woolworths_marketplus',
                        marketplaceLabel: `${groups.length} Marketplaces`,
                        confidence: 95,
                        isSettlementFile: true,
                        detectionLevel: 1,
                      },
                      settlements: settlements.length > 0 ? settlements : undefined,
                    };
                    return updated;
                  });
                }}
                onCancel={() => {
                  // Cancel split — re-detect as single file
                  setFiles(prev => {
                    const updated = [...prev];
                    updated[idx] = {
                      ...updated[idx],
                      status: 'detecting',
                      splitResult: undefined,
                    };
                    return updated;
                  });
                  // Re-run normal detection without split
                  (async () => {
                    const result = await detectFile(df.file);
                    const settlements = result?.isSettlementFile ? await preParseFile(df.file, result) : [];
                    setFiles(prev => {
                      const updated = [...prev];
                      updated[idx] = {
                        ...updated[idx],
                        status: result ? (result.isSettlementFile ? 'detected' : 'wrong_file') : 'unknown',
                        detection: result,
                        settlements: settlements.length > 0 ? settlements : undefined,
                        splitResult: undefined,
                      };
                      return updated;
                    });
                  })();
                }}
              />
            ) : (
              <FileResultCard
                key={`${df.file.name}-${idx}`}
                df={df}
                idx={idx}
                onRemove={removeFile}
                onOverride={overrideMarketplace}
                onAnalyzeAI={analyzeWithAI}
                onProcess={processFile}
                onSetStatus={setFileStatus}
                onFirstContact={(i) => setFirstContactIdx(i)}
              />
            )
          ))}

          {savedCount > 0 && confirmedCount === 0 && onViewSettlements && (
            <Card className="border-green-400/50 bg-green-50/30 dark:bg-green-950/10">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {savedCount} file{savedCount !== 1 ? 's' : ''} processed & saved ✓
                      </p>
                      <p className="text-xs text-muted-foreground">
                        View and manage your settlements in the Settlements tab
                      </p>
                    </div>
                  </div>
                  <Button onClick={onViewSettlements} className="gap-2">
                    <FileText className="h-4 w-4" />
                    View Settlements
                    <ArrowRight className="h-4 w-4" />
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
      {/* Post-save validation banner for new formats */}
      {showNewFormatBanner && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This was a new format for us. If anything looks wrong in your settlements, use the 🐛 Report Issue button — we'll fix it fast.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => setShowNewFormatBanner(false)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Unknown Entity Classification Dialog */}
      <UnknownEntityDialog
        open={showEntityDialog}
        onOpenChange={setShowEntityDialog}
        unknowns={unknownEntities}
        onClassified={(results) => {
          // If any were classified as marketplace, trigger marketplace tab creation
          const newMarketplaces = results.filter(r => r.type === 'marketplace');
          if (newMarketplaces.length > 0) {
            for (const mp of newMarketplaces) {
              ensureMarketplaceConnection(mp.name.toLowerCase().replace(/\s+/g, '_'));
            }
            onMarketplacesChanged?.();
          }
          setUnknownEntities([]);
        }}
      />

      {/* First Contact Modal for unknown/low-confidence files */}
      {firstContactIdx !== null && filesRef.current[firstContactIdx] && (() => {
        const df = filesRef.current[firstContactIdx];
        const extracted = df.csvHeaders || df.detection?.columnMapping ? Object.keys(df.detection?.columnMapping || {}) : [];
        const headers = df.csvHeaders || extracted;
        const sampleRows = df.sampleRows || [];
        return (
          <FirstContactModal
            open={true}
            onOpenChange={(open) => { if (!open) setFirstContactIdx(null); }}
            filename={df.file.name}
            headers={headers}
            sampleRows={sampleRows}
            rowCount={df.detection?.recordCount || 0}
            confidence={df.detection?.confidence || 0}
            confidenceTier={confidenceTier(df.detection?.confidence || 0)}
            detectedMarketplace={df.detection?.marketplace || 'unknown'}
            onConfirm={(code, name) => {
              // Override marketplace and move to detected
              setFiles(prev => {
                const updated = [...prev];
                if (firstContactIdx < updated.length) {
                  updated[firstContactIdx] = {
                    ...updated[firstContactIdx],
                    overrideMarketplace: code,
                    status: 'detected',
                    wasLowConfidence: true,
                    detection: {
                      ...(updated[firstContactIdx].detection || {
                        marketplace: code,
                        marketplaceLabel: name,
                        confidence: 100,
                        isSettlementFile: true,
                        detectionLevel: 2 as const,
                      }),
                      marketplace: code,
                      marketplaceLabel: name,
                      isSettlementFile: true,
                    },
                  };
                }
                return updated;
              });
              // Create marketplace tab
              ensureMarketplaceConnection(code);
              onMarketplacesChanged?.();
              setFirstContactIdx(null);
            }}
            onCancel={() => {
              setFiles(prev => {
                const updated = [...prev];
                if (firstContactIdx < updated.length) {
                  updated[firstContactIdx] = { ...updated[firstContactIdx], status: 'unknown' };
                }
                return updated;
              });
              setFirstContactIdx(null);
            }}
          />
        );
      })()}
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
  onSetStatus: (idx: number, status: FileStatus) => void;
}

function FileResultCard({ df, idx, onRemove, onOverride, onAnalyzeAI, onProcess, onSetStatus }: FileResultCardProps) {
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

  const isReviewing = status === 'reviewing';

  return (
    <Card className={`transition-all ${
      status === 'wrong_file' ? 'border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10' :
      status === 'error' ? 'border-destructive/30 bg-destructive/5' :
      status === 'saved' ? 'border-green-400/50 bg-green-50/30 dark:bg-green-950/10' :
      isReviewing ? 'border-primary/40 bg-primary/[0.03] ring-1 ring-primary/20' :
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
                  {(status === 'detected' || isReviewing) && detection
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

              {(status === 'detected' || isReviewing) && detection && (
                <div className="space-y-3">
                  {/* Shopify Orders special message */}
                  {marketplace === 'shopify_orders' && !isReviewing && (
                    <div className="flex items-center gap-2 bg-lime-100/60 dark:bg-lime-900/20 rounded-md px-3 py-2">
                      <CheckCircle2 className="h-4 w-4 text-lime-600 flex-shrink-0" />
                      <p className="text-xs text-lime-700 dark:text-lime-400 font-medium">
                        Shopify Orders export detected — splitting by marketplace automatically
                      </p>
                    </div>
                  )}
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
                  {detection.confidenceReason && (
                    <p className="text-[11px] italic text-muted-foreground mt-1">
                      Why we think this: {detection.confidenceReason}
                    </p>
                  )}

                  {/* Summary preview (collapsed view) */}
                  {!isReviewing && previewData && (
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
                          <span className="text-muted-foreground">Fees (ex GST)</span>
                          <span className="font-medium text-foreground">{formatAUD(previewData.totalFees)}</span>
                        </div>
                      </div>
                      <Separator className="my-1.5" />
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-foreground">Net Payout</span>
                        <span className="font-bold text-primary">{formatAUD(previewData.totalNet)}</span>
                      </div>
                    </div>
                  )}

                  {/* EXPANDED REVIEW — individual settlement details */}
                  {isReviewing && settlements && settlements.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Eye className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">
                          Review {settlements.length} Settlement{settlements.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      {settlements.map((s, sIdx) => {
                        const meta = s.metadata || {};
                        return (
                          <div key={sIdx} className="bg-muted/50 rounded-lg p-3 space-y-2 border border-border/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs font-semibold text-foreground">
                                  {formatDateRange(s.period_start, s.period_end)}
                                </span>
                              </div>
                              <Badge variant={s.reconciles ? 'default' : 'destructive'} className="text-[10px]">
                                {s.reconciles ? '✓ Reconciled' : '⚠ Check needed'}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground font-mono">ID: {s.settlement_id}</p>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Sales (ex GST)</span>
                                <span className="font-medium text-foreground">{formatAUD(s.sales_ex_gst)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">GST on Sales</span>
                                <span className="font-medium text-foreground">{formatAUD(s.gst_on_sales)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Fees (ex GST)</span>
                                <span className="font-medium text-foreground">{formatAUD(s.fees_ex_gst)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">GST on Fees</span>
                                <span className="font-medium text-foreground">{formatAUD(s.gst_on_fees)}</span>
                              </div>
                              {!!meta.refundsExGst && meta.refundsExGst !== 0 && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Refunds</span>
                                  <span className="font-medium text-foreground">{formatAUD(meta.refundsExGst)}</span>
                                </div>
                              )}
                              {!!meta.shippingExGst && meta.shippingExGst !== 0 && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Shipping</span>
                                  <span className="font-medium text-foreground">{formatAUD(meta.shippingExGst)}</span>
                                </div>
                              )}
                              {!!meta.subscriptionAmount && meta.subscriptionAmount !== 0 && (
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Subscription</span>
                                  <span className="font-medium text-foreground">{formatAUD(meta.subscriptionAmount)}</span>
                                </div>
                              )}
                            </div>
                            <Separator />
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-foreground">Net Payout</span>
                              <span className="font-bold text-primary">{formatAUD(s.net_payout)}</span>
                            </div>
                          </div>
                        );
                      })}

                      {/* Totals summary */}
                      {previewData && settlements.length > 1 && (
                        <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold text-foreground">Total across {settlements.length} settlements</span>
                            <span className="font-bold text-primary">{formatAUD(previewData.totalNet)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status badge */}
                  {!isReviewing && (
                    <div className="flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Click "Review" to inspect before saving
                      </span>
                    </div>
                  )}
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
                  <p className="text-xs text-muted-foreground">Saving settlements...</p>
                </div>
              )}

              {/* Saved */}
              {status === 'saved' && df.savedCount !== undefined && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    {df.savedCount} settlement{df.savedCount !== 1 ? 's' : ''} saved — review in Settlements tab
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
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {/* Detected: show Review button */}
            {status === 'detected' && detection?.isSettlementFile && (
              <Button size="default" variant="outline" className="gap-2 font-semibold" onClick={() => onSetStatus(idx, 'reviewing')}>
                <Eye className="h-4 w-4" />
                Review
              </Button>
            )}
            {/* Reviewing: show Save + Collapse */}
            {isReviewing && (
              <div className="flex flex-col gap-1.5">
                <Button size="default" className="gap-2 font-semibold" onClick={() => onProcess(idx)}>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm & Save
                </Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => onSetStatus(idx, 'detected')}>
                  Collapse
                </Button>
              </div>
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

// ─── File Guide ─────────────────────────────────────────────────────────────

const FILE_GUIDES = [
  {
    marketplace: 'Amazon AU',
    icon: '📦',
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    fileType: 'TSV (Tab-Separated)',
    fileName: 'Flat File V2 Settlement Report',
    steps: [
      'Log in to Seller Central',
      'Go to Reports → Payments → All Statements',
      'Click on a settlement period',
      'Download "Flat File V2" (not XML)',
    ],
    link: 'https://sellercentral.amazon.com.au/payments/event/view',
    wrongFile: 'Don\'t upload Orders reports or Business reports — only Settlement reports.',
  },
  {
    marketplace: 'Shopify Payments',
    icon: '🛍',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    fileType: 'CSV',
    fileName: 'Payouts Transactions Export',
    steps: [
      'Go to Shopify Admin → Settings → Payments',
      'Click "View payouts"',
      'Click "Export" → "Transactions"',
      'Select date range and download CSV',
    ],
    wrongFile: 'Don\'t upload Orders export or Products export — only the Payouts transactions CSV.',
  },
  {
    marketplace: 'Bunnings',
    icon: '🔨',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    fileType: 'PDF',
    fileName: 'Summary of Transactions Invoice',
    steps: [
      'Log in to Bunnings Marketplace (Mirakl)',
      'Go to Accounting → Invoices',
      'Download the "Summary of transactions" PDF',
      'Each PDF covers one billing cycle (fortnightly)',
    ],
    wrongFile: 'Don\'t upload order-level CSVs — only the billing cycle Summary PDF.',
  },
  {
    marketplace: 'Other Marketplaces',
    icon: '📋',
    color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
    fileType: 'CSV / XLSX',
    fileName: 'Settlement or Payout Report',
    steps: [
      'Find your marketplace\'s Payments / Finance section',
      'Look for "Settlements", "Payouts" or "Remittance"',
      'Download the CSV or XLSX file',
      'Xettle will auto-detect or use AI to identify the format',
    ],
    wrongFile: 'Upload settlement/payout files, not orders, inventory, or advertising reports.',
  },
];

function FileGuide({ forceCollapsed }: { forceCollapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const prevForce = useRef(forceCollapsed);
  
  // Auto-collapse when files are first uploaded
  if (prevForce.current !== forceCollapsed && forceCollapsed) {
    setOpen(false);
  }
  prevForce.current = forceCollapsed;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground h-9">
          <span className="flex items-center gap-1.5 text-xs">
            <HelpCircle className="h-3.5 w-3.5" />
            Where to find your settlement files
          </span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 pb-1">
          {FILE_GUIDES.map(guide => (
            <Card key={guide.marketplace} className="border-border">
              <CardContent className="py-3 px-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${guide.color}`}>
                    {guide.icon} {guide.marketplace}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{guide.fileType}</span>
                </div>
                <p className="text-xs font-medium text-foreground">{guide.fileName}</p>
                <ol className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                  {guide.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  {guide.wrongFile}
                </p>
                {guide.link && (
                  <a
                    href={guide.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open in Seller Central
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Shopify Connect Banner (no token exists) ──────────────────────────────

function ShopifyConnectBanner() {
  const [connecting, setConnecting] = useState(false);
  const [shopDomain, setShopDomain] = useState('');

  const handleConnect = async () => {
    const domain = shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      toast.error('Please enter your Shopify store domain (e.g. mystore.myshopify.com)');
      return;
    }

    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in');
        setConnecting(false);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'initiate', shop: domain, userId: session.user.id },
      });

      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);

      if (result?.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (err: any) {
      console.error('Connect error:', err);
      toast.error(err.message || 'Failed to connect');
      setConnecting(false);
    }
  };

  return (
    <Card className="border-l-4 border-l-primary border-border bg-card">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start gap-3">
          <ShoppingBag className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Connect Shopify</p>
            <p className="text-xs text-muted-foreground mt-1">
              Connect your Shopify store to auto-sync payouts directly via API — no CSV uploads needed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="mystore.myshopify.com"
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
            className="text-sm h-9 max-w-xs"
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          />
          <Button
            onClick={handleConnect}
            disabled={connecting}
            size="sm"
            className="gap-2 shrink-0"
          >
            {connecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {connecting ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Shopify Reconnect Banner ───────────────────────────────────────────────

function ShopifyReconnectBanner({ shopDomain }: { shopDomain: string | null }) {
  const [reconnecting, setReconnecting] = useState(false);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in');
        setReconnecting(false);
        return;
      }

      const domain = shopDomain || '';
      if (!domain) {
        toast.error('No shop domain found. Please go to Settings → Shopify to reconnect.');
        setReconnecting(false);
        return;
      }

      // Delete invalid token first
      await supabase.functions.invoke('shopify-auth', {
        method: 'POST',
        headers: { 'x-action': 'disconnect' },
      });

      // Re-initiate OAuth
      const { data: result, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'initiate', shop: domain, userId: session.user.id },
      });

      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);

      if (result?.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (err: any) {
      console.error('Reconnect error:', err);
      toast.error(err.message || 'Failed to reconnect');
      setReconnecting(false);
    }
  };

  return (
    <Card className="border-l-4 border-l-amber-500 border-border bg-card">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Shopify Token Invalid</p>
            <p className="text-xs text-muted-foreground mt-1">
              Your Shopify connection needs to be re-authorised via OAuth. This usually happens when the app credentials change. Click below to reconnect — it only takes a few seconds.
            </p>
          </div>
        </div>
        <Button
          onClick={handleReconnect}
          disabled={reconnecting}
          size="sm"
          variant="default"
          className="gap-2"
        >
          {reconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {reconnecting ? 'Reconnecting…' : 'Reconnect Shopify'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Shopify Sync Banner ────────────────────────────────────────────────────

function ShopifySyncBanner({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('system_events')
      .select('created_at')
      .eq('event_type', 'shopify_payout_synced')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setLastSynced(data[0].created_at);
        }
      });
  }, [syncing]);

  const timeAgo = useMemo(() => {
    if (!lastSynced) return null;
    const diff = Date.now() - new Date(lastSynced).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }, [lastSynced]);

  return (
    <Card className="border-l-4 border-l-emerald-500 border-border bg-card">
      <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Shopify Connected</p>
            <p className="text-xs text-muted-foreground">
              Auto-pull payouts directly from Shopify API — no CSV needed.
              {timeAgo && <span className="ml-2 text-muted-foreground/70">Last synced: {timeAgo}</span>}
            </p>
          </div>
        </div>
        <Button
          onClick={onSync}
          disabled={syncing}
          size="sm"
          className="gap-2 shrink-0"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {syncing ? 'Syncing…' : 'Sync Shopify Payouts'}
        </Button>
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
