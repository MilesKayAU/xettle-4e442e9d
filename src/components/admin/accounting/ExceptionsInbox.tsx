import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, XCircle, RefreshCw, Eye, CheckCircle2, Loader2, Clock, Check, BellOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MARKETPLACE_CONTACTS } from '@/constants/marketplace-contacts';

export interface AccountingException {
  id: string;
  settlement_id: string;
  marketplace: string;
  error_type: string;
  error_detail: string;
  severity: 'error' | 'warning';
  source: 'posting_state' | 'system_event' | 'contact_mapping';
  created_at: string;
  xero_invoice_id?: string | null;
  /** Number of duplicate occurrences collapsed into this entry */
  occurrence_count: number;
  /** Latest occurrence timestamp (may differ from created_at when deduped) */
  latest_at: string;
  /** Current posting_state from settlements table */
  posting_state?: string | null;
  /** Whether resolved/snoozed */
  status: 'active' | 'resolved' | 'snoozed';
  snoozed_until?: string | null;
}

// ── Severity classification ──
// Errors BLOCK posting. Warnings need review but don't block.
const SEVERITY_MAP: Record<string, 'error' | 'warning'> = {
  missing_contact: 'error',          // server hard-blocks missing mappings
  xero_attachment_failed: 'error',
  duplicate_blocked: 'error',
  push_failed: 'error',
  push_failed_permanent: 'error',
  xero_push_error: 'error',
  attachment_failed: 'error',
  settlement_mismatch: 'warning',
  unknown: 'warning',
};

const ERROR_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  attachment_failed: { label: 'Attachment Failed', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  missing_contact: { label: 'Missing Contact Mapping', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  duplicate_blocked: { label: 'Duplicate Blocked', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  push_failed: { label: 'Push Failed', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  push_failed_permanent: { label: 'Push Failed (Permanent)', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  settlement_mismatch: { label: 'Settlement Mismatch', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-amber-600' },
  xero_attachment_failed: { label: 'Attachment Failed', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  xero_push_error: { label: 'Push Error', icon: <XCircle className="h-4 w-4" />, color: 'text-destructive' },
  unknown: { label: 'Unknown Error', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-muted-foreground' },
};

function classifyPostingError(posting_state: string | null, posting_error: string | null): string {
  if (posting_state === 'failed' && posting_error?.includes('attachment')) return 'attachment_failed';
  if (posting_state === 'failed' && posting_error?.includes('duplicate')) return 'duplicate_blocked';
  if (posting_state === 'failed') return 'push_failed';
  if (posting_state === 'push_failed_permanent') return 'push_failed_permanent';
  return 'unknown';
}

function getMarketplaceLabel(code: string | null): string {
  if (!code) return 'Unknown';
  return MARKETPLACE_CONTACTS[code] || code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getErrorMeta(type: string) {
  return ERROR_TYPE_LABELS[type] || ERROR_TYPE_LABELS.unknown;
}

export default function ExceptionsInbox() {
  const [exceptions, setExceptions] = useState<AccountingException[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Batch all queries in parallel — no N+1
      const [settlementsRes, eventsRes, unmappedRes, matchesRes, resolvedEventsRes] = await Promise.all([
        // 1. Settlements with posting failures
        supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, posting_state, posting_error, xero_invoice_id, created_at, status')
          .eq('user_id', user.id)
          .eq('is_hidden', false)
          .in('posting_state', ['failed', 'push_failed_permanent'])
          .order('created_at', { ascending: false })
          .limit(100),

        // 2. System events with error types
        supabase
          .from('system_events')
          .select('id, settlement_id, event_type, details, marketplace_code, created_at, severity')
          .eq('user_id', user.id)
          .in('event_type', ['xero_attachment_failed', 'xero_push_error', 'missing_contact_mapping', 'duplicate_invoice_blocked'])
          .order('created_at', { ascending: false })
          .limit(200),

        // 3. Settlements without contact mapping (proactive)
        supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, created_at, status')
          .eq('user_id', user.id)
          .eq('is_hidden', false)
          .is('duplicate_of_settlement_id', null)
          .eq('is_pre_boundary', false)
          .in('status', ['ingested', 'ready_to_push'])
          .not('marketplace', 'in', `(${Object.keys(MARKETPLACE_CONTACTS).join(',')})`)
          .not('marketplace', 'is', null)
          .order('created_at', { ascending: false })
          .limit(50),

        // 4. Pre-fetch xero_accounting_matches for duplicate guard on retry
        supabase
          .from('xero_accounting_matches')
          .select('settlement_id, xero_invoice_id, xero_status')
          .eq('user_id', user.id)
          .limit(500),

        // 5. Resolved/snoozed exceptions (from system_events)
        supabase
          .from('system_events')
          .select('id, settlement_id, event_type, details')
          .eq('user_id', user.id)
          .in('event_type', ['exception_resolved', 'exception_snoozed'])
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      const failedSettlements = settlementsRes.data || [];
      const errorEvents = eventsRes.data || [];
      const unmappedSettlements = unmappedRes.data || [];
      const xeroMatches = matchesRes.data || [];
      const resolvedEvents = resolvedEventsRes.data || [];

      // Build resolved/snoozed lookup: key = settlement_id:error_type
      const resolvedKeys = new Set<string>();
      const snoozedMap = new Map<string, string>(); // key -> snoozed_until
      resolvedEvents.forEach(e => {
        const details = e.details as Record<string, unknown> | null;
        const key = `${e.settlement_id}:${details?.error_type || ''}`;
        if (e.event_type === 'exception_resolved') {
          resolvedKeys.add(key);
        } else if (e.event_type === 'exception_snoozed') {
          const until = details?.snoozed_until as string;
          if (until && new Date(until) > new Date()) {
            snoozedMap.set(key, until);
          }
        }
      });

      // Build xero match lookup for duplicate guard
      const activeInvoiceBySettlement = new Map<string, string>();
      xeroMatches.forEach(m => {
        if (m.xero_status !== 'VOIDED' && m.xero_invoice_id) {
          activeInvoiceBySettlement.set(m.settlement_id, m.xero_invoice_id);
        }
      });

      const results: AccountingException[] = [];

      // Process posting failures
      failedSettlements.forEach(s => {
        const errorType = classifyPostingError(s.posting_state, s.posting_error);
        results.push({
          id: `posting-${s.id}`,
          settlement_id: s.settlement_id,
          marketplace: s.marketplace || 'unknown',
          error_type: errorType,
          error_detail: s.posting_error || 'Push to accounting failed',
          severity: SEVERITY_MAP[errorType] || 'error',
          source: 'posting_state',
          created_at: s.created_at,
          latest_at: s.created_at,
          occurrence_count: 1,
          xero_invoice_id: s.xero_invoice_id || activeInvoiceBySettlement.get(s.settlement_id) || null,
          posting_state: s.posting_state,
          status: 'active',
        });
      });

      // Process system events
      errorEvents.forEach(e => {
        const details = e.details as Record<string, unknown> | null;
        let errorType = e.event_type;
        if (errorType === 'missing_contact_mapping') errorType = 'missing_contact';
        if (errorType === 'duplicate_invoice_blocked') errorType = 'duplicate_blocked';

        results.push({
          id: `event-${e.id}`,
          settlement_id: e.settlement_id || 'N/A',
          marketplace: e.marketplace_code || 'unknown',
          error_type: errorType,
          error_detail: (details?.message as string) || (details?.error as string) || e.event_type.replace(/_/g, ' '),
          severity: SEVERITY_MAP[errorType] || 'warning',
          source: 'system_event',
          created_at: e.created_at || new Date().toISOString(),
          latest_at: e.created_at || new Date().toISOString(),
          occurrence_count: 1,
          status: 'active',
        });
      });

      // Process unmapped contact settlements
      unmappedSettlements.forEach(s => {
        results.push({
          id: `contact-${s.id}`,
          settlement_id: s.settlement_id,
          marketplace: s.marketplace || 'unknown',
          error_type: 'missing_contact',
          error_detail: `No Xero contact mapped for marketplace "${s.marketplace}"`,
          severity: 'error', // Blocks posting — classified as error
          source: 'contact_mapping',
          created_at: s.created_at,
          latest_at: s.created_at,
          occurrence_count: 1,
          status: 'active',
        });
      });

      // Deduplicate by settlement_id + error_type, keeping occurrence count and latest timestamp
      const grouped = new Map<string, AccountingException>();
      results.forEach(r => {
        const key = `${r.settlement_id}:${r.error_type}`;

        // Check resolved/snoozed status
        if (resolvedKeys.has(key)) {
          r.status = 'resolved';
        } else if (snoozedMap.has(key)) {
          r.status = 'snoozed';
          r.snoozed_until = snoozedMap.get(key);
        }

        const existing = grouped.get(key);
        if (existing) {
          existing.occurrence_count += 1;
          if (new Date(r.created_at) > new Date(existing.latest_at)) {
            existing.latest_at = r.created_at;
            existing.error_detail = r.error_detail;
          }
          // Preserve xero_invoice_id if found
          if (r.xero_invoice_id && !existing.xero_invoice_id) {
            existing.xero_invoice_id = r.xero_invoice_id;
          }
        } else {
          grouped.set(key, { ...r });
        }
      });

      const deduped = Array.from(grouped.values());

      // Sort: errors first, then by date
      deduped.sort((a, b) => {
        // Active first, then snoozed, then resolved
        const statusOrder = { active: 0, snoozed: 1, resolved: 2 };
        if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime();
      });

      setExceptions(deduped);
    } catch (err) {
      console.error('Failed to fetch exceptions:', err);
      toast.error('Failed to load exceptions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExceptions();
  }, [fetchExceptions]);

  const handleRetryPush = async (exception: AccountingException) => {
    // Guard 1: Block if currently posting/queued
    if (exception.posting_state === 'posting' || exception.posting_state === 'queued') {
      toast.error('Settlement is currently being posted — cannot retry');
      return;
    }

    // Guard 2: Block if a non-VOIDED invoice already exists
    if (exception.xero_invoice_id) {
      toast.error('An active invoice already exists for this settlement. Use Safe Repost to void and recreate.');
      return;
    }

    setRetrying(exception.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Reset posting_state so settlement becomes eligible for PushSafetyPreview
      const { error } = await supabase
        .from('settlements')
        .update({ posting_state: null, posting_error: null })
        .eq('settlement_id', exception.settlement_id)
        .eq('user_id', user.id);

      if (error) throw error;

      // Record audit event for traceability
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'posting_retry_requested',
        settlement_id: exception.settlement_id,
        marketplace_code: exception.marketplace,
        severity: 'info',
        details: {
          original_error_type: exception.error_type,
          original_error: exception.error_detail,
          retried_at: new Date().toISOString(),
        },
      });

      toast.success(`Settlement ${exception.settlement_id} reset — retry via Push Safety Preview`);
      await fetchExceptions();
    } catch (err) {
      toast.error('Failed to reset settlement for retry');
    } finally {
      setRetrying(null);
    }
  };

  const handleResolve = async (exception: AccountingException) => {
    setActionLoading(exception.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'exception_resolved',
        settlement_id: exception.settlement_id,
        marketplace_code: exception.marketplace,
        severity: 'info',
        details: {
          error_type: exception.error_type,
          resolved_at: new Date().toISOString(),
        },
      });

      toast.success('Exception resolved');
      await fetchExceptions();
    } catch {
      toast.error('Failed to resolve exception');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSnooze = async (exception: AccountingException) => {
    setActionLoading(exception.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const snoozedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'exception_snoozed',
        settlement_id: exception.settlement_id,
        marketplace_code: exception.marketplace,
        severity: 'info',
        details: {
          error_type: exception.error_type,
          snoozed_until: snoozedUntil,
        },
      });

      toast.success('Exception snoozed for 7 days');
      await fetchExceptions();
    } catch {
      toast.error('Failed to snooze exception');
    } finally {
      setActionLoading(null);
    }
  };

  const activeExceptions = exceptions.filter(e => e.status === 'active');
  const resolvedExceptions = exceptions.filter(e => e.status === 'resolved' || e.status === 'snoozed');
  const displayedExceptions = showResolved ? exceptions : activeExceptions;
  const errorCount = activeExceptions.filter(e => e.severity === 'error').length;
  const warningCount = activeExceptions.filter(e => e.severity === 'warning').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Exceptions Inbox
              {activeExceptions.length > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                  {activeExceptions.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Settlement posting errors, missing mappings, and blocked pushes requiring attention
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {errorCount} error{errorCount !== 1 ? 's' : ''}
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                {warningCount} warning{warningCount !== 1 ? 's' : ''}
              </Badge>
            )}
            {resolvedExceptions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setShowResolved(!showResolved)}
              >
                {showResolved ? 'Hide resolved' : `+${resolvedExceptions.length} resolved`}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={fetchExceptions} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading exceptions…
          </div>
        ) : displayedExceptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
            <p className="text-sm font-medium">No exceptions</p>
            <p className="text-xs">All settlements are clean — no errors or missing mappings detected.</p>
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Settlement</TableHead>
                  <TableHead className="w-[140px]">Marketplace</TableHead>
                  <TableHead className="w-[160px]">Error</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="w-[100px]">When</TableHead>
                  <TableHead className="w-[140px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedExceptions.map(exc => {
                  const meta = getErrorMeta(exc.error_type);
                  const isInactive = exc.status !== 'active';
                  const isRetryable = !isInactive &&
                    (exc.error_type === 'attachment_failed' || exc.error_type === 'xero_attachment_failed' || exc.error_type === 'push_failed');
                  const retryDisabled = retrying === exc.id ||
                    exc.posting_state === 'posting' || exc.posting_state === 'queued' ||
                    !!exc.xero_invoice_id;
                  const hasStableInvoice = !!exc.xero_invoice_id;

                  return (
                    <TableRow key={exc.id} className={
                      isInactive ? 'opacity-50' :
                      exc.severity === 'error' ? 'bg-destructive/5' : ''
                    }>
                      <TableCell className="font-mono text-xs">{exc.settlement_id}</TableCell>
                      <TableCell className="text-xs">{getMarketplaceLabel(exc.marketplace)}</TableCell>
                      <TableCell>
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${meta.color}`}>
                          {meta.icon}
                          {meta.label}
                          {exc.occurrence_count > 1 && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">
                              ×{exc.occurrence_count}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                        {exc.error_detail}
                        {exc.status === 'snoozed' && exc.snoozed_until && (
                          <span className="ml-1 text-muted-foreground/60">
                            (snoozed until {new Date(exc.snoozed_until).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(exc.latest_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {isRetryable && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={retryDisabled}
                            title={
                              exc.xero_invoice_id ? 'Active invoice exists — use Safe Repost' :
                              exc.posting_state === 'posting' ? 'Currently posting' : 'Reset for retry'
                            }
                            onClick={() => handleRetryPush(exc)}
                          >
                            {retrying === exc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                            Retry
                          </Button>
                        )}
                        {exc.error_type === 'missing_contact' && !isInactive && (
                          <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">Fix mapping</Badge>
                        )}
                        {exc.error_type === 'duplicate_blocked' && hasStableInvoice && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs">
                            <Eye className="h-3 w-3 mr-1" /> View
                          </Button>
                        )}
                        {!isInactive && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-1.5"
                              disabled={actionLoading === exc.id}
                              title="Mark as resolved"
                              onClick={() => handleResolve(exc)}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-1.5"
                              disabled={actionLoading === exc.id}
                              title="Snooze for 7 days"
                              onClick={() => handleSnooze(exc)}
                            >
                              <BellOff className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {isInactive && (
                          <Badge variant="outline" className="text-[9px]">
                            {exc.status === 'resolved' ? 'Resolved' : 'Snoozed'}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { ExceptionsInbox };
