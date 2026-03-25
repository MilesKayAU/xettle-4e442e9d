import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, Loader2, Eye, ExternalLink, Trash2, RefreshCw,
  CloudDownload, ShieldCheck, AlertTriangle, CheckSquare, Square, Zap, Clock,
  Search, Banknote, FileCheck, HelpCircle, ChevronDown, ChevronRight
} from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatAUD } from '@/utils/settlement-parser';
import { isReconSafeForPush } from '@/utils/canonical-recon-status';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTransactionDrilldown } from '@/hooks/use-transaction-drilldown';
import TablePaginationBar, { DEFAULT_PAGE_SIZE } from '@/components/shared/TablePaginationBar';

interface AutoImportedSettlement {
  id: string;
  settlement_id: string;
  period_start: string;
  period_end: string;
  deposit_date: string | null;
  bank_deposit: number;
  status: string;
  source: string;
  reconciliation_status: string;
  xero_journal_id: string | null;
  xero_journal_id_1: string | null;
  xero_journal_id_2: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  xero_type: string | null;
  bank_verified: boolean | null;
  bank_verified_amount: number | null;
  bank_verified_at: string | null;
  created_at: string;
  sales_principal: number;
  sales_shipping: number;
  seller_fees: number;
  fba_fees: number;
  storage_fees: number;
  refunds: number;
  reimbursements: number;
  is_split_month: boolean | null;
}

interface XeroMatch {
  settlement_id: string;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  match_method: string;
  confidence: number;
  matched_amount: number | null;
  matched_contact: string | null;
  notes: string | null;
}

interface AutoImportedTabProps {
  onViewSettlement?: (settlementId: string) => void;
  onSyncToXero?: (settlementId: string) => void | Promise<void>;
  existingSettlementIds: Set<string>;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

type AuditStatus = 'complete' | 'in_xero' | 'bank_only' | 'review' | 'ready_to_push' | 'pre_boundary' | 'unknown';

function deriveAuditStatus(
  s: AutoImportedSettlement,
  xeroMatch: XeroMatch | undefined,
  validationStatus?: string | null,
): AuditStatus {
  if (s.status === 'already_recorded') return 'pre_boundary';

  const hasXero = !!(s.xero_journal_id || s.xero_journal_id_1 || s.status === 'synced' || s.status === 'synced_external');
  const hasFuzzyXero = !!xeroMatch && xeroMatch.match_method === 'fuzzy_amount_date';
  const hasBank = !!s.bank_verified;

  if (hasXero && hasBank) return 'complete';
  if (hasXero && !hasBank) return 'in_xero';
  if (hasFuzzyXero) return 'review';
  if (!hasXero && hasBank) return 'bank_only';
  // Pushability determined exclusively by marketplace_validation.overall_status
  if (validationStatus === 'ready_to_push') return 'ready_to_push';
  return 'unknown';
}

const STATUS_CONFIG: Record<AuditStatus, { label: string; color: string; icon: React.ReactNode }> = {
  complete: { label: 'Complete', color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', icon: <CheckCircle2 className="h-3 w-3" /> },
  in_xero: { label: 'In Xero', color: 'bg-primary/10 text-primary border-primary/20', icon: <FileCheck className="h-3 w-3" /> },
  bank_only: { label: 'Bank matched', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200', icon: <Banknote className="h-3 w-3" /> },
  review: { label: 'Review', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800', icon: <AlertTriangle className="h-3 w-3" /> },
  ready_to_push: { label: 'Ready to push', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200', icon: <Zap className="h-3 w-3" /> },
  pre_boundary: { label: 'Already in Xero', color: 'bg-muted text-muted-foreground border-muted', icon: <ShieldCheck className="h-3 w-3" /> },
  unknown: { label: 'Needs investigation', color: 'bg-muted text-muted-foreground border-muted', icon: <HelpCircle className="h-3 w-3" /> },
};

// ─── Xero status indicator ──────────────────────────────────
function XeroIndicator({ settlement, xeroMatch }: { settlement: AutoImportedSettlement; xeroMatch?: XeroMatch }) {
  const hasXero = !!(settlement.xero_journal_id || settlement.xero_journal_id_1 || settlement.status === 'synced');
  const isExternal = settlement.status === 'synced_external';

  if (hasXero) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Found</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            {settlement.xero_invoice_number
              ? `Invoice ${settlement.xero_invoice_number} (${settlement.xero_status || 'DRAFT'})`
              : 'Pushed via Xettle'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (isExternal) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-xs font-medium">External</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs">Marked as already recorded in Xero</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (xeroMatch && xeroMatch.match_method === 'fuzzy_amount_date') {
    const pct = Math.round(xeroMatch.confidence * 100);
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">{pct}%</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs max-w-[200px]">
            <p>Possible match: {xeroMatch.xero_invoice_number || 'Unknown'}</p>
            {xeroMatch.matched_contact && <p>Contact: {xeroMatch.matched_contact}</p>}
            {xeroMatch.matched_amount && <p>Amount: {formatAUD(xeroMatch.matched_amount)}</p>}
            {xeroMatch.notes && <p className="text-muted-foreground mt-1">{xeroMatch.notes}</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <XCircle className="h-4 w-4" />
      <span className="text-xs">—</span>
    </span>
  );
}

// ─── Bank status indicator ──────────────────────────────────
function BankIndicator({ settlement }: { settlement: AutoImportedSettlement }) {
  if (settlement.bank_verified) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Matched</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            {settlement.bank_verified_amount
              ? `${formatAUD(settlement.bank_verified_amount)} verified`
              : 'Bank deposit matched'}
            {settlement.bank_verified_at && (
              <> on {formatDate(settlement.bank_verified_at.split('T')[0])}</>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <XCircle className="h-4 w-4" />
      <span className="text-xs">—</span>
    </span>
  );
}

export default function AutoImportedTab({ onViewSettlement, onSyncToXero, existingSettlementIds }: AutoImportedTabProps) {
  const [settlements, setSettlements] = useState<AutoImportedSettlement[]>([]);
  const [xeroMatches, setXeroMatches] = useState<Record<string, XeroMatch>>({});
  const [validationStatusMap, setValidationStatusMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [auditing, setAuditing] = useState(false);
  const [lastAuditTime, setLastAuditTime] = useState<string | null>(null);

  // Transaction drill-down
  const { expandedLines, lineItems, loadingLines, loadLineItems } = useTransactionDrilldown();

  // Smart sync state
  const [smartSyncing, setSmartSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [cooldownMinutes, setCooldownMinutes] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<{
    synced: number;
    total_deposit: number;
    settlements: Array<{ settlement_id: string; period_start: string; period_end: string; deposit: number }>;
  } | null>(null);

  const loadApiSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const [settRes, valRes] = await Promise.all([
        supabase
          .from('settlements')
          .select('*')
          .eq('source', 'api')
          .like('marketplace', 'amazon_%')
          .order('period_end', { ascending: false }),
        supabase
          .from('marketplace_validation')
          .select('settlement_id, overall_status')
          .like('marketplace_code', 'amazon_%'),
      ]);
      if (settRes.error) throw settRes.error;
      setSettlements((settRes.data || []) as unknown as AutoImportedSettlement[]);
      // Build validation status lookup by settlement_id
      const valMap: Record<string, string> = {};
      for (const v of (valRes.data || []) as any[]) {
        if (v.settlement_id) valMap[v.settlement_id] = v.overall_status;
      }
      setValidationStatusMap(valMap);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const loadXeroMatches = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('xero_accounting_matches' as any)
        .select('*');
      if (data) {
        const map: Record<string, XeroMatch> = {};
        for (const m of data as any[]) {
          map[m.settlement_id] = m as XeroMatch;
        }
        setXeroMatches(map);
      }
    } catch {
      // silent - table may not exist yet
    }
  }, []);

  const loadCooldown = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'amazon_settlement_last_sync')
        .maybeSingle();

      if (data?.value) {
        setLastSyncTime(data.value);
        const lastSync = new Date(data.value);
        const minutesAgo = Math.round((Date.now() - lastSync.getTime()) / 60000);
        if (minutesAgo < 60) {
          setCooldownMinutes(60 - minutesAgo);
        } else {
          setCooldownMinutes(null);
        }
      }
    } catch {
      // silent
    }
  }, []);
  useEffect(() => {
    loadApiSettlements();
    loadXeroMatches();
    loadCooldown();
  }, [loadApiSettlements, loadXeroMatches, loadCooldown]);

  const AUDIT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

  const getAuditCacheKey = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user ? `xettle_last_audit_${user.id}` : null;
  }, []);

  // Auto-audit Xero status on first load — with 30-minute cooldown
  useEffect(() => {
    if (loading || settlements.length === 0 || auditing) return;

    const checkAndAudit = async () => {
      const cacheKey = await getAuditCacheKey();
      if (!cacheKey) return;

      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const elapsed = Date.now() - parseInt(cached, 10);
        if (elapsed < AUDIT_COOLDOWN_MS) {
          const mins = Math.round((AUDIT_COOLDOWN_MS - elapsed) / 60000);
          setLastAuditTime(new Date(parseInt(cached, 10)).toISOString());
          // Skipping auto-audit — cooldown active
          return;
        }
      }

      // Auto-auditing Xero status
      handleRunAudit();
    };

    checkAndAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, settlements.length]);

  // Cooldown timer
  useEffect(() => {
    if (cooldownMinutes === null || cooldownMinutes <= 0) return;
    const interval = setInterval(() => {
      setCooldownMinutes(prev => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [cooldownMinutes]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('auto-imported-settlements')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: 'source=eq.api' }, () => {
        loadApiSettlements();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadApiSettlements]);

  // ─── Run Audit: sync Xero status + bank matching ──────────
  const handleRunAudit = async () => {
    setAuditing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Run sync-xero-status (now includes fuzzy matching)
      // Starting Xero status sync
      const { data: xeroResult, error: xeroErr } = await supabase.functions.invoke('sync-xero-status', {
        body: { userId: user.id },
      });

      if (xeroErr) {
        console.error('[Audit] Xero sync error:', xeroErr);
        toast.error(`Xero audit failed: ${xeroErr.message}`);
      } else {
        // Xero audit completed
      }

      // Run bank deposit matching
      // Starting bank deposit matching
      const { data: bankResult, error: bankErr } = await supabase.functions.invoke('match-bank-deposits', {
        body: {},
      });

      if (bankErr) {
        console.error('[Audit] Bank match error:', bankErr);
      } else {
        // Bank matching completed
      }

      const xeroUpdated = xeroResult?.updated || 0;
      const fuzzyMatched = xeroResult?.fuzzy_matched || 0;
      const bankMatched = bankResult?.matched || 0;

      if (xeroUpdated + fuzzyMatched + bankMatched > 0) {
        toast.success(
          `Audit complete: ${xeroUpdated} Xero matches, ${fuzzyMatched} possible matches, ${bankMatched} bank matches`,
          { duration: 6000 }
        );
      } else {
        toast.info('Audit complete — no new matches found. All settlements are already categorised.', { duration: 5000 });
      }

      await Promise.all([loadApiSettlements(), loadXeroMatches()]);

      // Save audit timestamp to sessionStorage for cooldown
      const cacheKey = `xettle_last_audit_${user.id}`;
      const now = Date.now();
      sessionStorage.setItem(cacheKey, String(now));
      setLastAuditTime(new Date(now).toISOString());
    } catch (err: any) {
      console.error('[Audit] Failed:', err);
      toast.error(`Audit failed: ${err.message}`);
    } finally {
      setAuditing(false);
    }
  };

  // ─── Smart Sync Handler ────────────────────────────────────
  const handleSmartSync = async () => {
    setSmartSyncing(true);
    setSyncResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-amazon-settlements', {
        headers: { 'x-action': 'smart-sync' },
      });

      if (error) throw error;

      if (data?.error) {
        if (data.message?.includes('cooldown')) {
          toast.warning(data.message);
          setCooldownMinutes(60 - Math.round((Date.now() - new Date(data.last_sync).getTime()) / 60000));
        } else {
          toast.error(data.error);
        }
        return;
      }

      const { synced = 0, total_deposit = 0, settlements: syncedSettlements = [] } = data || {};

      if (synced > 0) {
        setSyncResult({ synced, total_deposit, settlements: syncedSettlements });
        toast.success(`Found ${synced} new settlement${synced !== 1 ? 's' : ''} totalling ${formatAUD(total_deposit)}`);
        await loadApiSettlements();
        
        // Auto-run Xero audit to check which settlements already exist in Xero
        toast.info('Running accounting audit to detect existing Xero records...');
        await handleRunAudit();
      } else {
        toast.info('All Amazon settlements already imported — nothing new to sync.');
      }

      setLastSyncTime(new Date().toISOString());
      setCooldownMinutes(60);
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSmartSyncing(false);
    }
  };

  const handleDelete = async (settlement: AutoImportedSettlement) => {
    if (!confirm(`Delete auto-imported settlement ${settlement.settlement_id}?`)) return;
    setDeleting(settlement.id);
    try {
      const { deleteSettlement } = await import('@/actions/settlements');
      const result = await deleteSettlement(settlement.id);
      if (!result.success) throw new Error(result.error);
      toast.success(`Settlement ${settlement.settlement_id} deleted`);
      await loadApiSettlements();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === settlements.length) setSelected(new Set());
    else setSelected(new Set(settlements.map(s => s.id)));
  };

  // Pagination
  const [autoPage, setAutoPage] = useState(1);
  const autoTotalPages = Math.max(1, Math.ceil(settlements.length / DEFAULT_PAGE_SIZE));
  const paginatedAutoSettlements = settlements.slice((autoPage - 1) * DEFAULT_PAGE_SIZE, autoPage * DEFAULT_PAGE_SIZE);

  const handleDeleteSelected = async () => {
    const toDelete = settlements.filter(s => selected.has(s.id));
    if (toDelete.length === 0) return;
    if (!confirm(`Delete ${toDelete.length} auto-imported settlement(s)?`)) return;
    setDeletingBulk(true);
    try {
      const { deleteSettlement } = await import('@/actions/settlements');
      for (const s of toDelete) {
        const result = await deleteSettlement(s.id);
        if (!result.success) throw new Error(result.error);
      }
      toast.success(`${toDelete.length} settlement(s) deleted`);
      setSelected(new Set());
      await loadApiSettlements();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleMarkAsInXero = async (settlement: AutoImportedSettlement) => {
    setMarking(settlement.id);
    try {
      const { error } = await supabase
        .from('settlements')
        .update({ status: 'synced_external' } as any)
        .eq('id', settlement.id);
      if (error) throw error;
      toast.success(`Settlement ${settlement.settlement_id} marked as already in Xero`);
      await loadApiSettlements();
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setMarking(null);
    }
  };

  const handleSyncToXero = async (settlement: AutoImportedSettlement) => {
    if (settlement.status === 'synced_external') {
      toast.error('This settlement is marked as already in Xero. Unmark it first.');
      return;
    }
    setSyncing(settlement.id);
    try {
      if (onSyncToXero) {
        await onSyncToXero(settlement.settlement_id);
      }
      await loadApiSettlements();
    } catch (err: any) {
      toast.error(`Push failed: ${err.message}`);
    } finally {
      setSyncing(null);
    }
  };

  // ─── Derive audit counts ──────────────────────────────────
  const auditCounts = settlements.reduce(
    (acc, s) => {
      const status = deriveAuditStatus(s, xeroMatches[s.settlement_id], validationStatusMap[s.settlement_id]);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<AuditStatus, number>
  );

  const readyToPush = settlements.filter(s => {
    const status = deriveAuditStatus(s, xeroMatches[s.settlement_id], validationStatusMap[s.settlement_id]);
    return status === 'ready_to_push' || status === 'unknown';
  });
  const readyToPushTotal = readyToPush.reduce((sum, s) => sum + (s.bank_deposit || 0), 0);

  return (
    <div className="space-y-4 min-h-[400px]">
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground ml-2">Loading auto-imported settlements...</p>
        </div>
      )}

      {!loading && (
        <>
      {/* ─── Sync + Audit Controls ─────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <CloudDownload className="h-4 w-4 text-primary" />
                  Fetch Settlements
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lastSyncTime
                    ? `Last synced ${new Date(lastSyncTime).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : 'Fetch from Amazon SP-API'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {cooldownMinutes !== null && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {cooldownMinutes}m
                  </span>
                )}
                <Button onClick={handleSmartSync} disabled={smartSyncing || cooldownMinutes !== null} size="sm" className="gap-1.5">
                  {smartSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {smartSyncing ? 'Syncing...' : 'Sync'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Search className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Run Accounting Audit
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lastAuditTime
                    ? `Last audited ${Math.round((Date.now() - new Date(lastAuditTime).getTime()) / 60000)} min ago`
                    : 'Check Xero invoices & bank deposits'}
                </p>
              </div>
              <Button
                onClick={handleRunAudit}
                disabled={auditing}
                variant="outline"
                size="sm"
                className="gap-1.5 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              >
                {auditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck className="h-3.5 w-3.5" />}
                {auditing ? 'Auditing...' : 'Audit'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Sync Result Banner ───────────────────────────────── */}
      {syncResult && syncResult.synced > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              Found {syncResult.synced} new settlement{syncResult.synced !== 1 ? 's' : ''} totalling {formatAUD(syncResult.total_deposit)}
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
              Xero audit ran automatically — statuses updated below.
            </p>
          </div>
          <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => setSyncResult(null)}>Dismiss</Button>
        </div>
      )}

      {/* ─── Audit Summary Strip ──────────────────────────────── */}
      {settlements.length > 0 && (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-2.5 text-center">
            <p className="text-lg font-bold text-emerald-800 dark:text-emerald-300">{(auditCounts.complete || 0) + (auditCounts.in_xero || 0)}</p>
            <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">✅ In Xero</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 text-center">
            <p className="text-lg font-bold text-blue-800 dark:text-blue-300">{auditCounts.ready_to_push || 0}</p>
            <p className="text-[10px] font-medium text-blue-700 dark:text-blue-400">🟡 Ready to push</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-center">
            <p className="text-lg font-bold text-amber-800 dark:text-amber-300">{auditCounts.review || 0}</p>
            <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400">⚠️ Review</p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-2.5 text-center">
            <p className="text-lg font-bold text-emerald-800 dark:text-emerald-300">{(auditCounts.complete || 0) + (auditCounts.bank_only || 0)}</p>
            <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">🏦 Bank matched</p>
          </div>
        </div>
      )}

      {/* ─── Ready to push banner ─────────────────────────────── */}
      {readyToPush.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center gap-3">
          <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              {readyToPush.length} settlement{readyToPush.length !== 1 ? 's' : ''} totalling {formatAUD(readyToPushTotal)} — ready to push to Xero
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Click "Push to Xero" on each settlement below, or mark as "Already in Xero" if already booked.
            </p>
          </div>
        </div>
      )}

      {/* ─── Settlement Audit Table ───────────────────────────── */}
      {settlements.length === 0 && !syncResult ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <CloudDownload className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No auto-imported settlements yet.</p>
            <p className="text-xs mt-1">Click "Sync" to fetch from Amazon.</p>
          </CardContent>
        </Card>
      ) : settlements.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <CloudDownload className="h-4 w-4" />
                  Settlement Audit
                </CardTitle>
                <CardDescription className="text-xs">
                  {settlements.length} settlement(s) — system-verified against Xero and bank feed.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={toggleSelectAll}>
                  {selected.size === settlements.length ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                  {selected.size === settlements.length ? 'Deselect' : 'Select All'}
                </Button>
                {selected.size > 0 && (
                  <Button variant="destructive" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleDeleteSelected} disabled={deletingBulk}>
                    {deletingBulk ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete {selected.size}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={loadApiSettlements} className="gap-1.5 h-7 px-2 text-xs">
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {/* Table header */}
            <div className="hidden sm:grid sm:grid-cols-[auto_1fr_80px_80px_120px_auto] gap-2 px-3 pb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
              <div className="w-5" />
              <div>Settlement</div>
              <div className="text-center">Xero</div>
              <div className="text-center">Bank</div>
              <div className="text-center">Status</div>
              <div className="text-right">Actions</div>
            </div>

            <div className="space-y-1 mt-1">
              {paginatedAutoSettlements.map(s => {
                const xeroMatch = xeroMatches[s.settlement_id];
                const auditStatus = deriveAuditStatus(s, xeroMatch, validationStatusMap[s.settlement_id]);
                const config = STATUS_CONFIG[auditStatus];
                const isPreBoundary = auditStatus === 'pre_boundary';
                const canPush = auditStatus === 'ready_to_push' || auditStatus === 'unknown';
                const canMarkExternal = auditStatus === 'ready_to_push' || auditStatus === 'unknown' || auditStatus === 'review';

                const isExpanded = expandedLines === s.settlement_id;
                const lines = lineItems[s.settlement_id] || [];
                const isLoadingLines = loadingLines === s.settlement_id;

                return (
                  <div
                    key={s.id}
                    className={`border rounded-lg transition-colors ${
                      isPreBoundary ? 'opacity-40 bg-muted/20 border-muted' :
                      auditStatus === 'complete' ? 'bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200/50 dark:border-emerald-800/30' :
                      auditStatus === 'review' ? 'bg-amber-50/30 dark:bg-amber-950/10 border-amber-200/50 dark:border-amber-800/30' :
                      'hover:bg-muted/20'
                    }`}
                  >
                    <div className="p-2.5 sm:grid sm:grid-cols-[auto_1fr_80px_80px_120px_auto] gap-2 items-center">
                      {/* Checkbox */}
                      <button className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground" onClick={() => toggleSelect(s.id)}>
                        {selected.has(s.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                      </button>

                      {/* Settlement info — clickable to expand */}
                      <button
                        className="min-w-0 text-left cursor-pointer hover:opacity-80 flex items-center gap-2"
                        onClick={() => loadLineItems(s.settlement_id)}
                      >
                        {isLoadingLines ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                        ) : isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-medium">{s.settlement_id}</span>
                            {s.is_split_month && <Badge variant="outline" className="text-[10px]">Deferred Revenue</Badge>}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span>{formatShortDate(s.period_start)} → {formatShortDate(s.period_end)}</span>
                            <span className="font-medium text-foreground">{formatAUD(s.bank_deposit)}</span>
                          </div>
                        </div>
                      </button>

                      {/* Xero indicator */}
                      <div className="flex justify-center">
                        <XeroIndicator settlement={s} xeroMatch={xeroMatch} />
                      </div>

                      {/* Bank indicator */}
                      <div className="flex justify-center">
                        <BankIndicator settlement={s} />
                      </div>

                      {/* Status badge */}
                      <div className="flex justify-center">
                        <Badge className={`text-[10px] gap-1 ${config.color}`}>
                          {config.icon}
                          {config.label}
                        </Badge>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 justify-end">
                        {canMarkExternal && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                                  onClick={() => handleMarkAsInXero(s)}
                                  disabled={marking === s.id}
                                >
                                  {marking === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">Mark as already in Xero</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}

                        {canPush && onSyncToXero && (
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => handleSyncToXero(s)}
                            disabled={syncing === s.id}
                          >
                            {syncing === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                            Push to Xero
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleDelete(s)}
                          disabled={deleting === s.id}
                        >
                          {deleting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>

                    {/* ─── Transaction Drill-down ─────────────────── */}
                    {isExpanded && (
                      <div className="border-t border-border px-3 py-2 bg-muted/30">
                        {lines.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">No transaction lines found for this settlement.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                  <th className="text-left py-1 pr-2">Order ID</th>
                                  <th className="text-left py-1 pr-2">SKU</th>
                                  <th className="text-left py-1 pr-2">Type</th>
                                  <th className="text-left py-1 pr-2">Description</th>
                                  <th className="text-right py-1">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line, idx) => {
                                  const isRefund = line.transaction_type?.toLowerCase().includes('refund');
                                  const isFee = (line.amount || 0) < 0 && !isRefund;
                                  return (
                                    <tr
                                      key={idx}
                                      className={`border-t border-border/50 ${
                                        isRefund ? 'text-destructive' :
                                        isFee ? 'text-amber-600 dark:text-amber-400' :
                                        ''
                                      }`}
                                    >
                                      <td className="py-1 pr-2 font-mono">{line.order_id || '—'}</td>
                                      <td className="py-1 pr-2">{line.sku || '—'}</td>
                                      <td className="py-1 pr-2">{line.transaction_type || '—'}</td>
                                      <td className="py-1 pr-2 max-w-[200px] truncate">{line.amount_description || '—'}</td>
                                      <td className="py-1 text-right font-mono font-medium">{formatAUD(line.amount || 0)}</td>
                                    </tr>
                                  );
                                })}
                                {/* Totals row */}
                                <tr className="border-t-2 border-border font-semibold">
                                  <td colSpan={4} className="py-1.5 pr-2">Total ({lines.length} lines)</td>
                                  <td className="py-1.5 text-right font-mono">
                                    {formatAUD(lines.reduce((sum, l) => sum + (l.amount || 0), 0))}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <TablePaginationBar
              page={autoPage}
              totalPages={autoTotalPages}
              totalItems={settlements.length}
              pageSize={DEFAULT_PAGE_SIZE}
              onPageChange={setAutoPage}
            />
          </CardContent>
        </Card>
      )}
      </>
      )}
    </div>
  );
}
