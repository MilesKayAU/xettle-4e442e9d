import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, XCircle, RefreshCw, Eye, CheckCircle2, Loader2, Inbox } from 'lucide-react';
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
  /** If a Xero invoice exists, link to it */
  xero_invoice_id?: string | null;
}

const ERROR_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  attachment_failed: { label: 'Attachment Failed', icon: <XCircle className="h-4 w-4" />, color: 'text-red-600' },
  missing_contact: { label: 'Missing Contact Mapping', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-amber-600' },
  duplicate_blocked: { label: 'Duplicate Blocked', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-amber-600' },
  push_failed: { label: 'Push Failed', icon: <XCircle className="h-4 w-4" />, color: 'text-red-600' },
  push_failed_permanent: { label: 'Push Failed (Permanent)', icon: <XCircle className="h-4 w-4" />, color: 'text-red-700' },
  settlement_mismatch: { label: 'Settlement Mismatch', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-amber-600' },
  xero_attachment_failed: { label: 'Attachment Failed', icon: <XCircle className="h-4 w-4" />, color: 'text-red-600' },
  xero_push_error: { label: 'Push Error', icon: <XCircle className="h-4 w-4" />, color: 'text-red-600' },
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

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Settlements with posting failures
      const { data: failedSettlements } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, posting_state, posting_error, xero_invoice_id, created_at, status')
        .eq('user_id', user.id)
        .eq('is_hidden', false)
        .in('posting_state', ['failed', 'push_failed_permanent'])
        .order('created_at', { ascending: false })
        .limit(100);

      // 2. System events with error types
      const { data: errorEvents } = await supabase
        .from('system_events')
        .select('id, settlement_id, event_type, details, marketplace_code, created_at, severity')
        .eq('user_id', user.id)
        .in('event_type', ['xero_attachment_failed', 'xero_push_error', 'missing_contact_mapping', 'duplicate_invoice_blocked'])
        .order('created_at', { ascending: false })
        .limit(100);

      // 3. Settlements without contact mapping (proactive check)
      const mappedMarketplaces = Object.keys(MARKETPLACE_CONTACTS);
      const { data: unmappedSettlements } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, created_at, status')
        .eq('user_id', user.id)
        .eq('is_hidden', false)
        .is('duplicate_of_settlement_id', null)
        .eq('is_pre_boundary', false)
        .in('status', ['ingested', 'ready_to_push'])
        .not('marketplace', 'in', `(${mappedMarketplaces.join(',')})`)
        .not('marketplace', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      const results: AccountingException[] = [];

      // Process posting failures
      (failedSettlements || []).forEach(s => {
        const errorType = classifyPostingError(s.posting_state, s.posting_error);
        results.push({
          id: `posting-${s.id}`,
          settlement_id: s.settlement_id,
          marketplace: s.marketplace || 'unknown',
          error_type: errorType,
          error_detail: s.posting_error || 'Push to accounting failed',
          severity: errorType === 'push_failed_permanent' ? 'error' : 'warning',
          source: 'posting_state',
          created_at: s.created_at,
          xero_invoice_id: s.xero_invoice_id,
        });
      });

      // Process system events
      (errorEvents || []).forEach(e => {
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
          severity: e.severity === 'critical' ? 'error' : 'warning',
          source: 'system_event',
          created_at: e.created_at || new Date().toISOString(),
        });
      });

      // Process unmapped contact settlements
      (unmappedSettlements || []).forEach(s => {
        results.push({
          id: `contact-${s.id}`,
          settlement_id: s.settlement_id,
          marketplace: s.marketplace || 'unknown',
          error_type: 'missing_contact',
          error_detail: `No Xero contact mapped for marketplace "${s.marketplace}"`,
          severity: 'warning',
          source: 'contact_mapping',
          created_at: s.created_at,
        });
      });

      // Deduplicate by settlement_id + error_type
      const seen = new Set<string>();
      const deduped = results.filter(r => {
        const key = `${r.settlement_id}:${r.error_type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Sort errors first, then by date
      deduped.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
    setRetrying(exception.id);
    try {
      // Reset posting_state so it can be retried via PushSafetyPreview
      const { error } = await supabase
        .from('settlements')
        .update({ posting_state: null, posting_error: null })
        .eq('settlement_id', exception.settlement_id);

      if (error) throw error;
      toast.success(`Settlement ${exception.settlement_id} reset — you can now retry via Push Safety Preview`);
      await fetchExceptions();
    } catch (err) {
      toast.error('Failed to reset settlement for retry');
    } finally {
      setRetrying(null);
    }
  };

  const errorCount = exceptions.filter(e => e.severity === 'error').length;
  const warningCount = exceptions.filter(e => e.severity === 'warning').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Exceptions Inbox
              {exceptions.length > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">
                  {exceptions.length}
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
        ) : exceptions.length === 0 ? (
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
                  <TableHead className="w-[100px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.map(exc => {
                  const meta = getErrorMeta(exc.error_type);
                  return (
                    <TableRow key={exc.id} className={exc.severity === 'error' ? 'bg-red-50/50' : ''}>
                      <TableCell className="font-mono text-xs">{exc.settlement_id}</TableCell>
                      <TableCell className="text-xs">{getMarketplaceLabel(exc.marketplace)}</TableCell>
                      <TableCell>
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${meta.color}`}>
                          {meta.icon}
                          {meta.label}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                        {exc.error_detail}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(exc.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                      </TableCell>
                      <TableCell className="text-right">
                        {(exc.error_type === 'attachment_failed' || exc.error_type === 'xero_attachment_failed' || exc.error_type === 'push_failed') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={retrying === exc.id}
                            onClick={() => handleRetryPush(exc)}
                          >
                            {retrying === exc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                            Retry
                          </Button>
                        )}
                        {exc.error_type === 'missing_contact' && (
                          <Badge variant="outline" className="text-[10px]">Fix mapping</Badge>
                        )}
                        {exc.error_type === 'duplicate_blocked' && exc.xero_invoice_id && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs">
                            <Eye className="h-3 w-3 mr-1" /> View
                          </Button>
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
