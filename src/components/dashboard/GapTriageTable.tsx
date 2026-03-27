/**
 * GapTriageTable — Focused worklist of settlements with reconciliation gaps.
 * Reads exclusively from marketplace_validation (source of truth).
 * Provides inline diagnosis, edit access, AI scan per row, and AI-powered
 * auto-suggestion of acknowledgement reasons.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getDisplayGap } from '@/utils/getDisplayGap';
import { diagnoseGapReason } from '@/utils/diagnose-gap-reason';
import { formatAUD, MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Pencil, Sparkles, Undo2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface GapTriageTableProps {
  onEditSettlement: (settlementId: string) => void;
}

interface GapRow {
  settlement_id: string;
  marketplace_code: string;
  period_label: string;
  reconciliation_difference: number | null;
  overall_status: string;
  source?: string;
  marketplace?: string;
  seller_fees?: number;
  bank_deposit?: number;
  sales_principal?: number;
  gst_on_income?: number;
  gst_on_expenses?: number;
  raw_payload?: any;
  net_ex_gst?: number;
  gap_acknowledged?: boolean;
  gap_acknowledged_reason?: string | null;
}

interface AiSuggestion {
  suggested_reason: string;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}

// Map AI reasons to the existing dropdown values
const AI_REASON_TO_DROPDOWN: Record<string, string> = {
  'Rounding difference': 'Rounding difference — within acceptable tolerance',
  'Marketplace no longer active': 'Marketplace no longer active (MyDeal, Catch etc)',
  'Bank timing difference': 'Pending payout — not yet paid',
  'Fee not in settlement data': 'Other',
  'GST calculation difference': 'Other',
  'Open settlement period': 'Pending payout — not yet paid',
  'Duplicate transaction': 'Already reconciled externally',
  'Manual entry in Xero': 'Already reconciled externally',
  'Other': 'Other',
};

export default function GapTriageTable({ onEditSettlement }: GapTriageTableProps) {
  const [rows, setRows] = useState<GapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [ackExpanded, setAckExpanded] = useState(false);
  const [aiScanning, setAiScanning] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, string>>({});
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, AiSuggestion>>({});
  const [batchScanning, setBatchScanning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsSignatureRef = useRef('');
  const batchAbortRef = useRef(false);
  // Acknowledge modal state
  const [ackTarget, setAckTarget] = useState<GapRow | null>(null);
  const [ackReason, setAckReason] = useState('');
  const [ackNotes, setAckNotes] = useState('');
  const [ackSubmitting, setAckSubmitting] = useState(false);

  const fetchGaps = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setLoading(true);
    try {
      const { data: validationRows } = await supabase
        .from('marketplace_validation')
        .select('settlement_id, marketplace_code, period_label, reconciliation_difference, overall_status, gap_acknowledged, gap_acknowledged_reason')
        .eq('overall_status', 'gap_detected')
        .gte('period_end', '2026-01-01')
        .order('reconciliation_difference', { ascending: true });

      if (!validationRows || validationRows.length === 0) {
        if (rowsSignatureRef.current !== '[]') {
          rowsSignatureRef.current = '[]';
          setRows([]);
        }
        return;
      }

      const settlementIds = validationRows.map(v => v.settlement_id).filter(Boolean);
      const { data: settlements } = await supabase
        .from('settlements' as any)
        .select('settlement_id, source, marketplace, seller_fees, bank_deposit, sales_principal, gst_on_income, gst_on_expenses, raw_payload, net_ex_gst')
        .in('settlement_id', settlementIds);

      const settlementMap = new Map((settlements || []).map((s: any) => [s.settlement_id, s]));

      const merged: GapRow[] = validationRows.map(v => {
        const s = settlementMap.get(v.settlement_id) || {};
        return { ...v, ...s };
      });

      merged.sort((a, b) => Math.abs(b.reconciliation_difference || 0) - Math.abs(a.reconciliation_difference || 0));

      const nextSignature = JSON.stringify(
        merged.map((row) => [
          row.settlement_id,
          row.marketplace_code,
          row.period_label,
          row.reconciliation_difference ?? null,
          row.overall_status,
          row.bank_deposit ?? null,
          row.net_ex_gst ?? null,
        ]),
      );

      if (rowsSignatureRef.current !== nextSignature) {
        rowsSignatureRef.current = nextSignature;
        setRows(merged);
      }
    } catch (err) {
      console.error('GapTriageTable fetch error:', err);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchGaps(); }, [fetchGaps]);

  // Realtime subscription for updates
  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        void fetchGaps({ background: true });
      }, 1200);
    };

    const channel = supabase
      .channel('gap-triage-validation')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'marketplace_validation',
      }, () => { scheduleRefresh(); })
      .subscribe();

    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchGaps]);

  // --- Existing full AI scan (forensic markdown) ---
  const handleAiScan = useCallback(async (settlementId: string) => {
    setAiScanning(settlementId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: `Call analyzeReconciliationGap with settlementId="${settlementId}". Report the recommended_action, recommended_action_reason, gap amount, and xero_status from the tool result. Do not guess — only use tool data.`,
              },
            ],
            context: { routeId: 'dashboard' },
            forceToolCall: 'analyzeReconciliationGap',
          }),
        }
      );

      if (!resp.ok) {
        setAiResults(prev => ({ ...prev, [settlementId]: 'AI scan failed. Try again later.' }));
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          } catch { /* partial */ }
        }
      }

      setAiResults(prev => ({ ...prev, [settlementId]: content || 'No analysis returned.' }));
    } catch {
      setAiResults(prev => ({ ...prev, [settlementId]: 'AI scan failed. Try again later.' }));
    } finally {
      setAiScanning(null);
    }
  }, []);

  // --- AI Gap Suggest Reason (new Anthropic-powered) ---
  const handleAiSuggest = useCallback(async (settlementId: string): Promise<AiSuggestion | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return null;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-gap-suggest-reason`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ settlement_id: settlementId }),
        }
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        console.error('AI suggest failed:', errData);
        return null;
      }

      const suggestion: AiSuggestion = await resp.json();
      setAiSuggestions(prev => ({ ...prev, [settlementId]: suggestion }));
      return suggestion;
    } catch (err) {
      console.error('AI suggest error:', err);
      return null;
    }
  }, []);

  // --- Auto-Scan All ---
  const handleAutoScanAll = useCallback(async () => {
    const toScan = activeRows.filter(r => !aiSuggestions[r.settlement_id]);
    if (toScan.length === 0) {
      toast.info('All gaps already scanned');
      return;
    }

    setBatchScanning(true);
    setBatchProgress({ current: 0, total: toScan.length });
    batchAbortRef.current = false;

    let scanned = 0;
    for (const row of toScan) {
      if (batchAbortRef.current) break;
      await handleAiSuggest(row.settlement_id);
      scanned++;
      setBatchProgress({ current: scanned, total: toScan.length });
      // Rate limit: 1s delay between calls
      if (scanned < toScan.length && !batchAbortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setBatchScanning(false);
    if (!batchAbortRef.current) {
      toast.success(`Scanned ${scanned} gap${scanned !== 1 ? 's' : ''}`);
    }
  }, [activeRows, aiSuggestions, handleAiSuggest]);

  const activeRows = useMemo(() => rows.filter(r => !r.gap_acknowledged), [rows]);
  const acknowledgedRows = useMemo(() => rows.filter(r => r.gap_acknowledged), [rows]);

  // --- One-click accept (high confidence only) ---
  const handleOneClickAccept = useCallback(async (row: GapRow, suggestion: AiSuggestion) => {
    setAckSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const fullReason = suggestion.suggested_reason + ` — AI suggested (${suggestion.confidence} confidence)`;

      const { error } = await supabase
        .from('marketplace_validation')
        .update({
          gap_acknowledged: true,
          gap_acknowledged_reason: fullReason,
          gap_acknowledged_at: new Date().toISOString(),
          gap_acknowledged_by: user.id,
        } as any)
        .eq('settlement_id', row.settlement_id)
        .eq('user_id', user.id);

      if (error) throw error;

      // Log AI suggestion accepted to system_events
      await supabase.from('system_events' as any).insert({
        user_id: user.id,
        event_type: 'ai_gap_suggestion_accepted',
        severity: 'info',
        marketplace_code: row.marketplace_code,
        settlement_id: row.settlement_id,
        details: {
          settlement_id: row.settlement_id,
          suggested_reason: suggestion.suggested_reason,
          confidence: suggestion.confidence,
          explanation: suggestion.explanation,
          accepted_by: user.id,
        },
      } as any);

      toast.success(`Gap acknowledged: ${suggestion.suggested_reason}`);
      void fetchGaps({ background: true });
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setAckSubmitting(false);
    }
  }, [fetchGaps]);

  // --- Open modal pre-filled with AI suggestion ---
  const openAckModal = useCallback((row: GapRow, suggestion?: AiSuggestion) => {
    setAckTarget(row);
    if (suggestion) {
      const dropdownValue = AI_REASON_TO_DROPDOWN[suggestion.suggested_reason] || 'Other';
      setAckReason(dropdownValue);
      setAckNotes(suggestion.explanation || '');
    } else {
      setAckReason('');
      setAckNotes('');
    }
  }, []);

  const handleAcknowledge = useCallback(async () => {
    if (!ackTarget || !ackReason) return;
    setAckSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const fullReason = ackReason === 'Other' ? ackNotes : ackReason + (ackNotes ? ` — ${ackNotes}` : '');

      const { error } = await supabase
        .from('marketplace_validation')
        .update({
          gap_acknowledged: true,
          gap_acknowledged_reason: fullReason,
          gap_acknowledged_at: new Date().toISOString(),
          gap_acknowledged_by: user.id,
        } as any)
        .eq('settlement_id', ackTarget.settlement_id)
        .eq('user_id', user.id);

      if (error) throw error;

      // Check if this was AI-suggested
      const suggestion = aiSuggestions[ackTarget.settlement_id];
      const eventType = suggestion ? 'ai_gap_suggestion_accepted' : 'gap_acknowledged';

      await supabase.from('system_events' as any).insert({
        user_id: user.id,
        event_type: eventType,
        severity: 'info',
        marketplace_code: ackTarget.marketplace_code,
        settlement_id: ackTarget.settlement_id,
        details: {
          settlement_id: ackTarget.settlement_id,
          marketplace: ackTarget.marketplace_code,
          gap_amount: ackTarget.reconciliation_difference,
          reason: fullReason,
          ...(suggestion ? {
            suggested_reason: suggestion.suggested_reason,
            confidence: suggestion.confidence,
            accepted_by: user.id,
          } : {}),
        },
      } as any);

      toast.success(`Gap acknowledged: ${ackTarget.settlement_id}`);
      setAckTarget(null);
      setAckReason('');
      setAckNotes('');
      void fetchGaps({ background: true });
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setAckSubmitting(false);
    }
  }, [ackTarget, ackReason, ackNotes, fetchGaps, aiSuggestions]);

  const handleRevokeAck = useCallback(async (row: GapRow) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('marketplace_validation')
        .update({
          gap_acknowledged: false,
          gap_acknowledged_reason: null,
          gap_acknowledged_at: null,
          gap_acknowledged_by: null,
        } as any)
        .eq('settlement_id', row.settlement_id)
        .eq('user_id', user.id);

      await supabase.from('system_events' as any).insert({
        user_id: user.id,
        event_type: 'gap_acknowledgement_revoked',
        severity: 'info',
        marketplace_code: row.marketplace_code,
        settlement_id: row.settlement_id,
        details: {
          settlement_id: row.settlement_id,
          previous_reason: row.gap_acknowledged_reason,
        },
      } as any);

      toast.success(`Gap re-opened: ${row.settlement_id}`);
      void fetchGaps({ background: true });
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    }
  }, [fetchGaps]);

  if (loading && rows.length === 0) return null;
  if (rows.length === 0 && acknowledgedRows.length === 0) return null;

  const visibleRows = expanded ? activeRows : activeRows.slice(0, 5);
  const hasMore = activeRows.length > 5;

  return (
    <div className="rounded-lg border border-destructive/20 bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <h3 className="font-semibold text-sm text-foreground">Gaps to Resolve</h3>
          <Badge variant="destructive" className="text-xs">{activeRows.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-Scan All button */}
          {activeRows.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs gap-1"
              onClick={handleAutoScanAll}
              disabled={batchScanning || !!aiScanning}
            >
              {batchScanning ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Scanning {batchProgress.current} of {batchProgress.total}…
                </>
              ) : (
                <>
                  <Zap className="h-3 w-3" />
                  Auto-Scan All
                </>
              )}
            </Button>
          )}
          {hasMore && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="text-xs text-muted-foreground">
              {expanded ? <><ChevronUp className="h-3 w-3 mr-1" /> Show less</> : <><ChevronDown className="h-3 w-3 mr-1" /> Show all {rows.length}</>}
            </Button>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Marketplace</TableHead>
            <TableHead className="text-xs">Period</TableHead>
            <TableHead className="text-xs text-right">Gap</TableHead>
            <TableHead className="text-xs">Likely Cause</TableHead>
            <TableHead className="text-xs text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map(row => {
            const gap = getDisplayGap(
              { reconciliation_difference: row.reconciliation_difference },
              { net_amount: row.net_ex_gst ?? null, bank_deposit: row.bank_deposit ?? null }
            );
            const absGap = Math.abs(gap || 0);
            const isBlocking = absGap > 1.00;
            const diagnosis = diagnoseGapReason({ ...row, metadata: row.raw_payload }, gap || 0);
            const label = MARKETPLACE_LABELS[row.marketplace_code] || row.marketplace_code;
            const aiResult = aiResults[row.settlement_id];
            const isScanning = aiScanning === row.settlement_id;
            const suggestion = aiSuggestions[row.settlement_id];

            return (
              <React.Fragment key={row.settlement_id}>
                <TableRow className="group">
                  <TableCell className="text-xs font-medium">{label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.period_label}</TableCell>
                  <TableCell className={cn(
                    "text-xs text-right font-mono font-semibold",
                    isBlocking ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                  )}>
                    {gap !== null ? formatAUD(gap) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate" title={diagnosis || ''}>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{diagnosis || '—'}</span>
                      {suggestion && (
                        <Badge
                          variant={suggestion.confidence === 'high' ? 'default' : 'secondary'}
                          className={cn(
                            "text-[10px] px-1.5 py-0 shrink-0",
                            suggestion.confidence === 'high' && "bg-emerald-600 hover:bg-emerald-700 text-white"
                          )}
                          title={suggestion.explanation}
                        >
                          AI: {suggestion.suggested_reason}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onEditSettlement(row.settlement_id)}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-primary"
                        onClick={() => handleAiScan(row.settlement_id)}
                        disabled={isScanning}
                      >
                        <Sparkles className="h-3 w-3 mr-1" />
                        {isScanning ? 'Scanning…' : 'AI Scan'}
                      </Button>
                      {/* Confidence-gated accept button */}
                      {suggestion && suggestion.confidence === 'high' ? (
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => handleOneClickAccept(row, suggestion)}
                          disabled={ackSubmitting}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Accept: {suggestion.suggested_reason}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          onClick={() => openAckModal(row, suggestion)}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {aiResult && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/30 border-t-0 pt-0">
                      <Collapsible defaultOpen>
                        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-primary cursor-pointer py-1">
                          <Sparkles className="h-3 w-3" />
                          AI Analysis
                          <ChevronDown className="h-3 w-3" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="prose prose-sm dark:prose-invert max-w-none text-xs py-2">
                            <ReactMarkdown>{aiResult}</ReactMarkdown>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>

      {/* Acknowledged gaps section */}
      {acknowledgedRows.length > 0 && (
        <div className="border-t border-border">
          <button
            onClick={() => setAckExpanded(!ackExpanded)}
            className="flex items-center gap-2 px-4 py-2 w-full text-left text-xs text-muted-foreground hover:bg-muted/50"
          >
            {ackExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Acknowledged ({acknowledgedRows.length})
          </button>
          {ackExpanded && (
            <Table>
              <TableBody>
                {acknowledgedRows.map(row => {
                  const gap = getDisplayGap(
                    { reconciliation_difference: row.reconciliation_difference },
                    { net_amount: row.net_ex_gst ?? null, bank_deposit: row.bank_deposit ?? null }
                  );
                  const label = MARKETPLACE_LABELS[row.marketplace_code] || row.marketplace_code;
                  return (
                    <TableRow key={row.settlement_id} className="opacity-60">
                      <TableCell className="text-xs">{label}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.period_label}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{gap !== null ? formatAUD(gap) : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground italic max-w-[240px] truncate" title={row.gap_acknowledged_reason || ''}>
                        {row.gap_acknowledged_reason || 'Acknowledged'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleRevokeAck(row)}>
                          <Undo2 className="h-3 w-3 mr-1" />
                          Undo
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Acknowledge modal */}
      <Dialog open={!!ackTarget} onOpenChange={(open) => { if (!open) setAckTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Acknowledge Gap</DialogTitle>
            <DialogDescription>
              Mark this gap as reviewed. It will move to the acknowledged section and won't count toward active gaps.
            </DialogDescription>
          </DialogHeader>
          {ackTarget && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Settlement</span>
                <span className="font-mono font-medium">{ackTarget.settlement_id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gap</span>
                <span className="font-mono font-semibold text-destructive">{formatAUD(ackTarget.reconciliation_difference || 0)}</span>
              </div>
              {/* Show AI suggestion context if available */}
              {aiSuggestions[ackTarget.settlement_id] && (
                <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span className="font-medium">AI Suggestion</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {aiSuggestions[ackTarget.settlement_id].confidence}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{aiSuggestions[ackTarget.settlement_id].explanation}</p>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <Select value={ackReason} onValueChange={setAckReason}>
                  <SelectTrigger><SelectValue placeholder="Select a reason…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Marketplace no longer active (MyDeal, Catch etc)">Marketplace no longer active</SelectItem>
                    <SelectItem value="Pending payout — not yet paid">Pending payout — not yet paid</SelectItem>
                    <SelectItem value="Rounding difference — within acceptable tolerance">Rounding difference</SelectItem>
                    <SelectItem value="Already reconciled externally">Already reconciled externally</SelectItem>
                    <SelectItem value="Other">Other (enter reason below)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Notes (optional)</label>
                <Textarea
                  value={ackNotes}
                  onChange={e => setAckNotes(e.target.value)}
                  placeholder="Additional context…"
                  className="h-20 text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckTarget(null)} disabled={ackSubmitting}>Cancel</Button>
            <Button onClick={handleAcknowledge} disabled={!ackReason || ackSubmitting}>
              {ackSubmitting ? 'Saving…' : 'Acknowledge Gap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
