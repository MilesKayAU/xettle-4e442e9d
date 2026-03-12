import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight, MessageSquarePlus, X, Send, Clock, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow, differenceInDays, subMonths, subDays } from 'date-fns';
import { toast } from 'sonner';

const HistoricalAudit = lazy(() => import('./HistoricalAudit'));

// ─── Types ──────────────────────────────────────────────────────────
type UrgencyTier = 'critical' | 'action' | 'info';

interface ReconItem {
  id: string;
  type: 'settlement' | 'channel_alert' | 'bank_deposit' | 'validation';
  urgencyTier: UrgencyTier;
  title: string;
  subtitle: string;
  marketplace?: string;
  amount?: number;
  date: string;
  status: string;
  sourceId: string; // original row ID for notes
  resolvedAt?: string;
  // Extended settlement details for bookkeeper review
  settlementId?: string;
  depositDate?: string;
  periodStart?: string;
  periodEnd?: string;
  xeroStatus?: string;
  reconStatus?: string;
  salesPrincipal?: number;
  sellerFees?: number;
  fbaFees?: number;
  refunds?: number;
  otherFees?: number;
}

interface ReconNote {
  id: string;
  item_type: string;
  item_id: string;
  note: string;
  created_at: string;
  resolved: boolean;
}

// ─── Urgency helpers ────────────────────────────────────────────────
function getUrgencyBadge(tier: UrgencyTier) {
  switch (tier) {
    case 'critical':
      return <Badge variant="destructive" className="text-[10px]">Critical</Badge>;
    case 'action':
      return <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 text-[10px]">Action Needed</Badge>;
    case 'info':
      return <Badge variant="secondary" className="text-[10px]">Info</Badge>;
  }
}

function getUrgencyIcon(tier: UrgencyTier) {
  switch (tier) {
    case 'critical':
      return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />;
    case 'action':
      return <Clock className="h-4 w-4 text-amber-500 shrink-0" />;
    case 'info':
      return <Info className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function formatAUD(n: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

// ─── Main component ─────────────────────────────────────────────────
export default function ReconciliationHub() {
  const [items, setItems] = useState<ReconItem[]>([]);
  const [resolvedItems, setResolvedItems] = useState<ReconItem[]>([]);
  const [notes, setNotes] = useState<Record<string, ReconNote[]>>({});
  const [loading, setLoading] = useState(true);
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const [lookbackMonths] = useState(6);
  const [resolvedDays] = useState(14);
  const [noteInput, setNoteInput] = useState<Record<string, string>>({});
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get accounting boundary
      const { data: boundarySetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_boundary_date')
        .maybeSingle();

      const boundaryDate = boundarySetting?.value ? new Date(boundarySetting.value) : null;
      const lookbackStart = subMonths(new Date(), lookbackMonths);
      const effectiveStart = boundaryDate && boundaryDate > lookbackStart ? boundaryDate : lookbackStart;
      const effectiveStartStr = effectiveStart.toISOString().split('T')[0];

      // Load open items in parallel
      const [settlementsRes, alertsRes, validationRes] = await Promise.all([
        // Settlements with issues
        supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_status, reconciliation_status, deposit_date, sales_principal, seller_fees, fba_fees, refunds, other_fees')
          .gte('period_start', effectiveStartStr)
          .in('status', ['parsed', 'saved', 'push_failed', 'ready_to_push'])
          .order('period_start', { ascending: false }),
        // Channel alerts (unmatched deposits etc.)
        supabase
          .from('channel_alerts')
          .select('id, source_name, detected_label, alert_type, status, deposit_amount, deposit_date, deposit_description, match_confidence, created_at, order_count, total_revenue')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        // Validation gaps
        supabase
          .from('marketplace_validation')
          .select('id, marketplace_code, period_label, period_start, period_end, overall_status, settlement_net, reconciliation_status, reconciliation_difference')
          .gte('period_start', effectiveStartStr)
          .in('overall_status', ['missing', 'settlement_needed', 'gap_detected'])
          .order('period_start', { ascending: false }),
      ]);

      const openItems: ReconItem[] = [];
      const resolved: ReconItem[] = [];

      // Map settlements to recon items
      for (const s of (settlementsRes.data || [])) {
        let tier: UrgencyTier = 'action';
        let title = '';
        const marketplaceLabel = (s.marketplace || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

        if (s.status === 'push_failed' || s.xero_status === 'error') {
          tier = 'critical';
          title = `Xero push failed — ${marketplaceLabel}`;
        } else if (s.status === 'ready_to_push') {
          tier = 'action';
          title = `Ready to push — ${marketplaceLabel}`;
        } else if (s.reconciliation_status === 'alert') {
          tier = 'action';
          title = `Reconciliation gap — ${marketplaceLabel}`;
        } else {
          tier = 'info';
          title = `Pending settlement — ${marketplaceLabel}`;
        }

        openItems.push({
          id: `settlement_${s.id}`,
          type: 'settlement',
          urgencyTier: tier,
          title,
          subtitle: `${s.period_start} → ${s.period_end} · ${formatAUD(s.bank_deposit || 0)}`,
          marketplace: s.marketplace || undefined,
          amount: s.bank_deposit || 0,
          date: s.period_start,
          status: s.status || 'unknown',
          sourceId: s.id,
          settlementId: s.settlement_id,
          depositDate: s.deposit_date || undefined,
          periodStart: s.period_start,
          periodEnd: s.period_end,
          xeroStatus: s.xero_status || undefined,
          reconStatus: s.reconciliation_status || undefined,
          salesPrincipal: s.sales_principal || undefined,
          sellerFees: s.seller_fees || undefined,
          fbaFees: s.fba_fees || undefined,
          refunds: s.refunds || undefined,
          otherFees: s.other_fees || undefined,
        });
      }

      // Map channel alerts
      for (const a of (alertsRes.data || [])) {
        const isUnmatched = a.alert_type === 'unmatched_deposit';
        const isUnknown = a.alert_type === 'unknown_deposit';
        const label = a.detected_label || a.source_name;

        if (isUnmatched || isUnknown) {
          openItems.push({
            id: `alert_${a.id}`,
            type: 'channel_alert',
            urgencyTier: 'action',
            title: isUnmatched
              ? `💰 Possible ${label} deposit — ${a.deposit_amount ? formatAUD(a.deposit_amount) : 'unknown amount'}`
              : `💰 Unidentified deposit — ${a.deposit_amount ? formatAUD(a.deposit_amount) : 'unknown amount'}`,
            subtitle: a.deposit_description || `Detected on ${a.deposit_date || 'unknown date'}`,
            amount: a.deposit_amount || undefined,
            date: a.deposit_date || a.created_at || new Date().toISOString(),
            status: a.status,
            sourceId: a.id,
          });
        } else if (a.alert_type === 'new') {
          openItems.push({
            id: `alert_${a.id}`,
            type: 'channel_alert',
            urgencyTier: 'info',
            title: `New channel detected: ${label}`,
            subtitle: `${a.order_count || 0} orders · ${formatAUD(a.total_revenue || 0)} revenue`,
            date: a.created_at || new Date().toISOString(),
            status: a.status,
            sourceId: a.id,
          });
        }
      }

      // Map validation gaps
      for (const v of (validationRes.data || [])) {
        const marketplaceLabel = (v.marketplace_code || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        let tier: UrgencyTier = 'action';
        let title = '';

        if (v.overall_status === 'gap_detected') {
          tier = 'action';
          title = `Gap detected — ${marketplaceLabel} ${v.period_label}`;
        } else if (v.overall_status === 'missing') {
          tier = 'action';
          title = `Missing settlement — ${marketplaceLabel} ${v.period_label}`;
        } else {
          tier = 'info';
          title = `Settlement needed — ${marketplaceLabel} ${v.period_label}`;
        }

        openItems.push({
          id: `validation_${v.id}`,
          type: 'validation',
          urgencyTier: tier,
          title,
          subtitle: `${v.period_start} → ${v.period_end}${v.reconciliation_difference ? ` · Δ ${formatAUD(v.reconciliation_difference)}` : ''}`,
          marketplace: v.marketplace_code,
          amount: v.settlement_net || undefined,
          date: v.period_start,
          status: v.overall_status || 'unknown',
          sourceId: v.id,
        });
      }

      // Load recently resolved (last N days)
      const resolvedCutoff = subDays(new Date(), resolvedDays).toISOString();
      const { data: resolvedSettlements } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, status, updated_at')
        .gte('period_start', effectiveStartStr)
        .in('status', ['synced', 'synced_external'])
        .gte('updated_at', resolvedCutoff)
        .order('updated_at', { ascending: false });

      for (const s of (resolvedSettlements || [])) {
        const marketplaceLabel = (s.marketplace || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        resolved.push({
          id: `resolved_${s.id}`,
          type: 'settlement',
          urgencyTier: 'info',
          title: `✅ Synced — ${marketplaceLabel}`,
          subtitle: `${s.period_start} → ${s.period_end} · ${formatAUD(s.bank_deposit || 0)}`,
          marketplace: s.marketplace || undefined,
          amount: s.bank_deposit || 0,
          date: s.period_start,
          status: s.status || 'synced',
          sourceId: s.id,
          resolvedAt: s.updated_at,
        });
      }

      // Sort open items: tier priority, then age
      const tierOrder: Record<UrgencyTier, number> = { critical: 0, action: 1, info: 2 };
      openItems.sort((a, b) => {
        const tierDiff = tierOrder[a.urgencyTier] - tierOrder[b.urgencyTier];
        if (tierDiff !== 0) return tierDiff;
        return new Date(a.date).getTime() - new Date(b.date).getTime(); // older first within tier
      });

      setItems(openItems);
      setResolvedItems(resolved);

      // Load notes for all items
      const allIds = [...openItems, ...resolved].map(i => i.sourceId);
      if (allIds.length > 0) {
        const { data: notesData } = await supabase
          .from('reconciliation_notes')
          .select('id, item_type, item_id, note, created_at, resolved')
          .in('item_id', allIds)
          .order('created_at', { ascending: false });

        const grouped: Record<string, ReconNote[]> = {};
        for (const n of (notesData || [])) {
          if (!grouped[n.item_id]) grouped[n.item_id] = [];
          grouped[n.item_id].push(n as ReconNote);
        }
        setNotes(grouped);
      }
    } catch (err) {
      console.error('ReconciliationHub load error:', err);
    } finally {
      setLoading(false);
    }
  }, [lookbackMonths, resolvedDays]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const addNote = useCallback(async (itemId: string, itemType: string) => {
    const text = noteInput[itemId]?.trim();
    if (!text) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('reconciliation_notes').insert({
      user_id: user.id,
      created_by: user.id,
      item_type: itemType,
      item_id: itemId,
      note: text,
    } as any);

    if (error) {
      toast.error('Failed to save note');
      return;
    }

    setNoteInput(prev => ({ ...prev, [itemId]: '' }));
    setShowNoteFor(null);
    toast.success('Note saved');
    loadItems();
  }, [noteInput, loadItems]);

  // ─── Summary counts ──────────────────────────────────────────────
  const summary = useMemo(() => {
    const critical = items.filter(i => i.urgencyTier === 'critical').length;
    const action = items.filter(i => i.urgencyTier === 'action').length;
    const info = items.filter(i => i.urgencyTier === 'info').length;
    return { critical, action, info, total: items.length };
  }, [items]);

  // ─── Render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
        <div className="h-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  // Empty state — all caught up! Still show tabs for audit access
  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Reconciliation Hub</h2>
          <p className="text-muted-foreground mt-1">Your bookkeeping command centre.</p>
        </div>

        <Tabs defaultValue="open" className="w-full">
          <TabsList>
            <TabsTrigger value="open" className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Open Items
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              Historical Audit
            </TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="mt-4">
            <Card className="border-2 border-primary/20">
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-foreground mb-2">All caught up!</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  No reconciliation items need attention for the last {lookbackMonths} months.
                  Your books are up to date. 🎉
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Suspense fallback={<div className="h-32 bg-muted animate-pulse rounded" />}>
              <HistoricalAudit />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Reconciliation Hub</h2>
        <p className="text-muted-foreground mt-1">Your bookkeeping command centre.</p>
      </div>

      <Tabs defaultValue="open" className="w-full">
        <TabsList>
          <TabsTrigger value="open" className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Open Items
            {summary.total > 0 && (
              <Badge variant="secondary" className="text-[10px] ml-1">{summary.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            Historical Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4">
      <p className="text-muted-foreground mb-4">
        {summary.total} item{summary.total !== 1 ? 's' : ''} need attention
        {summary.critical > 0 && <span className="text-destructive font-medium"> · {summary.critical} critical</span>}
        {summary.action > 0 && <span className="text-amber-600 font-medium"> · {summary.action} action needed</span>}
      </p>

      {/* ─── Open items ──────────────────────────────────────────── */}
      <div className="space-y-3">
        {items.map(item => (
          <Card key={item.id} className={`transition-all ${
            item.urgencyTier === 'critical' ? 'border-destructive/40 bg-destructive/5' :
            item.urgencyTier === 'action' ? 'border-amber-300/40 bg-amber-50/30 dark:bg-amber-900/10' :
            'border-border'
          }`}>
            <CardContent className="py-3 px-4">
              <div className="flex items-start gap-3">
                {getUrgencyIcon(item.urgencyTier)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-foreground">{item.title}</span>
                    {getUrgencyBadge(item.urgencyTier)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>

                  {/* Extended settlement details for bookkeeper review */}
                  {item.type === 'settlement' && (
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs border-t border-border/50 pt-2">
                      {item.settlementId && (
                        <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-foreground">{item.settlementId.length > 16 ? item.settlementId.slice(0, 16) + '…' : item.settlementId}</span></div>
                      )}
                      {item.depositDate && (
                        <div><span className="text-muted-foreground">Deposit:</span> <span className="text-foreground">{item.depositDate}</span></div>
                      )}
                      {item.amount != null && (
                        <div><span className="text-muted-foreground">Net payout:</span> <span className="font-medium text-foreground">{formatAUD(item.amount)}</span></div>
                      )}
                      {item.xeroStatus && (
                        <div><span className="text-muted-foreground">Xero:</span> <span className="text-foreground">{item.xeroStatus.replace(/_/g, ' ')}</span></div>
                      )}
                      {item.salesPrincipal != null && (
                        <div><span className="text-muted-foreground">Sales:</span> <span className="text-foreground">{formatAUD(item.salesPrincipal)}</span></div>
                      )}
                      {(item.sellerFees != null || item.fbaFees != null) && (
                        <div><span className="text-muted-foreground">Fees:</span> <span className="text-foreground">{formatAUD((item.sellerFees || 0) + (item.fbaFees || 0) + (item.otherFees || 0))}</span></div>
                      )}
                      {item.refunds != null && item.refunds !== 0 && (
                        <div><span className="text-muted-foreground">Refunds:</span> <span className="text-destructive">{formatAUD(item.refunds)}</span></div>
                      )}
                      {item.reconStatus && (
                        <div><span className="text-muted-foreground">Recon:</span> <span className="text-foreground">{item.reconStatus.replace(/_/g, ' ')}</span></div>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {notes[item.sourceId] && notes[item.sourceId].length > 0 && (
                    <div className="mt-2 space-y-1">
                      {notes[item.sourceId].map(n => (
                        <div key={n.id} className="text-xs bg-muted/50 rounded px-2 py-1 flex gap-2">
                          <MessageSquarePlus className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                          <div>
                            <span className="text-foreground">{n.note}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add note input */}
                  {showNoteFor === item.sourceId && (
                    <div className="mt-2 flex gap-2">
                      <Textarea
                        placeholder="Add a note..."
                        className="text-xs min-h-[60px]"
                        value={noteInput[item.sourceId] || ''}
                        onChange={e => setNoteInput(prev => ({ ...prev, [item.sourceId]: e.target.value }))}
                      />
                      <div className="flex flex-col gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => addNote(item.sourceId, item.type)}>
                          <Send className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowNoteFor(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setShowNoteFor(showNoteFor === item.sourceId ? null : item.sourceId)}
                    title="Add note"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Recently resolved (collapsed by default) ────────────── */}
      {resolvedItems.length > 0 && (
        <Collapsible open={resolvedOpen} onOpenChange={setResolvedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between text-muted-foreground text-sm hover:text-foreground">
              <span>Recently resolved ({resolvedItems.length} in last {resolvedDays} days)</span>
              {resolvedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 mt-2">
            {resolvedItems.map(item => (
              <Card key={item.id} className="border-border/50 bg-muted/20">
                <CardContent className="py-2 px-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground">{item.title}</span>
                      <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                    </div>
                    {item.resolvedAt && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(item.resolvedAt), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Suspense fallback={<div className="h-32 bg-muted animate-pulse rounded" />}>
            <HistoricalAudit />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Dashboard Summary Card (exported for use in ActionCentre) ──────
export function ReconciliationSummaryCard({ onNavigate }: { onNavigate: () => void }) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Quick count of open items
        const [{ count: settCount }, { count: alertCount }, { count: valCount }] = await Promise.all([
          supabase.from('settlements').select('id', { count: 'exact', head: true })
            .in('status', ['parsed', 'saved', 'push_failed', 'ready_to_push']),
          supabase.from('channel_alerts').select('id', { count: 'exact', head: true })
            .eq('status', 'pending'),
          supabase.from('marketplace_validation').select('id', { count: 'exact', head: true })
            .in('overall_status', ['missing', 'settlement_needed', 'gap_detected']),
        ]);

        setCount((settCount || 0) + (alertCount || 0) + (valCount || 0));
      } catch {} finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading || count === 0) return null;

  return (
    <Card className="border-amber-300/40 bg-amber-50/20 dark:bg-amber-900/10 cursor-pointer hover:bg-amber-50/40 dark:hover:bg-amber-900/20 transition-colors" onClick={onNavigate}>
      <CardContent className="py-3 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium text-foreground">
            ⚠️ {count} item{count !== 1 ? 's' : ''} need attention
          </span>
        </div>
        <span className="text-xs text-primary font-medium">View in Settlements →</span>
      </CardContent>
    </Card>
  );
}
