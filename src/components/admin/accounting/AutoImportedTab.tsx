import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Eye, ExternalLink, Trash2, RefreshCw, CloudDownload, ShieldCheck, AlertTriangle, CheckSquare, Square } from "lucide-react";
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
  const [marking, setMarking] = useState<string | null>(null);

  const loadApiSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('source', 'api')
        .order('period_end', { ascending: false });
      if (error) throw error;
      setSettlements((data || []) as unknown as AutoImportedSettlement[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApiSettlements();
  }, [loadApiSettlements]);

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
    // Guard: never sync if marked as already in Xero
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
    if (isSynced) {
      return <Badge className="bg-green-100 text-green-800 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> Synced to Xero</Badge>;
    }
    if (settlement.reconciliation_status === 'matched') {
      return <Badge className="bg-blue-100 text-blue-800 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> Ready to Sync</Badge>;
    }
    if (settlement.reconciliation_status === 'failed') {
      return <Badge variant="destructive" className="text-[10px]"><XCircle className="h-3 w-3 mr-1" /> Reconciliation Failed</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px]">Imported</Badge>;
  };

  // Count settlements needing attention
  const needsReviewCount = settlements.filter(s => !isAlreadyInXero(s) && s.reconciliation_status === 'matched').length;

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

  if (settlements.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CloudDownload className="h-4 w-4" />
            Auto-Imported Settlements
          </CardTitle>
          <CardDescription className="text-xs">
            Settlements fetched via the Amazon SP-API will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <CloudDownload className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No auto-imported settlements yet.</p>
            <p className="text-xs mt-1">Connect your Amazon account in Settings and click "Fetch Now" to get started.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Warning banner if there are untagged settlements */}
      {needsReviewCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">
            <p className="font-medium">{needsReviewCount} settlement(s) ready to sync</p>
            <p className="mt-0.5">If any of these are already in Xero (entered manually or via another tool), mark them as <strong>"Already in Xero"</strong> to prevent duplicate entries.</p>
          </div>
        </div>
      )}

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
            <Button variant="outline" size="sm" onClick={loadApiSettlements} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {settlements.map(s => {
              const isDuplicateOfManual = existingSettlementIds.has(s.settlement_id);
              const isSynced = !!(s.xero_journal_id || s.xero_journal_id_1);
              const isMarkedExternal = s.status === 'synced_external';
              const isDisabled = (isDuplicateOfManual && !isSynced) || isMarkedExternal;
              const canSync = !isSynced && !isMarkedExternal && !isDuplicateOfManual && s.reconciliation_status === 'matched';

              return (
                <div
                  key={s.id}
                  className={`border rounded-lg p-3 transition-colors ${
                    isMarkedExternal ? 'opacity-60 bg-amber-50/30 border-amber-200/50' :
                    isDisabled ? 'opacity-50 bg-muted/30' : 'hover:bg-muted/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
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
                      {!isSynced && (
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
                          Sync to Xero
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
    </div>
  );
}
