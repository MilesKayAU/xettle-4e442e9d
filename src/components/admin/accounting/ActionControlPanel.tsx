import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Send, CheckCircle2, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_CATALOG } from './MarketplaceSwitcher';
import { formatSettlementDate } from '@/utils/settlement-engine';
import type { UserMarketplace } from './MarketplaceSwitcher';

interface ActionControlPanelProps {
  userMarketplaces: UserMarketplace[];
  onSwitchToUpload: () => void;
  onPushSettlement?: (settlementId: string) => void;
}

interface SettlementMini {
  id: string;
  settlement_id: string;
  marketplace: string;
  status: string | null;
  period_start: string;
  period_end: string;
  bank_deposit: number | null;
  updated_at: string;
}

function formatAUD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ActionControlPanel({ userMarketplaces, onSwitchToUpload, onPushSettlement }: ActionControlPanelProps) {
  const [settlements, setSettlements] = useState<SettlementMini[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, status, period_start, period_end, bank_deposit, updated_at')
        .lte('period_start', monthEnd)
        .gte('period_end', monthStart)
        .order('period_start', { ascending: false });
      if (error) throw error;
      setSettlements((data || []) as SettlementMini[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [monthStart, monthEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  // Derive statuses
  const connectedCodes = new Set(userMarketplaces.map(m => m.marketplace_code));
  const uploadedCodes = new Set(settlements.map(s => s.marketplace));
  const missingCodes = [...connectedCodes].filter(c => !uploadedCodes.has(c));
  const missingNames = missingCodes.map(c => MARKETPLACE_CATALOG.find(m => m.code === c)?.name || c);

  const readySettlements = settlements.filter(s => s.status === 'saved' || s.status === 'parsed');
  const syncedSettlements = settlements.filter(s => ['synced', 'pushed_to_xero', 'synced_external', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero'].includes(s.status || ''));

  const allClear = missingCodes.length === 0 && readySettlements.length === 0 && syncedSettlements.length > 0;

  if (loading) return null;
  if (settlements.length === 0 && missingCodes.length === 0) return null;

  // Find last sync time
  const lastSynced = syncedSettlements.length > 0
    ? syncedSettlements.reduce((latest, s) => s.updated_at > latest ? s.updated_at : latest, syncedSettlements[0].updated_at)
    : null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">What needs your attention</h3>

      {allClear ? (
        <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 rounded-xl shadow-sm">
          <CardContent className="py-6 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Everything is synced</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                Your books are up to date. {syncedSettlements.length} settlement{syncedSettlements.length !== 1 ? 's' : ''} in Xero.
                {lastSynced && <span className="ml-1">Last sync: {timeAgo(lastSynced)}</span>}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Upload Needed */}
          {missingCodes.length > 0 && (
            <Card className="bg-amber-100 dark:bg-amber-950/30 border-amber-400 dark:border-amber-700 rounded-xl shadow-sm ring-1 ring-amber-300 dark:ring-amber-800">
              <CardContent className="py-5 px-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">Upload Needed</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {missingCodes.length} settlement{missingCodes.length !== 1 ? 's' : ''} missing
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    {missingNames.map((name, i) => {
                      const isKogan = missingCodes[i]?.toLowerCase().includes('kogan');
                      return (
                        <span key={i}>
                          {i > 0 ? ', ' : ''}{name}{isKogan ? ' (CSV + PDF pair)' : ''}
                        </span>
                      );
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/30"
                  onClick={onSwitchToUpload}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload File
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Ready to Push */}
          {readySettlements.length > 0 && (
            <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 rounded-xl shadow-sm">
              <CardContent className="py-5 px-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                    <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide">Ready to Push</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                    {readySettlements.length} settlement{readySettlements.length !== 1 ? 's' : ''} ready
                  </p>
                  {readySettlements.slice(0, 2).map(s => (
                    <p key={s.id} className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                      {formatSettlementDate(s.period_start)} – {formatSettlementDate(s.period_end)} · {formatAUD(s.bank_deposit || 0)}
                    </p>
                  ))}
                  {readySettlements.length > 2 && (
                    <p className="text-xs text-blue-600 dark:text-blue-500 mt-0.5">
                      +{readySettlements.length - 2} more
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    // Scroll to the monthly status which has Push All Ready
                    document.querySelector('[data-push-all]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  <Send className="h-3.5 w-3.5" />
                  Push to Xero
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Synced */}
          {syncedSettlements.length > 0 && (
            <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 rounded-xl shadow-sm">
              <CardContent className="py-5 px-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">All Synced</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                    {syncedSettlements.length} settlement{syncedSettlements.length !== 1 ? 's' : ''} in Xero
                  </p>
                  {lastSynced && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last sync: {timeAgo(lastSynced)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
