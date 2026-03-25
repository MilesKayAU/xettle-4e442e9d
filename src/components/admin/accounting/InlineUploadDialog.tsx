/**
 * InlineUploadDialog — Opens inline when clicking "Upload" on a specific
 * settlement row. Shows marketplace-specific guidance, expected date range,
 * and a file drop zone. Processes files without navigating away.
 */

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, FileText, Info, CheckCircle2, Loader2, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';

interface InlineUploadDialogProps {
  open: boolean;
  onClose: () => void;
  marketplaceCode: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  onComplete: () => void;
  /** Navigate to the full upload page with context */
  onOpenFullUpload?: (marketplaceCode: string, periodLabel: string) => void;
}

// Marketplace-specific file guidance
const MARKETPLACE_GUIDANCE: Record<string, { fileCount: number; description: string; fileTypes: string[] }> = {
  kogan: {
    fileCount: 2,
    description: 'Upload both the CSV (order data) and the PDF (Remittance Advice) together for accurate reconciliation.',
    fileTypes: ['CSV — Order & commission detail', 'PDF — Remittance Advice with returns, ad spend & bank deposit'],
  },
  bigw: {
    fileCount: 1,
    description: 'Upload the settlement CSV report from the Big W Marketplace Hub.',
    fileTypes: ['CSV — Settlement report'],
  },
  mydeal: {
    fileCount: 1,
    description: 'Upload the settlement CSV from the MyDeal Seller Portal.',
    fileTypes: ['CSV — Settlement report'],
  },
  everyday_market: {
    fileCount: 1,
    description: 'Upload the settlement CSV from Everyday Market.',
    fileTypes: ['CSV — Settlement report'],
  },
  bunnings: {
    fileCount: 1,
    description: 'Upload the "Summary of Transactions" PDF from the Bunnings Marketplace portal. Optionally include the billing cycle orders CSV.',
    fileTypes: ['PDF — Summary of Transactions'],
  },
  woolworths_marketplus: {
    fileCount: 1,
    description: 'Upload the settlement CSV from the Woolworths MarketPlus portal.',
    fileTypes: ['CSV — Settlement report'],
  },
  amazon_au: {
    fileCount: 1,
    description: 'Upload the Flat File V2 settlement report from Seller Central → Reports → Payments.',
    fileTypes: ['CSV/TSV — Flat File V2 settlement'],
  },
  ebay_au: {
    fileCount: 1,
    description: 'Upload the payout CSV from eBay Seller Hub → Payments → Reports.',
    fileTypes: ['CSV — Payout report'],
  },
};

const DEFAULT_GUIDANCE = {
  fileCount: 1,
  description: 'Upload the settlement CSV file for this period.',
  fileTypes: ['CSV — Settlement file'],
};

function formatDateRange(start: string, end: string): string {
  try {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${s.toLocaleDateString('en-AU', opts)} → ${e.toLocaleDateString('en-AU', opts)}`;
  } catch {
    return `${start} → ${end}`;
  }
}

export default function InlineUploadDialog({
  open,
  onClose,
  marketplaceCode,
  periodLabel,
  periodStart,
  periodEnd,
  onComplete,
  onOpenFullUpload,
}: InlineUploadDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const guidance = MARKETPLACE_GUIDANCE[marketplaceCode.toLowerCase()] || DEFAULT_GUIDANCE;
  const label = MARKETPLACE_LABELS[marketplaceCode] || marketplaceCode;
  const isKogan = marketplaceCode.toLowerCase().includes('kogan');

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter(f => {
      const ext = f.name.toLowerCase();
      return ext.endsWith('.csv') || ext.endsWith('.tsv') || ext.endsWith('.xlsx') || ext.endsWith('.pdf');
    });
    if (arr.length === 0) {
      toast.error('Please select CSV, TSV, XLSX, or PDF files');
      return;
    }
    setSelectedFiles(prev => {
      // Deduplicate by name+size
      const existing = new Set(prev.map(f => `${f.name}_${f.size}`));
      const unique = arr.filter(f => !existing.has(`${f.name}_${f.size}`));
      return [...prev, ...unique];
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleProceed = () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select files first');
      return;
    }
    // Validate Kogan needs both CSV and PDF
    if (isKogan) {
      const hasCSV = selectedFiles.some(f => f.name.toLowerCase().endsWith('.csv'));
      const hasPDF = selectedFiles.some(f => f.name.toLowerCase().endsWith('.pdf'));
      if (!hasCSV || !hasPDF) {
        toast.warning('Kogan requires both a CSV and PDF file for accurate reconciliation. You can still proceed, but the net payout may not match the bank deposit.');
      }
    }
    // Open full upload page with these files pre-loaded
    if (onOpenFullUpload) {
      onOpenFullUpload(marketplaceCode, periodLabel);
    }
    onClose();
  };

  // Check file type composition
  const csvCount = selectedFiles.filter(f => {
    const n = f.name.toLowerCase();
    return n.endsWith('.csv') || n.endsWith('.tsv') || n.endsWith('.xlsx');
  }).length;
  const pdfCount = selectedFiles.filter(f => f.name.toLowerCase().endsWith('.pdf')).length;
  const isKoganComplete = !isKogan || (csvCount >= 1 && pdfCount >= 1);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-amber-500" />
            Upload — {label}
          </DialogTitle>
          <DialogDescription>
            Settlement period: <strong>{formatDateRange(periodStart, periodEnd)}</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Guidance */}
        <div className={cn(
          'rounded-lg border px-4 py-3 space-y-2',
          isKogan
            ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
            : 'bg-muted/50 border-border'
        )}>
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="space-y-1.5">
              <p className="text-sm text-foreground">{guidance.description}</p>
              <div className="space-y-1">
                {guidance.fileTypes.map((ft, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    {ft.toLowerCase().includes('pdf') ? (
                      <FileText className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    )}
                    <span>{ft}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/30'
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Drag & drop files here, or <span className="text-primary font-medium">browse</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">CSV, TSV, XLSX, or PDF</p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept=".csv,.tsv,.xlsx,.pdf"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {/* Selected files */}
        {selectedFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Selected files:</p>
            <ul className="space-y-1.5">
              {selectedFiles.map((f, i) => {
                const isPdf = f.name.toLowerCase().endsWith('.pdf');
                return (
                  <li key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded-md px-3 py-2">
                    {isPdf ? (
                      <FileText className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    )}
                    <span className="flex-1 truncate">{f.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {(f.size / 1024).toFixed(0)} KB
                    </Badge>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Kogan pair validation */}
            {isKogan && !isKoganComplete && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {csvCount === 0 ? 'Missing CSV file — ' : ''}
                  {pdfCount === 0 ? 'Missing PDF (Remittance Advice) — ' : ''}
                  both files are needed for accurate reconciliation.
                </span>
              </div>
            )}

            {isKogan && isKoganComplete && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>CSV + PDF pair detected — ready to process</span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 gap-1"
            disabled={selectedFiles.length === 0}
            onClick={handleProceed}
          >
            <Upload className="h-4 w-4" />
            Process {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
