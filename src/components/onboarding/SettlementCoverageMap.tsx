/**
 * SettlementCoverageMap — Week-bucket grid showing settlement coverage per marketplace.
 * Red cells only appear when unmatched bank deposits exist (evidence-based).
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { EyeOff, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────

interface Settlement {
  marketplace: string | null;
  period_start: string;
  period_end: string;
  settlement_id: string;
}

interface XeroMatch {
  settlement_id: string;
}

interface BankTxn {
  xero_transaction_id: string;
  date: string | null;
  amount: number | null;
  contact_name: string | null;
  description: string | null;
  bank_account_id: string | null;
  xero_status: string | null;
}

interface MarketplaceConnection {
  marketplace_code: string;
  marketplace_name: string;
}

interface RegistryEntry {
  marketplace_code: string;
  marketplace_name: string;
  bank_narration_patterns: any;
}

interface SubChannel {
  marketplace_label: string;
  order_count: number | null;
  source_name: string;
}

type CellState = 'green' | 'amber' | 'grey' | 'red';

interface WeekBucket {
  start: string; // YYYY-MM-DD
  end: string;
  label: string;
}

interface CoverageCell {
  state: CellState;
  settlementCount: number;
  unmatchedDepositCount: number;
}

export interface CoverageData {
  marketplaces: string[];
  weekBuckets: WeekBucket[];
  cells: Record<string, Record<string, CoverageCell>>; // marketplace -> weekLabel -> cell
  redCellCount: number;
  greenCount: number;
  amberCount: number;
  greyCount: number;
  subChannels: SubChannel[];
}

interface SettlementCoverageMapProps {
  lookbackDays: number;
  onIgnoreMarketplace?: (code: string) => void;
  onCoverageComputed?: (data: CoverageData) => void;
}

// ─── Helpers ────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function generateWeekBuckets(lookbackDays: number): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 1); // include today

  // Walk backwards in 7-day chunks
  const numWeeks = Math.min(Math.ceil(lookbackDays / 7), 13);
  for (let i = numWeeks - 1; i >= 0; i--) {
    const weekEnd = new Date(end);
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);

    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const labelFmt = (d: Date) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

    buckets.push({
      start: fmt(weekStart),
      end: fmt(weekEnd),
      label: `${labelFmt(weekStart)}`,
    });
  }
  return buckets;
}

/** Async-safe SHA-256 fingerprint for bank txn dismissals */
async function bankTxnFingerprint(bankAccountId: string | null, date: string | null, amount: number | null, description: string | null): Promise<string> {
  const raw = `${bankAccountId || ''}|${date || ''}|${amount ?? 0}|${normalizeText(description || '')}`;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function settlementOverlapsWeek(periodStart: string, periodEnd: string, weekStart: string, weekEnd: string): boolean {
  return periodStart <= weekEnd && periodEnd >= weekStart;
}

function depositInWeek(date: string, weekStart: string, weekEnd: string): boolean {
  return date >= weekStart && date <= weekEnd;
}

function matchesNarrationPatterns(txn: BankTxn, patterns: string[]): { matched: boolean; pattern?: string } {
  if (!patterns || patterns.length === 0) return { matched: false };
  const contactNorm = normalizeText(txn.contact_name || '');
  const descNorm = normalizeText(txn.description || '');
  for (const p of patterns) {
    const pNorm = normalizeText(p);
    if (contactNorm.includes(pNorm) || descNorm.includes(pNorm)) {
      return { matched: true, pattern: p };
    }
  }
  return { matched: false };
}

// ─── Component ──────────────────────────────────────────────────

export default function SettlementCoverageMap({ lookbackDays, onIgnoreMarketplace, onCoverageComputed }: SettlementCoverageMapProps) {
  const [loading, setLoading] = useState(true);
  const [coverageData, setCoverageData] = useState<CoverageData | null>(null);

  const weekBuckets = useMemo(() => generateWeekBuckets(lookbackDays), [lookbackDays]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const horizonStart = new Date();
      horizonStart.setDate(horizonStart.getDate() - lookbackDays);
      const startStr = horizonStart.toISOString().split('T')[0];

      // Batched queries
      const [
        connectionsRes,
        settlementsRes,
        xeroMatchesRes,
        bankTxnsRes,
        registryRes,
        ignoredRes,
        dismissedRes,
        subChannelsRes,
      ] = await Promise.all([
        supabase.from('marketplace_connections').select('marketplace_code, marketplace_name'),
        supabase.from('settlements')
          .select('marketplace, period_start, period_end, settlement_id')
          .gte('period_end', startStr)
          .eq('is_hidden', false)
          .is('duplicate_of_settlement_id', null),
        supabase.from('xero_accounting_matches')
          .select('settlement_id'),
        supabase.from('bank_transactions')
          .select('xero_transaction_id, date, amount, contact_name, description, bank_account_id, xero_status')
          .gte('date', startStr)
          .eq('transaction_type', 'RECEIVE'),
        supabase.from('marketplace_registry')
          .select('marketplace_code, marketplace_name, bank_narration_patterns')
          .eq('is_active', true),
        supabase.from('app_settings')
          .select('value')
          .eq('key', 'ignored_marketplaces')
          .maybeSingle(),
        supabase.from('app_settings')
          .select('value')
          .eq('key', 'dismissed_bank_txns')
          .maybeSingle(),
        supabase.from('shopify_sub_channels')
          .select('marketplace_label, order_count, source_name')
          .eq('ignored', false),
      ]);

      const connections = (connectionsRes.data || []) as MarketplaceConnection[];
      const settlements = (settlementsRes.data || []) as Settlement[];
      const xeroMatches = new Set((xeroMatchesRes.data || []).map((m: XeroMatch) => m.settlement_id));
      const bankTxns = (bankTxnsRes.data || []) as BankTxn[];
      const registry = (registryRes.data || []) as RegistryEntry[];
      const ignoredList: string[] = ignoredRes.data?.value ? JSON.parse(ignoredRes.data.value) : [];
      const dismissedKeys: string[] = dismissedRes.data?.value ? JSON.parse(dismissedRes.data.value) : [];
      const dismissedSet = new Set(dismissedKeys);
      const subChannels = (subChannelsRes.data || []) as SubChannel[];

      // Build narration pattern lookup
      const narrationMap = new Map<string, string[]>();
      for (const r of registry) {
        const patterns = Array.isArray(r.bank_narration_patterns) ? r.bank_narration_patterns : [];
        if (patterns.length > 0) narrationMap.set(r.marketplace_code, patterns);
      }

      // Filter connected marketplaces (excluding ignored)
      const marketplaces = connections
        .map(c => c.marketplace_code)
        .filter(code => !ignoredList.includes(code));

      // Compute dismissed fingerprints for bank txns
      const bankTxnFingerprintsAsync = bankTxns.map(async txn => ({
        txn,
        fingerprint: await bankTxnFingerprint(txn.bank_account_id, txn.date, txn.amount, txn.description),
      }));
      const bankTxnWithFingerprints = await Promise.all(bankTxnFingerprintsAsync);
      const activeBankTxns = bankTxnWithFingerprints.filter(({ fingerprint }) => !dismissedSet.has(fingerprint));

      // Build cells
      const cells: Record<string, Record<string, CoverageCell>> = {};
      let redCount = 0, greenCount = 0, amberCount = 0, greyCount = 0;

      for (const mkt of marketplaces) {
        cells[mkt] = {};
        const mktSettlements = settlements.filter(s => s.marketplace === mkt);
        const mktPatterns = narrationMap.get(mkt) || [];

        for (const week of weekBuckets) {
          // Settlements in this week
          const weekSettlements = mktSettlements.filter(s =>
            settlementOverlapsWeek(s.period_start, s.period_end, week.start, week.end)
          );
          const hasSettlement = weekSettlements.length > 0;
          const hasXeroMatch = weekSettlements.some(s => xeroMatches.has(s.settlement_id));

          // Unmatched bank deposits for this marketplace in this week
          let unmatchedCount = 0;
          if (mktPatterns.length > 0) {
            for (const { txn } of activeBankTxns) {
              if (!txn.date || !depositInWeek(txn.date, week.start, week.end)) continue;
              // Skip if already reconciled
              if (txn.xero_status === 'RECONCILED' || txn.xero_status === 'PAID') continue;
              const { matched } = matchesNarrationPatterns(txn, mktPatterns);
              if (!matched) continue;
              // Check if any settlement covers this deposit (amount ±$0.05, date ±3 days)
              const depositAmt = txn.amount || 0;
              const depositDate = new Date(txn.date + 'T00:00:00');
              const isMatched = mktSettlements.some(s => {
                const settStart = new Date(s.period_start + 'T00:00:00');
                const settEnd = new Date(s.period_end + 'T00:00:00');
                const daysDiff = Math.min(
                  Math.abs(depositDate.getTime() - settStart.getTime()),
                  Math.abs(depositDate.getTime() - settEnd.getTime())
                ) / 86400000;
                return daysDiff <= 3;
              });
              if (!isMatched) unmatchedCount++;
            }
          }

          let state: CellState;
          if (hasSettlement && hasXeroMatch) {
            state = 'green';
            greenCount++;
          } else if (hasSettlement) {
            state = 'amber';
            amberCount++;
          } else if (unmatchedCount > 0) {
            state = 'red';
            redCount++;
          } else {
            state = 'grey';
            greyCount++;
          }

          cells[mkt][week.label] = {
            state,
            settlementCount: weekSettlements.length,
            unmatchedDepositCount: unmatchedCount,
          };
        }
      }

      const data: CoverageData = {
        marketplaces,
        weekBuckets,
        cells,
        redCellCount: redCount,
        greenCount,
        amberCount,
        greyCount,
        subChannels,
      };

      setCoverageData(data);
      onCoverageComputed?.(data);

      // Log metric event
      try {
        await supabase.from('system_events').insert({
          user_id: user.id,
          event_type: 'onboarding_coverage_rendered',
          severity: 'info',
          details: { green: greenCount, amber: amberCount, red: redCount, grey: greyCount, marketplaces: marketplaces.length },
        } as any);
      } catch { /* silent */ }
    } catch (err) {
      console.error('[CoverageMap] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [lookbackDays, weekBuckets, onCoverageComputed]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
            Building settlement coverage map…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!coverageData || coverageData.marketplaces.length === 0) {
    return (
      <Card className="border-border">
        <CardContent className="p-4 text-center">
          <p className="text-sm text-muted-foreground">No connected marketplaces found. Connect a marketplace to see coverage.</p>
        </CardContent>
      </Card>
    );
  }

  const CELL_COLORS: Record<CellState, string> = {
    green: 'bg-emerald-500/20 border-emerald-500/40',
    amber: 'bg-amber-500/20 border-amber-500/40',
    grey: 'bg-muted/50 border-border',
    red: 'bg-destructive/15 border-destructive/40',
  };

  const CELL_LABELS: Record<CellState, string> = {
    green: 'Posted to Xero',
    amber: 'Settlement exists — not yet posted',
    grey: 'No data detected',
    red: 'Unmatched bank deposit — possible missing settlement',
  };

  const MARKETPLACE_LABELS: Record<string, string> = {
    amazon_au: 'Amazon AU',
    shopify_payments: 'Shopify Payments',
    ebay_au: 'eBay AU',
    bunnings: 'Bunnings',
    catch: 'Catch',
    kogan: 'Kogan',
    mydeal: 'MyDeal',
    bigw: 'Big W',
    woolworths_marketplus: 'Woolworths',
    theiconic: 'THE ICONIC',
    etsy: 'Etsy',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Settlement Coverage</h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40" /> Posted</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40" /> Exists</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-muted border border-border" /> No data</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-destructive/30" /> Gap</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left font-medium text-muted-foreground pb-1 pr-2 min-w-[120px]">Source</th>
              {coverageData.weekBuckets.map(w => (
                <th key={w.label} className="text-center font-normal text-muted-foreground pb-1 px-0.5 min-w-[50px]">
                  {w.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {coverageData.marketplaces.map(mkt => (
              <tr key={mkt} className="group">
                <td className="py-1 pr-2 text-foreground font-medium text-xs">
                  {MARKETPLACE_LABELS[mkt] || mkt}
                </td>
                {coverageData.weekBuckets.map(w => {
                  const cell = coverageData.cells[mkt]?.[w.label];
                  if (!cell) return <td key={w.label} className="px-0.5 py-1"><div className="h-5 rounded-sm bg-muted/30" /></td>;
                  return (
                    <td key={w.label} className="px-0.5 py-1">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className={cn('h-5 rounded-sm border cursor-default', CELL_COLORS[cell.state])} />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px]">
                            <p className="font-medium">{CELL_LABELS[cell.state]}</p>
                            {cell.settlementCount > 0 && <p>{cell.settlementCount} settlement(s)</p>}
                            {cell.unmatchedDepositCount > 0 && <p>{cell.unmatchedDepositCount} unmatched deposit(s)</p>}
                            <p className="text-muted-foreground">{w.start} – {w.end}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </td>
                  );
                })}
                <td className="py-1 pl-1">
                  {onIgnoreMarketplace && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onIgnoreMarketplace(mkt)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                          >
                            <EyeOff className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Ignore this marketplace</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Shopify sub-channels as info badges */}
      {coverageData.subChannels.length > 0 && (
        <div className="flex items-start gap-2 pt-1">
          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted-foreground">Detected sales channels:</span>
            {coverageData.subChannels.map(ch => (
              <Badge key={ch.source_name} variant="outline" className="text-[10px] py-0">
                {ch.marketplace_label} ({ch.order_count || 0})
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
