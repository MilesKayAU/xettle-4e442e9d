/**
 * FirstContactModal — Gating layer for unknown/low-confidence marketplace uploads.
 * Shows detected file stats, lets user identify the marketplace, and optionally
 * sends the format to the Xettle team for review.
 */

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { createDraftFingerprint } from '@/utils/fingerprint-lifecycle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  Search,
  FileSpreadsheet,
  Calendar,
  DollarSign,
  Send,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_CATALOG } from './MarketplaceSwitcher';
import { scrubSampleRows, type ConfidenceTier } from '@/utils/file-fingerprint-engine';

interface FirstContactModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  confidence: number;
  confidenceTier: ConfidenceTier;
  detectedMarketplace: string;
  /** Callback when user confirms — returns the confirmed marketplace code */
  onConfirm: (marketplaceCode: string, marketplaceName: string) => void;
  onCancel: () => void;
}

export default function FirstContactModal({
  open,
  onOpenChange,
  filename,
  headers,
  sampleRows,
  rowCount,
  confidence,
  confidenceTier: tier,
  detectedMarketplace,
  onConfirm,
  onCancel,
}: FirstContactModalProps) {
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('');
  const [customName, setCustomName] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Scrub PII from sample data
  const scrubbedRows = useMemo(() => scrubSampleRows(headers, sampleRows.slice(0, 3)), [headers, sampleRows]);

  // Detect likely date/amount/marketplace columns from headers
  const columnAnalysis = useMemo(() => {
    const datePatterns = /date|time|period|created|paid/i;
    const amountPatterns = /amount|total|net|payout|sales|revenue|price|fee|commission/i;
    const marketplacePatterns = /marketplace|channel|source|platform|store|order\s*source/i;

    const dateCol = headers.find(h => datePatterns.test(h));
    const amountCol = headers.find(h => amountPatterns.test(h));
    const marketplaceCol = headers.find(h => marketplacePatterns.test(h));

    // Extract sample values for detected columns
    const colIdx = (col: string | undefined) => col ? headers.indexOf(col) : -1;

    const dateSamples = dateCol ? scrubbedRows.map(r => r[colIdx(dateCol)]).filter(Boolean).slice(0, 3) : [];
    const amountSamples = amountCol ? scrubbedRows.map(r => r[colIdx(amountCol)]).filter(Boolean).slice(0, 3) : [];
    const marketplaceSamples = marketplaceCol ? scrubbedRows.map(r => r[colIdx(marketplaceCol)]).filter(Boolean).slice(0, 5) : [];

    return { dateCol, amountCol, marketplaceCol, dateSamples, amountSamples, marketplaceSamples };
  }, [headers, scrubbedRows]);

  const isOther = selectedMarketplace === '__other__';
  const resolvedCode = isOther ? customName.toLowerCase().replace(/\s+/g, '_') : selectedMarketplace;
  const resolvedName = isOther ? customName : (MARKETPLACE_CATALOG.find(m => m.code === selectedMarketplace)?.name || selectedMarketplace);
  const canSave = reviewed && (selectedMarketplace && (!isOther || customName.trim().length > 0));

  const handleSendToTeam = async () => {
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const scrubbedForReport = scrubSampleRows(headers, sampleRows.slice(0, 3));

      await supabase.from('bug_reports').insert({
        submitted_by: user.id,
        ai_classification: 'New marketplace',
        description: `User uploaded unknown marketplace file: ${filename}. Detected columns: ${headers.slice(0, 15).join(', ')}${headers.length > 15 ? ` (+${headers.length - 15} more)` : ''}. User-identified marketplace: ${resolvedName || 'not specified'}. Confidence: ${confidence}%.`,
        console_errors: JSON.stringify({
          type: 'new_marketplace_upload',
          filename,
          confidence,
          confidenceTier: tier,
          detectedMarketplace,
          userMarketplace: resolvedName || null,
          userSaved: false,
          headers,
          sampleRows: scrubbedForReport,
        }),
        severity: 'medium',
        status: 'open',
        page_url: window.location.pathname,
      } as any);

      setSent(true);
      toast.success("Thanks — we'll review this format and add official support. You can still save now if the figures look correct.");
    } catch (err: any) {
      toast.error(`Failed to send: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = () => {
    if (!canSave) return;
    onConfirm(resolvedCode, resolvedName);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="h-4.5 w-4.5 text-primary" />
            New marketplace detected
          </DialogTitle>
          <DialogDescription className="text-xs">
            {detectedMarketplace !== 'unknown'
              ? `Detected as "${detectedMarketplace}" but confidence is low (${confidence}%).`
              : "We haven't seen this file format before."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* File stats */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
              {filename}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <FileSpreadsheet className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{rowCount} rows detected</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {confidence}% confidence
                </Badge>
              </div>
            </div>

            {/* Column analysis */}
            <div className="space-y-1.5 pt-1">
              {columnAnalysis.dateCol && (
                <div className="flex items-start gap-1.5 text-xs">
                  <Calendar className="h-3 w-3 text-muted-foreground mt-0.5" />
                  <span className="text-muted-foreground">
                    Date column: <span className="font-medium text-foreground">{columnAnalysis.dateCol}</span>
                    {columnAnalysis.dateSamples.length > 0 && (
                      <span className="text-muted-foreground/70"> — {columnAnalysis.dateSamples.join(', ')}</span>
                    )}
                  </span>
                </div>
              )}
              {columnAnalysis.amountCol && (
                <div className="flex items-start gap-1.5 text-xs">
                  <DollarSign className="h-3 w-3 text-muted-foreground mt-0.5" />
                  <span className="text-muted-foreground">
                    Amount column: <span className="font-medium text-foreground">{columnAnalysis.amountCol}</span>
                    {columnAnalysis.amountSamples.length > 0 && (
                      <span className="text-muted-foreground/70"> — {columnAnalysis.amountSamples.join(', ')}</span>
                    )}
                  </span>
                </div>
              )}
              {columnAnalysis.marketplaceCol && (
                <div className="flex items-start gap-1.5 text-xs">
                  <Search className="h-3 w-3 text-muted-foreground mt-0.5" />
                  <span className="text-muted-foreground">
                    Marketplace column: <span className="font-medium text-foreground">{columnAnalysis.marketplaceCol}</span>
                    {columnAnalysis.marketplaceSamples.length > 0 && (
                      <span className="text-muted-foreground/70"> — {[...new Set(columnAnalysis.marketplaceSamples)].join(', ')}</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This is a format we haven't seen before. There's a higher chance of parsing errors — please review carefully.
            </p>
          </div>

          {/* Marketplace selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">What is this marketplace?</Label>
            <Select value={selectedMarketplace} onValueChange={setSelectedMarketplace}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select marketplace..." />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACE_CATALOG.map(m => (
                  <SelectItem key={m.code} value={m.code} className="text-sm">
                    {m.icon} {m.name}
                  </SelectItem>
                ))}
                <SelectItem value="__other__" className="text-sm">
                  ➕ Other / New marketplace
                </SelectItem>
              </SelectContent>
            </Select>
            {isOther && (
              <Input
                placeholder="Marketplace name (e.g. eBay AU)"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                className="text-sm"
              />
            )}
          </div>

          {/* Review checkbox */}
          <div className="flex items-start gap-2">
            <Checkbox
              id="first-contact-review"
              checked={reviewed}
              onCheckedChange={(v) => setReviewed(!!v)}
              className="mt-0.5"
            />
            <Label htmlFor="first-contact-review" className="text-xs text-muted-foreground cursor-pointer">
              I've reviewed the preview below and the figures look correct
            </Label>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleSendToTeam}
            disabled={sending || sent}
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : sent ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {sent ? 'Sent to team' : 'Send to Xettle team for review'}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!canSave}
            >
              Save anyway
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
