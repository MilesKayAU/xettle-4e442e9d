/**
 * GapTriageTable — Focused worklist of settlements with reconciliation gaps.
 * Reads exclusively from marketplace_validation (source of truth).
 * Provides inline diagnosis, edit access, and AI scan per row.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getDisplayGap } from '@/utils/getDisplayGap';
import { diagnoseGapReason } from '@/utils/diagnose-gap-reason';
import { formatAUD, MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, ChevronDown, ChevronUp, Pencil, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

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
}

export default function GapTriageTable({ onEditSettlement }: GapTriageTableProps) {
  const [rows, setRows] = useState<GapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [aiScanning, setAiScanning] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, string>>({});
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsSignatureRef = useRef('');

  const fetchGaps = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setLoading(true);
    try {
      // Get gap_detected validation rows
      const { data: validationRows } = await supabase
        .from('marketplace_validation')
        .select('settlement_id, marketplace_code, period_label, reconciliation_difference, overall_status')
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

  if (loading && rows.length === 0) return null;
  if (rows.length === 0) return null;

  const visibleRows = expanded ? rows : rows.slice(0, 5);
  const hasMore = rows.length > 5;

  return (
    <div className="rounded-lg border border-destructive/20 bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <h3 className="font-semibold text-sm text-foreground">Gaps to Resolve</h3>
          <Badge variant="destructive" className="text-xs">{rows.length}</Badge>
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
    </div>
  );
}
