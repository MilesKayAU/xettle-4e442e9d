import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { Mail, Send, AlertTriangle, Ban, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

interface EmailLogRow {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  metadata: any;
  created_at: string;
}

type TimeRange = '24h' | '7d' | '30d';

const STATUS_COLORS: Record<string, string> = {
  sent: 'bg-green-500/15 text-green-700 border-green-500/20',
  failed: 'bg-destructive/15 text-destructive border-destructive/20',
  dlq: 'bg-destructive/15 text-destructive border-destructive/20',
  bounced: 'bg-destructive/15 text-destructive border-destructive/20',
  complained: 'bg-orange-500/15 text-orange-700 border-orange-500/20',
  suppressed: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/20',
  pending: 'bg-muted text-muted-foreground border-border',
};

function getTimeRangeStart(range: TimeRange): string {
  const now = new Date();
  switch (range) {
    case '24h': now.setHours(now.getHours() - 24); break;
    case '7d': now.setDate(now.getDate() - 7); break;
    case '30d': now.setDate(now.getDate() - 30); break;
  }
  return now.toISOString();
}

function deduplicateByMessageId(rows: EmailLogRow[]): EmailLogRow[] {
  const map = new Map<string, EmailLogRow>();
  for (const row of rows) {
    const key = row.message_id || row.id;
    const existing = map.get(key);
    if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
      map.set(key, row);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

const PAGE_SIZE = 50;

export default function EmailMonitoringDashboard() {
  const [rawRows, setRawRows] = useState<EmailLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [templateFilter, setTemplateFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const start = getTimeRangeStart(timeRange);
      const { data, error } = await supabase.functions.invoke('admin-email-log', {
        body: { start_date: start },
      });
      if (error) throw error;
      setRawRows(data?.rows || []);
    } catch {
      setRawRows([]);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const deduplicated = useMemo(() => deduplicateByMessageId(rawRows), [rawRows]);

  const templateNames = useMemo(() => {
    const names = new Set(deduplicated.map(r => r.template_name));
    return Array.from(names).sort();
  }, [deduplicated]);

  const filtered = useMemo(() => {
    return deduplicated.filter(row => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (templateFilter !== 'all' && row.template_name !== templateFilter) return false;
      return true;
    });
  }, [deduplicated, statusFilter, templateFilter]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const sent = filtered.filter(r => r.status === 'sent').length;
    const failed = filtered.filter(r => ['failed', 'dlq', 'bounced'].includes(r.status)).length;
    const suppressed = filtered.filter(r => r.status === 'suppressed').length;
    return { total, sent, failed, suppressed };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [statusFilter, templateFilter, timeRange]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['24h', '7d', '30d'] as TimeRange[]).map(r => (
            <Button
              key={r}
              variant={timeRange === r ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTimeRange(r)}
            >
              {r === '24h' ? 'Last 24h' : r === '7d' ? 'Last 7 days' : 'Last 30 days'}
            </Button>
          ))}
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="dlq">DLQ</SelectItem>
            <SelectItem value="suppressed">Suppressed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>

        <Select value={templateFilter} onValueChange={setTemplateFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Template" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All templates</SelectItem>
            {templateNames.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={fetchEmails} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Total
            </CardDescription>
            <CardTitle className="text-3xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-green-600" /> Sent
            </CardDescription>
            <CardTitle className="text-3xl text-green-600">{stats.sent}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> Failed
            </CardDescription>
            <CardTitle className="text-3xl text-destructive">{stats.failed}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Ban className="h-3.5 w-3.5 text-yellow-600" /> Suppressed
            </CardDescription>
            <CardTitle className="text-3xl text-yellow-600">{stats.suppressed}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Log Table */}
      <Card>
        <CardHeader>
          <CardTitle>Email Log</CardTitle>
          <CardDescription>
            {filtered.length} unique email{filtered.length !== 1 ? 's' : ''} (deduplicated by message ID)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="md" text="Loading email logs..." />
            </div>
          ) : pagedRows.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No emails found for this period</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRows.map(row => (
                    <TableRow key={row.message_id || row.id}>
                      <TableCell className="font-mono text-xs">{row.template_name}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{row.recipient_email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[row.status] || ''}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-[250px] truncate text-xs text-destructive">
                        {row.error_message || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
