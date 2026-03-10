import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Eye, ExternalLink, Trash2, RefreshCw, CloudDownload, ShieldCheck, AlertTriangle, CheckSquare, Square, Zap, Clock } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatAUD } from '@/utils/settlement-parser';

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

interface AutoImportedTabProps {
  onViewSettlement?: (settlementId: string) => void;
  onSyncToXero?: (settlementId: string) => void;
  existingSettlementIds: Set<string>;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function AutoImportedTab({ onViewSettlement, onSyncToXero, existingSettlementIds }: AutoImportedTabProps) {
  const [settlements, setSettlements] = useState<AutoImportedSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  
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
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('source', 'api')
        .eq('marketplace', 'amazon_au')
        .order('period_end', { ascending: false });
      if (error) throw error;
      setSettlements((data || []) as unknown as AutoImportedSettlement[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Load cooldown status
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
    loadCooldown();
  }, [loadApiSettlements, loadCooldown]);

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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settlements',
          filter: 'source=eq.api',
        },
        () => {
          loadApiSettlements();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadApiSettlements]);

  // ─── Smart Sync Handler ────────────────────────────────────────
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

      const { synced = 0, total_deposit = 0, settlements: syncedSettlements = [], skipped = 0, errors } = data || {};

      if (synced > 0) {
        setSyncResult({ synced, total_deposit, settlements: syncedSettlements });
        toast.success(`Found ${synced} new settlement${synced !== 1 ? 's' : ''} totalling ${formatAUD(total_deposit)} — ready to push to Xero`);
        await loadApiSettlements();
      } else {
        toast.info('All Amazon settlements already imported — nothing new to sync.');
      }

      if (errors && errors.length > 0) {
        console.warn('[Amazon Smart Sync Errors]', errors);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await supabase.from('settlement_lines').delete()
        .eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlement_unmapped').delete()
        .eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlements').delete().eq('id', settlement.id);

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
    if (selected.size === settlements.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(settlements.map(s => s.id)));
    }
  };

  const handleDeleteSelected = async () => {
    const toDelete = settlements.filter(s => selected.has(s.id));
    if (toDelete.length === 0) return;
    if (!confirm(`Delete ${toDelete.length} auto-imported settlement(s)?`)) return;
    setDeletingBulk(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      for (const s of toDelete) {
        await supabase.from('settlement_lines').delete()
          .eq('user_id', user.id).eq('settlement_id', s.settlement_id);
        await supabase.from('settlement_unmapped').delete()
          .eq('user_id', user.id).eq('settlement_id', s.settlement_id);
        await supabase.from('settlements').delete().eq('id', s.id);
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

  const handleUnmarkFromXero = async (settlement: AutoImportedSettlement) => {
    setMarking(settlement.id);
    try {
      const { error } = await supabase
        .from('settlements')
        .update({ status: 'saved' } as any)
        .eq('id', settlement.id);
      if (error) throw error;
      toast.success(`Settlement ${settlement.settlement_id} unmarked — available for sync`);
      await loadApiSettlements();
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setMarking(null);
    }
  };

  const handleSyncToXero = async (settlement: AutoImportedSettlement) => {
    if (settlement.status === 'synced_external') {
      toast.error('This settlement is marked as already in Xero. Unmark it first if you want to sync.');
      return;
    }
    setSyncing(settlement.id);
    try {
      onSyncToXero?.(settlement.settlement_id);
    } finally {
      setSyncing(null);
    }
  };

  const isAlreadyInXero = (s: AutoImportedSettlement) =>
    s.status === 'synced_external' || !!(s.xero_journal_id || s.xero_journal_id_1);

  const getStatusBadge = (settlement: AutoImportedSettlement) => {
    const isSynced = !!(settlement.xero_journal_id || settlement.xero_journal_id_1);

    if (settlement.status === 'synced_external') {
      return <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50"><ShieldCheck className="h-3 w-3 mr-1" /> Already in Xero</Badge>;
    }
    if (settlement.status === 'already_recorded') {
      return <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground"><ShieldCheck className="h-3 w-3 mr-1" /> Pre-boundary</Badge>;
    }
    if (isSynced) {
      return <Badge className="bg-green-100 text-green-800 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> Synced to Xero</Badge>;
    }
    if (settlement.status === 'ready_to_push') {
      return <Badge className="bg-blue-100 text-blue-800 text-[10px]"><Zap className="h-3 w-3 mr-1" /> Ready to Push</Badge>;
    }
    if (settlement.reconciliation_status === 'matched') {
      return <Badge className="bg-blue-100 text-blue-800 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> Ready to Sync</Badge>;
    }
    if (settlement.reconciliation_status === 'failed') {
      return <Badge variant="destructive" className="text-[10px]"><XCircle className="h-3 w-3 mr-1" /> Reconciliation Failed</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px]">Imported</Badge>;
  };

  // Count settlements ready to push to Xero
  const readyToPush = settlements.filter(s => 
    (s.status === 'ready_to_push' || (s.reconciliation_status === 'matched' && s.status !== 'synced_external' && s.status !== 'already_recorded')) && 
    !s.xero_journal_id && !s.xero_journal_id_1
  );
  const readyToPushTotal = readyToPush.reduce((sum, s) => sum + (s.bank_deposit || 0), 0);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Loading auto-imported settlements...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Sync Amazon Settlements Button ─────────────────────────── */}
      <Card className="border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CloudDownload className="h-4 w-4 text-primary" />
                Sync Amazon Settlements
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lastSyncTime
                  ? `Last synced ${new Date(lastSyncTime).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : 'Fetch missing settlements from Amazon SP-API'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {cooldownMinutes !== null && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {cooldownMinutes}m cooldown
                </span>
              )}
              <Button
                onClick={handleSmartSync}
                disabled={smartSyncing || cooldownMinutes !== null}
                className="gap-1.5"
                size="sm"
              >
                {smartSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {smartSyncing ? 'Syncing...' : cooldownMinutes !== null ? 'Cooldown' : 'Sync Now'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Sync Result Banner ───────────────────────────────────── */}
      {syncResult && syncResult.synced > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">
              Found {syncResult.synced} new settlement{syncResult.synced !== 1 ? 's' : ''} totalling {formatAUD(syncResult.total_deposit)}
            </p>
            <p className="text-xs text-green-700 mt-1">
              Ready to push to Xero. Review below and click "Push to Xero" for each settlement.
            </p>
            <div className="mt-2 space-y-1">
              {syncResult.settlements.map(s => (
                <div key={s.settlement_id} className="text-xs text-green-700 flex items-center gap-2">
                  <span className="font-mono">{s.settlement_id}</span>
                  <span>{formatDate(s.period_start)} → {formatDate(s.period_end)}</span>
                  <span className="font-medium">{formatAUD(s.deposit)}</span>
                </div>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => setSyncResult(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* ─── Ready to Push Summary ────────────────────────────────── */}
      {readyToPush.length > 0 && !syncResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
          <Zap className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-800">
            <p className="font-medium">{readyToPush.length} settlement{readyToPush.length !== 1 ? 's' : ''} totalling {formatAUD(readyToPushTotal)} — ready to push to Xero</p>
            <p className="mt-0.5">Click "Push to Xero" on each settlement below, or mark as "Already in Xero" if already booked.</p>
          </div>
        </div>
      )}

      {settlements.length === 0 && !syncResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CloudDownload className="h-4 w-4" />
              Auto-Imported Settlements
            </CardTitle>
            <CardDescription className="text-xs">
              Click "Sync Now" above to fetch settlement reports from Amazon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <CloudDownload className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No auto-imported settlements yet.</p>
              <p className="text-xs mt-1">Connect your Amazon account and click "Sync Now" to get started.</p>
            </div>
          </CardContent>
        </Card>
      ) : settlements.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <CloudDownload className="h-4 w-4" />
                  Auto-Imported Settlements
                </CardTitle>
                <CardDescription className="text-xs">
                  {settlements.length} settlement(s) fetched from Amazon SP-API. Review and sync to Xero.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {settlements.length > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={toggleSelectAll}
                    >
                      {selected.size === settlements.length ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                      {selected.size === settlements.length ? 'Deselect All' : 'Select All'}
                    </Button>
                    {selected.size > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={handleDeleteSelected}
                        disabled={deletingBulk}
                      >
                        {deletingBulk ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete {selected.size}
                      </Button>
                    )}
                  </>
                )}
                <Button variant="outline" size="sm" onClick={loadApiSettlements} className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {settlements.map(s => {
                const isDuplicateOfManual = existingSettlementIds.has(s.settlement_id);
                const isSynced = !!(s.xero_journal_id || s.xero_journal_id_1);
                const isMarkedExternal = s.status === 'synced_external';
                const isPreBoundary = s.status === 'already_recorded';
                const isDisabled = (isDuplicateOfManual && !isSynced) || isMarkedExternal || isPreBoundary;
                const canSync = !isSynced && !isMarkedExternal && !isPreBoundary && !isDuplicateOfManual && 
                  (s.status === 'ready_to_push' || s.reconciliation_status === 'matched');

                return (
                  <div
                    key={s.id}
                    className={`border rounded-lg p-3 transition-colors ${
                      isPreBoundary ? 'opacity-40 bg-muted/20 border-muted' :
                      isMarkedExternal ? 'opacity-60 bg-amber-50/30 border-amber-200/50' :
                      isDisabled ? 'opacity-50 bg-muted/30' : 'hover:bg-muted/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <button
                        className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => toggleSelect(s.id)}
                      >
                        {selected.has(s.id) ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium">{s.settlement_id}</span>
                          {getStatusBadge(s)}
                          {isDuplicateOfManual && !isMarkedExternal && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              Already in History
                            </Badge>
                          )}
                          {s.is_split_month && (
                            <Badge variant="outline" className="text-[10px]">Split Month</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span>{formatDate(s.period_start)} → {formatDate(s.period_end)}</span>
                          <span className="font-medium text-foreground">{formatAUD(s.bank_deposit)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Mark / Unmark as Already in Xero */}
                        {!isSynced && !isPreBoundary && (
                          isMarkedExternal ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs gap-1 text-amber-700 hover:text-amber-800"
                              onClick={() => handleUnmarkFromXero(s)}
                              disabled={marking === s.id}
                            >
                              {marking === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                              Unmark
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => handleMarkAsInXero(s)}
                              disabled={marking === s.id}
                              title="Mark as already entered in Xero — prevents sync"
                            >
                              {marking === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                              Already in Xero
                            </Button>
                          )
                        )}

                        {onViewSettlement && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => onViewSettlement(s.settlement_id)}
                          >
                            <Eye className="h-3 w-3" /> View
                          </Button>
                        )}
                        {canSync && onSyncToXero && (
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
                          className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(s)}
                          disabled={deleting === s.id}
                        >
                          {deleting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
