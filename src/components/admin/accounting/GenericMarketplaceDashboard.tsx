import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2, FileText, Upload, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_CATALOG, type UserMarketplace } from './MarketplaceSwitcher';

interface GenericMarketplaceDashboardProps {
  marketplace: UserMarketplace;
  onMarketplacesChanged?: () => void;
  onSwitchToUpload?: () => void;
}

interface SettlementRow {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  sales_principal: number | null;
  seller_fees: number | null;
  bank_deposit: number | null;
  status: string | null;
  created_at: string;
  gst_on_income: number | null;
  gst_on_expenses: number | null;
}

function formatAUD(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function GenericMarketplaceDashboard({ marketplace, onMarketplacesChanged, onSwitchToUpload }: GenericMarketplaceDashboardProps) {
  const def = MARKETPLACE_CATALOG.find(m => m.code === marketplace.marketplace_code);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadSettlements = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, sales_principal, seller_fees, bank_deposit, status, created_at, gst_on_income, gst_on_expenses')
        .eq('marketplace', marketplace.marketplace_code)
        .order('period_end', { ascending: false });
      if (error) throw error;
      setSettlements((data || []) as SettlementRow[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [marketplace.marketplace_code]);

  useEffect(() => {
    loadSettlements(true);
  }, [loadSettlements]);

  // Realtime: auto-refresh when settlements change
  useEffect(() => {
    const channel = supabase
      .channel(`settlements-${marketplace.marketplace_code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, () => {
        loadSettlements();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadSettlements, marketplace.marketplace_code]);

  const handleDelete = useCallback(async (settlement: SettlementRow) => {
    setDeleting(settlement.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await supabase.from('settlement_lines').delete().eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlement_unmapped').delete().eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlements').delete().eq('id', settlement.id);

      toast.success(`Deleted settlement ${settlement.settlement_id}`);
      loadSettlements();
    } catch (err: any) {
      toast.error(`Failed to delete: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  }, [loadSettlements]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">{def?.icon || '📋'}</span>
          {def?.name || marketplace.marketplace_name} Settlements
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          View saved settlements, reconcile, and sync to Xero.
        </p>
      </div>

      {/* Upload prompt — directs to Smart Upload */}
      {onSwitchToUpload && (
        <Card className="border-dashed border-2 border-primary/20 hover:border-primary/40 transition-colors cursor-pointer" onClick={onSwitchToUpload}>
          <CardContent className="py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Upload {def?.name || marketplace.marketplace_name} files
                </p>
                <p className="text-xs text-muted-foreground">
                  Use Smart Upload to drop files — auto-detects, previews, and saves
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Upload className="h-4 w-4" />
              Smart Upload
              <ArrowRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Settlement History */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Saved Settlements
          {settlements.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{settlements.length}</Badge>
          )}
        </h4>

        {loading ? (
          <Card className="border-border">
            <CardContent className="py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading settlements…
            </CardContent>
          </Card>
        ) : settlements.length === 0 ? (
          <Card className="border-border">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No settlements saved yet.
              </p>
              {onSwitchToUpload && (
                <Button variant="link" size="sm" onClick={onSwitchToUpload} className="mt-2 gap-1">
                  <Upload className="h-3.5 w-3.5" />
                  Upload files via Smart Upload
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {settlements.map(s => {
              const sales = s.sales_principal || 0;
              const fees = s.seller_fees || 0;
              const net = s.bank_deposit || 0;
              const gstIncome = s.gst_on_income || 0;

              return (
                <Card key={s.id} className="border-border hover:border-primary/20 transition-colors">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">
                            {formatDate(s.period_start)} – {formatDate(s.period_end)}
                          </span>
                          <Badge
                            variant={s.status === 'pushed_to_xero' || s.status === 'synced' ? 'default' : 'secondary'}
                            className="text-[10px]"
                          >
                            {s.status === 'pushed_to_xero' || s.status === 'synced' ? 'Posted to Xero ✓' : s.status || 'Saved'}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          ID: {s.settlement_id}
                        </p>
                        <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                          <span>Sales: <span className="font-medium text-foreground">{formatAUD(sales)}</span></span>
                          <span>Fees: <span className="font-medium text-foreground">{formatAUD(fees)}</span></span>
                          {gstIncome > 0 && <span>GST: <span className="font-medium text-foreground">{formatAUD(gstIncome)}</span></span>}
                          <span>Net: <span className="font-semibold text-primary">{formatAUD(net)}</span></span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        disabled={deleting === s.id}
                        onClick={() => handleDelete(s)}
                      >
                        {deleting === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
