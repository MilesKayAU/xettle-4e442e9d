/**
 * /audit/xero-posting — DB-driven audit page (Phase 1)
 * Shows all settlements categorized as:
 *   - Posted by Xettle (provable: posted_at + sync_origin='xettle' + xero_push_success event)
 *   - External detected (sync_origin='external' or external_candidate match)
 *   - Unlinked / needs review
 */

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, CheckCircle2, AlertTriangle, ExternalLink, Search, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SettlementDetailDrawer from '@/components/shared/SettlementDetailDrawer';
import { cn } from '@/lib/utils';

type AuditCategory = 'all' | 'xettle_posted' | 'external_detected' | 'unlinked';

interface AuditRow {
  id: string;
  settlement_id: string;
  marketplace: string | null;
  period_start: string;
  period_end: string;
  status: string | null;
  sync_origin: string;
  posted_at: string | null;
  posting_state: string | null;
  posting_error: string | null;
  bank_deposit: number | null;
  net_ex_gst: number | null;
  is_pre_boundary: boolean;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  created_at: string;
  // Derived
  category: AuditCategory;
  hasProofEvent: boolean;
  externalMatchRef?: string;
  externalMatchInvoiceId?: string;
  postingMode?: string;
}

const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  kogan: 'Kogan',
  bigw: 'Big W',
  bunnings: 'Bunnings',
  mydeal: 'MyDeal',
  catch: 'Catch',
  shopify_payments: 'Shopify Payments',
  ebay_au: 'eBay AU',
  woolworths: 'Woolworths',
  theiconic: 'The Iconic',
  etsy: 'Etsy',
};

function formatAUD(n: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

export default function XeroPostingAudit() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AuditCategory>('all');
  const [preBoundaryFilter, setPreBoundaryFilter] = useState<string>('all');
  const [drawerSettlementId, setDrawerSettlementId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Parallel fetch: settlements, proof events, external candidates
      const [settRes, eventsRes, matchesRes] = await Promise.all([
        supabase.from('settlements').select(
          'id, settlement_id, marketplace, period_start, period_end, status, sync_origin, posted_at, posting_state, posting_error, bank_deposit, net_ex_gst, is_pre_boundary, xero_invoice_id, xero_invoice_number, xero_status, created_at'
        ).eq('user_id', user.id)
         .is('duplicate_of_settlement_id', null)
         .eq('is_hidden', false)
         .order('period_end', { ascending: false }),
        supabase.from('system_events').select('settlement_id, event_type, details')
          .eq('user_id', user.id)
          .in('event_type', ['xero_push_success', 'auto_post_success']),
        supabase.from('xero_accounting_matches').select('settlement_id, match_method, xero_invoice_id, xero_invoice_number, matched_reference, matched_amount')
          .eq('user_id', user.id)
          .in('match_method', ['external_candidate', 'xero_pre_seed']),
      ]);

      // Build proof event lookup
      const proofEvents = new Set<string>();
      const postingModes = new Map<string, string>();
      for (const e of (eventsRes.data || [])) {
        if (e.settlement_id) {
          proofEvents.add(e.settlement_id);
          if (e.event_type === 'auto_post_success') postingModes.set(e.settlement_id, 'auto');
          else if (!postingModes.has(e.settlement_id)) postingModes.set(e.settlement_id, 'manual');
        }
      }

      // Build external candidate lookup
      const externalCandidates = new Map<string, any>();
      for (const m of (matchesRes.data || [])) {
        externalCandidates.set(m.settlement_id, m);
      }

      // Categorize each settlement
      const auditRows: AuditRow[] = (settRes.data || []).map((s: any) => {
        const isProvablyPosted = 
          s.posted_at !== null &&
          s.sync_origin === 'xettle' &&
          s.xero_invoice_id !== null &&
          proofEvents.has(s.settlement_id);

        const extCandidate = externalCandidates.get(s.settlement_id);
        const isExternal = s.sync_origin === 'external' || !!extCandidate;

        let category: AuditCategory;
        if (isProvablyPosted) {
          category = 'xettle_posted';
        } else if (isExternal) {
          category = 'external_detected';
        } else {
          category = 'unlinked';
        }

        return {
          ...s,
          category,
          hasProofEvent: proofEvents.has(s.settlement_id),
          externalMatchRef: extCandidate?.matched_reference,
          externalMatchInvoiceId: extCandidate?.xero_invoice_id,
          postingMode: isProvablyPosted ? (postingModes.get(s.settlement_id) || 'manual') : (isExternal ? 'external' : undefined),
        };
      });

      setRows(auditRows);
      setLoading(false);
    })();
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (filter !== 'all' && r.category !== filter) return false;
      if (preBoundaryFilter === 'pre' && !r.is_pre_boundary) return false;
      if (preBoundaryFilter === 'post' && r.is_pre_boundary) return false;
      return true;
    });
  }, [rows, filter, preBoundaryFilter]);

  const counts = useMemo(() => ({
    xettle_posted: rows.filter(r => r.category === 'xettle_posted').length,
    external_detected: rows.filter(r => r.category === 'external_detected').length,
    unlinked: rows.filter(r => r.category === 'unlinked').length,
  }), [rows]);

  const getCategoryBadge = (cat: AuditCategory) => {
    switch (cat) {
      case 'xettle_posted':
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />Xettle Posted</Badge>;
      case 'external_detected':
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-[10px]"><ExternalLink className="h-3 w-3 mr-1" />External</Badge>;
      case 'unlinked':
        return <Badge variant="secondary" className="text-[10px]"><Search className="h-3 w-3 mr-1" />Unlinked</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Xero Posting Audit
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Everything posted by Xettle, detected externally, or unlinked — all from your database.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card className={cn("cursor-pointer transition-colors", filter === 'xettle_posted' && "ring-2 ring-emerald-500")}
          onClick={() => setFilter(f => f === 'xettle_posted' ? 'all' : 'xettle_posted')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-medium text-muted-foreground">Xettle Posted</span>
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">{counts.xettle_posted}</p>
            <p className="text-[10px] text-muted-foreground">Provable audit trail</p>
          </CardContent>
        </Card>
        <Card className={cn("cursor-pointer transition-colors", filter === 'external_detected' && "ring-2 ring-amber-500")}
          onClick={() => setFilter(f => f === 'external_detected' ? 'all' : 'external_detected')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium text-muted-foreground">External Detected</span>
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">{counts.external_detected}</p>
            <p className="text-[10px] text-muted-foreground">Not posted by Xettle</p>
          </CardContent>
        </Card>
        <Card className={cn("cursor-pointer transition-colors", filter === 'unlinked' && "ring-2 ring-muted-foreground")}
          onClick={() => setFilter(f => f === 'unlinked' ? 'all' : 'unlinked')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Unlinked</span>
            </div>
            <p className="text-2xl font-bold text-foreground mt-1">{counts.unlinked}</p>
            <p className="text-[10px] text-muted-foreground">No Xero link yet</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <Select value={preBoundaryFilter} onValueChange={setPreBoundaryFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All periods</SelectItem>
            <SelectItem value="pre">Pre-boundary only</SelectItem>
            <SelectItem value="post">Post-boundary only</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Showing {filteredRows.length} of {rows.length} settlements
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading audit data…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Category</TableHead>
                  <TableHead className="text-[11px]">Settlement ID</TableHead>
                  <TableHead className="text-[11px]">Marketplace</TableHead>
                  <TableHead className="text-[11px]">Period</TableHead>
                  <TableHead className="text-[11px]">Xero Ref</TableHead>
                  <TableHead className="text-[11px]">Xero Invoice</TableHead>
                  <TableHead className="text-[11px]">Posted At</TableHead>
                  <TableHead className="text-[11px]">Mode</TableHead>
                  <TableHead className="text-[11px] text-right">Amount</TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-[11px]">Pre-boundary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                      No settlements match this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map(r => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setDrawerSettlementId(r.settlement_id)}
                    >
                      <TableCell>{getCategoryBadge(r.category)}</TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[120px] truncate">{r.settlement_id}</TableCell>
                      <TableCell className="text-[11px]">{MARKETPLACE_LABELS[r.marketplace || ''] || r.marketplace || '—'}</TableCell>
                      <TableCell className="text-[11px] whitespace-nowrap">{r.period_start} → {r.period_end}</TableCell>
                      <TableCell className="font-mono text-[10px] max-w-[130px] truncate">
                        {r.category === 'xettle_posted' ? `Xettle-${r.settlement_id}` : r.externalMatchRef || '—'}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {r.xero_invoice_number || r.xero_invoice_id?.slice(0, 8) || '—'}
                      </TableCell>
                      <TableCell className="text-[11px] whitespace-nowrap">
                        {r.posted_at ? new Date(r.posted_at).toLocaleDateString('en-AU') : '—'}
                      </TableCell>
                      <TableCell className="text-[11px] capitalize">{r.postingMode || '—'}</TableCell>
                      <TableCell className="text-[11px] text-right font-mono">
                        {formatAUD(r.bank_deposit ?? r.net_ex_gst ?? 0)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'pushed_to_xero' || r.status === 'reconciled_in_xero' ? 'default' : 'secondary'} className="text-[10px]">
                          {r.status || 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[11px]">{r.is_pre_boundary ? 'Yes' : '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invariant explanation */}
      <div className="mt-4 p-3 rounded-md bg-muted/30 border border-border text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-primary" />
          "Posted by Xettle" Safety Invariant
        </p>
        <p>
          A settlement is only marked <strong>"Xettle Posted"</strong> when ALL conditions are true:
          <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">posted_at IS NOT NULL</code> +
          <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">sync_origin = 'xettle'</code> +
          <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">xero_invoice_id IS NOT NULL</code> +
          a <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">xero_push_success / auto_post_success</code> system event with immutable payload snapshot.
        </p>
      </div>

      <SettlementDetailDrawer
        settlementId={drawerSettlementId}
        open={!!drawerSettlementId}
        onClose={() => setDrawerSettlementId(null)}
      />
    </div>
  );
}
