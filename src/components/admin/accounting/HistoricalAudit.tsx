import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { History, Shield, AlertTriangle, CheckCircle2, Loader2, Download, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MarketplaceAudit {
  marketplace: string;
  total_headers: number;
  already_recorded: number;
  missing: number;
  missing_settlements: Array<{
    id: string;
    date: string;
    amount: number;
    status: string;
  }>;
  reconciled_pct: number;
}

interface AuditResult {
  success: boolean;
  audit_period_days: number;
  audit_from: string;
  marketplaces: MarketplaceAudit[];
  bank_match_pct: number;
  overall_reconciled_pct: number;
  total_settlements_checked: number;
  total_missing: number;
}

function formatAUD(n: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

function getHealthColor(pct: number) {
  if (pct >= 95) return 'text-primary';
  if (pct >= 80) return 'text-amber-600';
  return 'text-destructive';
}

function getHealthBg(pct: number) {
  if (pct >= 95) return 'bg-primary';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-destructive';
}

export default function HistoricalAudit() {
  const [days, setDays] = useState('90');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in to run an audit');
        return;
      }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/historical-audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ days: parseInt(days) }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data: AuditResult = await resp.json();
      setResult(data);

      if (data.total_missing === 0) {
        toast.success('All settlements accounted for!');
      } else {
        toast.info(`Found ${data.total_missing} missing settlement${data.total_missing !== 1 ? 's' : ''}`);
      }
    } catch (err: any) {
      toast.error(`Audit failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [days]);

  return (
    <div className="space-y-6">
      {/* ─── Trigger Card ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Historical Audit</CardTitle>
          </div>
          <CardDescription>
            Compare your marketplace settlement history against what's already in your books.
            This only fetches settlement headers — no full downloads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="120">Last 120 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={runAudit} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Scanning...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Run Audit
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Results ───────────────────────────────────────────── */}
      {result && (
        <>
          {/* Books Health Check */}
          <Card className="border-2 border-primary/20">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Books Health Check</CardTitle>
              </div>
              <CardDescription>
                {result.audit_period_days}-day audit from {result.audit_from}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Per-marketplace scores */}
                {result.marketplaces.map((mkt) => (
                  <div key={mkt.marketplace} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{mkt.marketplace}</span>
                      <span className={`text-lg font-bold ${getHealthColor(mkt.reconciled_pct)}`}>
                        {mkt.reconciled_pct}%
                      </span>
                    </div>
                    <Progress value={mkt.reconciled_pct} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {mkt.already_recorded} recorded · {mkt.missing} missing
                    </p>
                  </div>
                ))}

                {/* Bank deposits */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Bank Deposits</span>
                    <span className={`text-lg font-bold ${getHealthColor(result.bank_match_pct)}`}>
                      {result.bank_match_pct}%
                    </span>
                  </div>
                  <Progress value={result.bank_match_pct} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    Verified against bank feed
                  </p>
                </div>
              </div>

              {/* Overall summary */}
              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {result.total_missing === 0 ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {result.total_missing === 0
                      ? 'All settlements accounted for'
                      : `${result.total_missing} missing settlement${result.total_missing !== 1 ? 's' : ''} found`
                    }
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {result.total_settlements_checked} settlement headers checked
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ─── Per-marketplace detail cards ─────────────────────── */}
          {result.marketplaces.map((mkt) => (
            <Card key={mkt.marketplace}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{mkt.marketplace}</CardTitle>
                  <Badge
                    variant={mkt.missing === 0 ? 'secondary' : 'destructive'}
                    className={mkt.missing === 0 ? 'bg-primary/10 text-primary border-primary/20' : ''}
                  >
                    {mkt.missing === 0 ? '✓ Complete' : `${mkt.missing} missing`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center mb-3">
                  <div>
                    <div className="text-2xl font-bold text-foreground">{mkt.total_headers}</div>
                    <div className="text-xs text-muted-foreground">Total found</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">{mkt.already_recorded}</div>
                    <div className="text-xs text-muted-foreground">Already recorded</div>
                  </div>
                  <div>
                    <div className={`text-2xl font-bold ${mkt.missing > 0 ? 'text-destructive' : 'text-primary'}`}>
                      {mkt.missing}
                    </div>
                    <div className="text-xs text-muted-foreground">Missing</div>
                  </div>
                </div>

                {/* Missing settlement list */}
                {mkt.missing_settlements.length > 0 && (
                  <div className="border-t border-border pt-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Missing settlements:</p>
                    {mkt.missing_settlements.map((ms) => (
                      <div key={ms.id} className="flex items-center justify-between text-xs bg-muted/50 rounded px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <span className="font-mono text-foreground">{ms.id.length > 20 ? ms.id.slice(0, 20) + '…' : ms.id}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{ms.date}</span>
                          {ms.amount > 0 && <span className="font-medium text-foreground">{formatAUD(ms.amount)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
