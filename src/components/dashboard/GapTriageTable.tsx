/**
 * GapTriageTable — Focused worklist of settlements with reconciliation gaps.
 * Reads exclusively from marketplace_validation (source of truth).
 * Provides inline diagnosis, edit access, and AI scan per row.
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
import { AlertTriangle, Check, ChevronDown, ChevronUp, Pencil, Sparkles, Undo2 } from 'lucide-react';
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
  // Settlement financial fields for diagnosis
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

export default function GapTriageTable({ onEditSettlement }: GapTriageTableProps) {
  const [rows, setRows] = useState<GapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [ackExpanded, setAckExpanded] = useState(false);
  const [aiScanning, setAiScanning] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, string>>({});
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsSignatureRef = useRef('');
  // Acknowledge modal state
  const [ackTarget, setAckTarget] = useState<GapRow | null>(null);
  const [ackReason, setAckReason] = useState('');
  const [ackNotes, setAckNotes] = useState('');
  const [ackSubmitting, setAckSubmitting] = useState(false);

  const fetchGaps = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setLoading(true);
    try {
      // Get gap_detected validation rows
      const { data: validationRows } = await supabase
        .from('marketplace_validation')
        .select('settlement_id, marketplace_code, period_label, reconciliation_difference, overall_status, gap_acknowledged, gap_acknowledged_reason')
        .eq('overall_status', 'gap_detected')
        .order('reconciliation_difference', { ascending: true });

      if (!validationRows || validationRows.length === 0) {
        if (rowsSignatureRef.current !== '[]') {
          rowsSignatureRef.current = '[]';
          setRows([]);
        }
        return;
      }

      // Get settlement details for diagnosis
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

      // Sort by absolute gap descending
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

      // Collect full response without streaming state updates to avoid scroll thrashing
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

  const activeRows = useMemo(() => rows.filter(r => !r.gap_acknowledged), [rows]);
  const acknowledgedRows = useMemo(() => rows.filter(r => r.gap_acknowledged), [rows]);

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

      await supabase.from('system_events' as any).insert({
        user_id: user.id,
        event_type: 'gap_acknowledged',
        severity: 'info',
        marketplace_code: ackTarget.marketplace_code,
        settlement_id: ackTarget.settlement_id,
        details: {
          settlement_id: ackTarget.settlement_id,
          marketplace: ackTarget.marketplace_code,
          gap_amount: ackTarget.reconciliation_difference,
          reason: fullReason,
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
  }, [ackTarget, ackReason, ackNotes, fetchGaps]);

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
        {hasMore && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="text-xs text-muted-foreground">
            {expanded ? <><ChevronUp className="h-3 w-3 mr-1" /> Show less</> : <><ChevronDown className="h-3 w-3 mr-1" /> Show all {rows.length}</>}
          </Button>
        )}
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
                    {diagnosis || '—'}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => { setAckTarget(row); setAckReason(''); setAckNotes(''); }}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Acknowledge
                      </Button>
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
