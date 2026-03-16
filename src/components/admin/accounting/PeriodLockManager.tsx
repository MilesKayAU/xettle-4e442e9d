import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Lock, Unlock, CheckCircle2, XCircle, AlertTriangle, Loader2, Download, Shield, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatAUD } from '@/utils/settlement-parser';

interface PeriodSummary {
  month: string; // YYYY-MM
  label: string; // "Mar 2026"
  settlementCount: number;
  totalDeposit: number;
  marketplaces: string[];
  allPosted: boolean;
  hasErrors: boolean;
  hasMissingAttachments: boolean;
  isLocked: boolean;
  lockRecord?: PeriodLockRecord;
}

interface PeriodLockRecord {
  id: string;
  period_month: string;
  locked_at: string;
  locked_by: string;
  lock_hash: string | null;
  pre_lock_snapshot: any;
  unlocked_at: string | null;
  unlock_reason: string | null;
  notes: string | null;
}

interface ReadinessCheck {
  label: string;
  passed: boolean;
  detail: string;
}

async function hashSettlementData(settlements: Array<{ settlement_id: string; bank_deposit: number }>): Promise<string> {
  const payload = settlements
    .sort((a, b) => a.settlement_id.localeCompare(b.settlement_id))
    .map(s => `${s.settlement_id}:${s.bank_deposit}`)
    .join('|');
  const encoded = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function PeriodLockManager() {
  const [periods, setPeriods] = useState<PeriodSummary[]>([]);
  const [locks, setLocks] = useState<PeriodLockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockingMonth, setLockingMonth] = useState<string | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<PeriodSummary | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [readinessChecks, setReadinessChecks] = useState<Record<string, ReadinessCheck[]>>({});
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch settlements grouped by month
      const { data: settlements } = await supabase
        .from('settlements')
        .select('settlement_id, marketplace, period_end, bank_deposit, status, posting_state, posting_error, xero_invoice_id, is_hidden, is_pre_boundary, duplicate_of_settlement_id')
        .eq('user_id', user.id)
        .eq('is_hidden', false)
        .eq('is_pre_boundary', false)
        .is('duplicate_of_settlement_id', null)
        .order('period_end', { ascending: false });

      // Fetch existing locks
      const { data: lockData } = await supabase
        .from('period_locks')
        .select('*')
        .eq('user_id', user.id);

      const lockMap = new Map<string, PeriodLockRecord>();
      (lockData || []).forEach(l => {
        if (!l.unlocked_at) lockMap.set(l.period_month, l as PeriodLockRecord);
      });
      setLocks(lockData as PeriodLockRecord[] || []);

      // Group by month
      const monthMap = new Map<string, {
        settlements: typeof settlements;
        marketplaces: Set<string>;
      }>();

      (settlements || []).forEach(s => {
        const month = s.period_end?.substring(0, 7); // YYYY-MM
        if (!month) return;
        if (!monthMap.has(month)) {
          monthMap.set(month, { settlements: [], marketplaces: new Set() });
        }
        const entry = monthMap.get(month)!;
        entry.settlements.push(s);
        if (s.marketplace) entry.marketplaces.add(s.marketplace);
      });

      const periodSummaries: PeriodSummary[] = [];
      monthMap.forEach((data, month) => {
        const [year, m] = month.split('-');
        const date = new Date(parseInt(year), parseInt(m) - 1);
        const label = date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });

        const allPosted = data.settlements.every(s =>
          ['pushed_to_xero', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero', 'synced', 'already_recorded'].includes(s.status || '')
        );
        const hasErrors = data.settlements.some(s =>
          s.posting_state === 'failed' || s.posting_state === 'push_failed_permanent'
        );

        periodSummaries.push({
          month,
          label,
          settlementCount: data.settlements.length,
          totalDeposit: data.settlements.reduce((sum, s) => sum + (s.bank_deposit || 0), 0),
          marketplaces: Array.from(data.marketplaces),
          allPosted,
          hasErrors,
          hasMissingAttachments: false, // Could check system_events for attachment_failed
          isLocked: lockMap.has(month),
          lockRecord: lockMap.get(month),
        });
      });

      periodSummaries.sort((a, b) => b.month.localeCompare(a.month));
      setPeriods(periodSummaries);
    } catch (err) {
      console.error('Failed to fetch period data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const computeReadiness = useCallback(async (month: string) => {
    const period = periods.find(p => p.month === month);
    if (!period) return;

    const checks: ReadinessCheck[] = [
      {
        label: 'All settlements posted',
        passed: period.allPosted,
        detail: period.allPosted
          ? `${period.settlementCount} settlement${period.settlementCount !== 1 ? 's' : ''} posted`
          : 'Some settlements not yet pushed to accounting',
      },
      {
        label: 'No posting errors',
        passed: !period.hasErrors,
        detail: period.hasErrors ? 'Resolve errors in Exceptions inbox first' : 'No errors detected',
      },
      {
        label: 'No missing attachments',
        passed: !period.hasMissingAttachments,
        detail: period.hasMissingAttachments ? 'Some invoices missing audit attachments' : 'All attachments present',
      },
    ];

    // Check for exceptions in this period
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { count } = await supabase
        .from('system_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('event_type', ['xero_attachment_failed', 'xero_push_error', 'missing_contact_mapping'])
        .gte('created_at', `${month}-01`)
        .lt('created_at', getNextMonth(month));

      if (count && count > 0) {
        checks.push({
          label: 'No unresolved exceptions',
          passed: false,
          detail: `${count} exception${count !== 1 ? 's' : ''} found in this period`,
        });
      } else {
        checks.push({
          label: 'No unresolved exceptions',
          passed: true,
          detail: 'No exceptions in this period',
        });
      }
    }

    setReadinessChecks(prev => ({ ...prev, [month]: checks }));
  }, [periods]);

  const handleLock = async (period: PeriodSummary) => {
    setLockingMonth(period.month);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch settlement data for hash
      const { data: settlements } = await supabase
        .from('settlements')
        .select('settlement_id, bank_deposit, marketplace, status')
        .eq('user_id', user.id)
        .eq('is_hidden', false)
        .eq('is_pre_boundary', false)
        .is('duplicate_of_settlement_id', null)
        .gte('period_end', `${period.month}-01`)
        .lt('period_end', getNextMonth(period.month));

      const hash = await hashSettlementData(
        (settlements || []).map(s => ({ settlement_id: s.settlement_id, bank_deposit: s.bank_deposit || 0 }))
      );

      const snapshot = {
        settlement_count: period.settlementCount,
        total_deposit: period.totalDeposit,
        marketplaces: period.marketplaces,
        locked_at_utc: new Date().toISOString(),
      };

      const { error } = await supabase.from('period_locks').upsert({
        user_id: user.id,
        period_month: period.month,
        locked_at: new Date().toISOString(),
        locked_by: user.id,
        lock_hash: hash,
        pre_lock_snapshot: snapshot,
      }, { onConflict: 'user_id,period_month' });

      if (error) throw error;

      // Log audit event
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'period_locked',
        severity: 'info',
        details: { period_month: period.month, hash, snapshot },
      });

      toast.success(`${period.label} locked`);
      await fetchData();
    } catch (err: any) {
      toast.error(`Lock failed: ${err.message}`);
    } finally {
      setLockingMonth(null);
    }
  };

  const handleUnlock = async () => {
    if (!unlockTarget || !unlockReason.trim()) return;
    setUnlocking(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('period_locks')
        .update({
          unlocked_at: new Date().toISOString(),
          unlocked_by: user.id,
          unlock_reason: unlockReason.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('period_month', unlockTarget.month)
        .is('unlocked_at', null);

      if (error) throw error;

      // Log audit event
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'period_unlocked',
        severity: 'warning',
        details: {
          period_month: unlockTarget.month,
          reason: unlockReason.trim(),
        },
      });

      toast.success(`${unlockTarget.label} unlocked — reason recorded`);
      setUnlockTarget(null);
      setUnlockReason('');
      await fetchData();
    } catch (err: any) {
      toast.error(`Unlock failed: ${err.message}`);
    } finally {
      setUnlocking(false);
    }
  };

  const handleExportAuditPack = async (period: PeriodSummary) => {
    setExporting(period.month);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch all settlements for this period
      const { data: settlements } = await supabase
        .from('settlements')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_hidden', false)
        .eq('is_pre_boundary', false)
        .is('duplicate_of_settlement_id', null)
        .gte('period_end', `${period.month}-01`)
        .lt('period_end', getNextMonth(period.month))
        .order('period_end', { ascending: true });

      if (!settlements?.length) {
        toast.error('No settlements found for this period');
        return;
      }

      // Build settlements CSV
      const settlementHeaders = [
        'settlement_id', 'marketplace', 'period_start', 'period_end',
        'bank_deposit', 'sales_principal', 'seller_fees', 'fba_fees',
        'storage_fees', 'refunds', 'gst_on_income', 'gst_on_expenses',
        'net_ex_gst', 'status', 'xero_invoice_id', 'xero_invoice_number',
        'repost_chain_id', 'repost_of_invoice_id', 'repost_reason'
      ];
      const csvRows = [settlementHeaders.join(',')];
      settlements.forEach(s => {
        csvRows.push(settlementHeaders.map(h => {
          const val = (s as any)[h];
          if (val === null || val === undefined) return '';
          return typeof val === 'string' && val.includes(',') ? `"${val}"` : String(val);
        }).join(','));
      });

      // Build hashes CSV
      const hashRows = ['settlement_id,bank_deposit,hash'];
      const sortedForHash = [...settlements].sort((a, b) => a.settlement_id.localeCompare(b.settlement_id));
      for (const s of sortedForHash) {
        const payload = `${s.settlement_id}:${s.bank_deposit || 0}`;
        const encoded = new TextEncoder().encode(payload);
        const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
        const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        hashRows.push(`${s.settlement_id},${s.bank_deposit || 0},${hash}`);
      }

      // Pack lock metadata
      const lockInfo = period.lockRecord
        ? `Locked at: ${period.lockRecord.locked_at}\nLock hash: ${period.lockRecord.lock_hash}\nSnapshot: ${JSON.stringify(period.lockRecord.pre_lock_snapshot, null, 2)}`
        : 'Period not locked at time of export';

      // Download as individual files (using Blob + anchor)
      const zip = [
        { name: `settlements_${period.month}.csv`, content: csvRows.join('\n') },
        { name: `hashes_${period.month}.csv`, content: hashRows.join('\n') },
        { name: `lock_metadata_${period.month}.txt`, content: lockInfo },
      ];

      // Download each file
      for (const file of zip) {
        const blob = new Blob([file.content], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }

      toast.success(`Audit pack exported for ${period.label} (${zip.length} files)`);
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  };

  const allChecksPassed = (month: string) => {
    const checks = readinessChecks[month];
    return checks && checks.length > 0 && checks.every(c => c.passed);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" />
          Period Close
        </CardTitle>
        <CardDescription className="text-xs">
          Lock completed months to prevent modifications. Export audit packs for your accountant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading periods…
          </div>
        ) : periods.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No settlement periods found.</p>
        ) : (
          <div className="space-y-2">
            {periods.map(period => {
              const checks = readinessChecks[period.month];
              const isExpanded = expandedMonth === period.month;

              return (
                <div key={period.month} className="border rounded-md">
                  {/* Period row */}
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      const next = isExpanded ? null : period.month;
                      setExpandedMonth(next);
                      if (next && !readinessChecks[next]) computeReadiness(next);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {period.isLocked ? (
                        <Lock className="h-4 w-4 text-green-600" />
                      ) : (
                        <Unlock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <span className="text-sm font-medium">{period.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {period.settlementCount} settlement{period.settlementCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">{formatAUD(period.totalDeposit)}</span>
                      {period.isLocked ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">Locked</Badge>
                      ) : period.allPosted && !period.hasErrors ? (
                        <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">Ready</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700">Open</Badge>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t p-4 space-y-4 bg-muted/10">
                      {/* Readiness checks */}
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Lock Readiness
                        </h4>
                        {!checks ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <div className="space-y-1.5">
                            {checks.map((check, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                {check.passed ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                )}
                                <span className={check.passed ? 'text-foreground' : 'text-red-700'}>
                                  {check.label}
                                </span>
                                <span className="text-muted-foreground">— {check.detail}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Lock info if locked */}
                      {period.isLocked && period.lockRecord && (
                        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-medium text-green-800">
                            <Shield className="h-3.5 w-3.5" />
                            Period locked
                          </div>
                          <p className="text-green-700">
                            Locked on {new Date(period.lockRecord.locked_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {period.lockRecord.lock_hash && (
                            <p className="text-green-600 font-mono text-[10px] truncate">
                              Hash: {period.lockRecord.lock_hash.substring(0, 24)}…
                            </p>
                          )}
                        </div>
                      )}

                      {/* Marketplaces */}
                      <div className="flex flex-wrap gap-1">
                        {period.marketplaces.map(m => (
                          <Badge key={m} variant="secondary" className="text-[10px]">
                            {m.replace(/_/g, ' ')}
                          </Badge>
                        ))}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        {!period.isLocked ? (
                          <Button
                            size="sm"
                            onClick={() => handleLock(period)}
                            disabled={lockingMonth === period.month || (checks ? !allChecksPassed(period.month) : true)}
                            className="gap-1.5"
                          >
                            {lockingMonth === period.month ? (
                              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Locking…</>
                            ) : (
                              <><Lock className="h-3.5 w-3.5" /> Lock {period.label}</>
                            )}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setUnlockTarget(period)}
                            className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
                          >
                            <Unlock className="h-3.5 w-3.5" /> Unlock (with reason)
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleExportAuditPack(period)}
                          disabled={exporting === period.month}
                          className="gap-1.5"
                        >
                          {exporting === period.month ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
                          ) : (
                            <><Download className="h-3.5 w-3.5" /> Export Audit Pack</>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Unlock confirmation modal */}
      {unlockTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setUnlockTarget(null)}>
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Unlock className="h-5 w-5 text-amber-600" />
              Unlock {unlockTarget.label}?
            </h3>
            <p className="text-sm text-muted-foreground">
              Unlocking a closed period allows modifications (pushes, reposts). 
              A reason is required and will be recorded in the audit trail.
            </p>
            <div>
              <label className="text-sm font-medium">
                Reason for unlock <span className="text-destructive">*</span>
              </label>
              <Textarea
                placeholder="e.g. Accountant requested correction to fee categorisation…"
                value={unlockReason}
                onChange={e => setUnlockReason(e.target.value)}
                className="mt-1.5 text-sm"
                rows={3}
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
              This action is recorded. Re-lock the period after making corrections.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setUnlockTarget(null); setUnlockReason(''); }}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleUnlock}
                disabled={!unlockReason.trim() || unlocking}
                className="gap-1.5"
              >
                {unlocking ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Unlocking…</>
                ) : (
                  <><Unlock className="h-3.5 w-3.5" /> Unlock Period</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function getNextMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  const d = new Date(y, m, 1); // m is already 0-indexed +1, so this gives next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
