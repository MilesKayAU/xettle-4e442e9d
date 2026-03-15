/**
 * SettlementsOverview — At-a-glance status of every marketplace.
 * Shows which marketplaces are up to date and which need attention.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Upload, Send, Loader2, CheckCircle2, AlertTriangle, Clock, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_CATALOG } from './MarketplaceSwitcher';
import type { UserMarketplace } from './MarketplaceSwitcher';
import { syncSettlementToXero, syncXeroStatus, formatAUD, type StandardSettlement } from '@/utils/settlement-engine';
import { toast } from 'sonner';
import PushSafetyPreview from './PushSafetyPreview';

interface SettlementsOverviewProps {
  userMarketplaces: UserMarketplace[];
  onSwitchToUpload?: () => void;
  onSelectMarketplace?: (code: string) => void;
}

interface MarketplaceStatus {
  code: string;
  name: string;
  icon: string;
  latestReceived: string | null;
  lastSentToXero: string | null;
  lastSentDate: string | null;
  unsentCount: number;
  status: 'unsent_settlements' | 'never_sent' | 'up_to_date' | 'no_recent_data';
  statusLabel: string;
  sortOrder: number;
}

const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

export default function SettlementsOverview({
  userMarketplaces,
  onSwitchToUpload,
  onSelectMarketplace,
}: SettlementsOverviewProps) {
  const [rows, setRows] = useState<MarketplaceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushingCode, setPushingCode] = useState<string | null>(null);
  const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);
  const [batchSettlements, setBatchSettlements] = useState<Array<{ settlementId: string; marketplace: string }>>([]);
  const [pendingBatchCode, setPendingBatchCode] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const codes = userMarketplaces.map(m => m.marketplace_code);
      if (codes.length === 0) { setRows([]); setLoading(false); return; }

      // Fetch all settlements for the user's marketplaces (exclude analytics-only shopify_auto records)
      const { data: allSettlements, error } = await supabase
        .from('settlements')
        .select('marketplace, period_end, status, xero_status, updated_at, settlement_id')
        .in('marketplace', codes)
        .neq('source', 'api_sync')
        .order('period_end', { ascending: false });

      if (error) throw error;

      const result: MarketplaceStatus[] = codes.map(code => {
        const cat = MARKETPLACE_CATALOG.find(m => m.code === code);
        const marketplaceSettlements = (allSettlements || []).filter(s => s.marketplace === code);

        // Latest received (most recent period_end)
        const latestReceived = marketplaceSettlements.length > 0
          ? marketplaceSettlements[0].period_end
          : null;

        // Latest sent to Xero
        const xeroSynced = marketplaceSettlements.filter(s =>
          ['synced', 'pushed_to_xero', 'synced_external', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero'].includes(s.status || '')
        );
        const lastSentToXero = xeroSynced.length > 0
          ? xeroSynced.sort((a, b) => b.period_end.localeCompare(a.period_end))[0].period_end
          : null;
        const lastSentDate = xeroSynced.length > 0
          ? xeroSynced.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0].updated_at
          : null;

        // Unsent count
        // Only count 'ready_to_push' and 'parsed' as unsent — NOT 'saved'
        // 'saved' means the Xero sync hasn't checked it yet
        const unsentCount = marketplaceSettlements.filter(s =>
          s.status === 'ready_to_push' || s.status === 'parsed'
        ).length;

        // Determine status
        let status: MarketplaceStatus['status'];
        let statusLabel: string;
        let sortOrder: number;

        const latestDate = latestReceived ? new Date(latestReceived) : null;
        const isStale = latestDate && (Date.now() - latestDate.getTime() > FORTY_FIVE_DAYS_MS);

        if (!lastSentToXero && unsentCount === 0 && !latestReceived) {
          status = 'never_sent';
          statusLabel = 'Never sent';
          sortOrder = 2;
        } else if (unsentCount > 0) {
          status = 'unsent_settlements';
          statusLabel = `${unsentCount} unsent`;
          sortOrder = 1;
        } else if (isStale) {
          status = 'no_recent_data';
          statusLabel = 'No recent data';
          sortOrder = 4;
        } else if (lastSentToXero && latestReceived && latestReceived <= lastSentToXero) {
          status = 'up_to_date';
          statusLabel = 'Up to date';
          sortOrder = 3;
        } else if (!lastSentToXero) {
          status = 'never_sent';
          statusLabel = 'Never sent';
          sortOrder = 2;
        } else {
          status = 'unsent_settlements';
          statusLabel = 'Unsent settlements';
          sortOrder = 1;
        }

        return {
          code,
          name: cat?.name || code,
          icon: cat?.icon || '📦',
          latestReceived,
          lastSentToXero,
          lastSentDate,
          unsentCount,
          status,
          statusLabel,
          sortOrder,
        };
      });

      // Sort: unsent first, then never sent, then up to date, then no recent data
      result.sort((a, b) => a.sortOrder - b.sortOrder);
      setRows(result);
    } catch (err) {
      console.error('SettlementsOverview load error:', err);
    } finally {
      setLoading(false);
    }
  }, [userMarketplaces]);

  useEffect(() => { loadData(); }, [loadData]);

  const handlePushAll = async (code: string) => {
    setPushingCode(code);
    try {
      // Only ready_to_push — never parsed (must be validated first)
      const { data: unsent, error } = await supabase
        .from('settlements')
        .select('settlement_id, marketplace')
        .eq('marketplace', code)
        .eq('status', 'ready_to_push')
        .eq('is_hidden', false)
        .eq('is_pre_boundary', false)
        .is('duplicate_of_settlement_id', null)
        .order('period_end');

      if (error) throw error;
      if (!unsent || unsent.length === 0) {
        toast.info('No settlements ready to push');
        setPushingCode(null);
        return;
      }

      // Open PushSafetyPreview for the batch — Golden Rule enforced
      setBatchSettlements(unsent.map(s => ({
        settlementId: s.settlement_id,
        marketplace: s.marketplace || code,
      })));
      setPendingBatchCode(code);
      setBatchPreviewOpen(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load settlements');
    } finally {
      setPushingCode(null);
    }
  };

  const handleBatchConfirm = async () => {
    const code = pendingBatchCode;
    setBatchPreviewOpen(false);
    if (!code) return;
    setPushingCode(code);
    try {
      let ok = 0, fail = 0;
      for (const s of batchSettlements) {
        const result = await syncSettlementToXero(s.settlementId, s.marketplace);
        if (result.success) ok++;
        else fail++;
      }
      toast.success(`✅ ${ok} pushed${fail > 0 ? ` · ❌ ${fail} failed` : ''}`);
      await syncXeroStatus();
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Push failed');
    } finally {
      setPushingCode(null);
      setBatchSettlements([]);
      setPendingBatchCode(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  const StatusBadge = ({ row }: { row: MarketplaceStatus }) => {
    switch (row.status) {
      case 'unsent_settlements':
        return (
          <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]">
            🟡 {row.statusLabel}
          </Badge>
        );
      case 'never_sent':
        return (
          <Badge variant="destructive" className="text-[10px]">
            🔴 {row.statusLabel}
          </Badge>
        );
      case 'up_to_date':
        return (
          <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
            ✅ {row.statusLabel}
          </Badge>
        );
      case 'no_recent_data':
        return (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">
            ⚠️ {row.statusLabel}
          </Badge>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <Card className="border-border">
        <CardContent className="py-6 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading overview…
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) return null;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Circle className="h-3 w-3 fill-primary text-primary" />
          Settlements Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center pb-2 border-b border-border mb-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Marketplace</span>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right min-w-[90px]">Latest Received</span>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right min-w-[90px]">Last Sent to Xero</span>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-center min-w-[100px]">Status</span>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right min-w-[120px]">Actions</span>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border/50">
          {rows.map(row => (
            <div
              key={row.code}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center py-2.5 hover:bg-muted/30 transition-colors rounded-sm px-1 -mx-1"
            >
              {/* Marketplace */}
              <div className="flex items-center gap-2">
                <span className="text-base">{row.icon}</span>
                <span className="text-sm font-medium text-foreground">{row.name}</span>
              </div>

              {/* Latest Received */}
              <span className="text-xs text-muted-foreground text-right min-w-[90px]">
                {formatDate(row.latestReceived)}
              </span>

              {/* Last Sent to Xero */}
              <span className="text-xs text-muted-foreground text-right min-w-[90px]">
                {formatDate(row.lastSentToXero)}
              </span>

              {/* Status */}
              <div className="flex justify-center min-w-[100px]">
                <StatusBadge row={row} />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-1.5 min-w-[120px]">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 gap-1"
                  onClick={() => {
                    if (onSelectMarketplace) onSelectMarketplace(row.code);
                    if (onSwitchToUpload) onSwitchToUpload();
                  }}
                >
                  <Upload className="h-3 w-3" />
                  Upload
                </Button>
                {row.unsentCount > 0 && (
                  <Button
                    size="sm"
                    className="h-6 text-[10px] px-2 gap-1"
                    onClick={() => handlePushAll(row.code)}
                    disabled={pushingCode === row.code}
                  >
                    {pushingCode === row.code ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Push to Xero
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      {/* Golden Rule: Batch push goes through PushSafetyPreview */}
      <PushSafetyPreview
        open={batchPreviewOpen}
        onClose={() => {
          setBatchPreviewOpen(false);
          setBatchSettlements([]);
          setPendingBatchCode(null);
        }}
        onConfirm={handleBatchConfirm}
        settlements={batchSettlements}
      />
    </Card>
  );
}
