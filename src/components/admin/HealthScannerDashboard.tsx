import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { scanPage, formatScanForAI } from '@/utils/page-scanner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { RefreshCw, ScanSearch, CheckCircle, AlertTriangle, XCircle, Eye, EyeOff, ClipboardCopy } from 'lucide-react';
import { format } from 'date-fns';

interface HealthIssue {
  fingerprint: string;
  message: string;
  source: string;
  page: string;
  severity: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  status: 'open' | 'resolved' | 'ignored';
}

export default function HealthScannerDashboard() {
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved' | 'ignored'>('open');

  const loadIssues = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_events')
        .select('*')
        .in('event_type', ['client_error', 'health_scan_result'])
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;

      // Group by fingerprint
      const grouped = new Map<string, HealthIssue>();

      for (const row of data || []) {
        const details = row.details as Record<string, any> || {};
        const fp = details.fingerprint || details.message?.slice(0, 40) || row.id;
        const status = details.status || 'open';

        if (grouped.has(fp)) {
          const existing = grouped.get(fp)!;
          existing.occurrence_count += 1;
          if (row.created_at && row.created_at > existing.last_seen) {
            existing.last_seen = row.created_at;
          }
          if (row.created_at && row.created_at < existing.first_seen) {
            existing.first_seen = row.created_at;
          }
          // If any occurrence is marked resolved/ignored, use that
          if (status === 'resolved' || status === 'ignored') {
            existing.status = status;
          }
        } else {
          grouped.set(fp, {
            fingerprint: fp,
            message: details.message || row.event_type,
            source: details.source || 'unknown',
            page: details.page || '/',
            severity: row.severity || 'error',
            first_seen: row.created_at || new Date().toISOString(),
            last_seen: row.created_at || new Date().toISOString(),
            occurrence_count: 1,
            status: status as 'open' | 'resolved' | 'ignored',
          });
        }
      }

      setIssues(Array.from(grouped.values()).sort((a, b) =>
        new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
      ));
    } catch (err: any) {
      toast({ title: 'Failed to load issues', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadIssues(); }, [loadIssues]);

  const runScan = async () => {
    setScanning(true);
    try {
      const result = scanPage();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const issuesFound: Array<{ message: string; source: string; fingerprint: string }> = [];

      // Broken links
      result.links.filter(l => l.isBroken).forEach(l => {
        const fp = simpleHash(`broken_link|${l.href}`);
        issuesFound.push({ message: `Broken link: "${l.text}" → ${l.href}`, source: 'link_scan', fingerprint: fp });
      });

      // Console errors
      result.consoleErrors.forEach(e => {
        const fp = simpleHash(`console|${e.slice(0, 80)}`);
        issuesFound.push({ message: e, source: 'console', fingerprint: fp });
      });

      // Accessibility issues
      result.accessibilityIssues.forEach(a => {
        const fp = simpleHash(`a11y|${a}`);
        issuesFound.push({ message: a, source: 'accessibility', fingerprint: fp });
      });

      // Suspicious text
      result.suspiciousText.forEach(t => {
        const fp = simpleHash(`suspicious|${t.slice(0, 80)}`);
        issuesFound.push({ message: `Suspicious text: ${t}`, source: 'content_scan', fingerprint: fp });
      });

      // Store each issue as a health_scan_result
      if (issuesFound.length > 0) {
        const rows = issuesFound.map(issue => ({
          user_id: user.id,
          event_type: 'health_scan_result' as string,
          severity: 'warning' as string,
          details: {
            message: issue.message,
            source: issue.source,
            fingerprint: issue.fingerprint,
            page: result.url,
            status: 'open',
            scan_timestamp: result.timestamp,
          },
        }));
        await supabase.from('system_events').insert(rows);
      }

      // Auto-resolve: find previous scan issues not in current scan
      const currentFingerprints = new Set(issuesFound.map(i => i.fingerprint));
      const previousOpen = issues.filter(i => i.status === 'open');
      const toResolve = previousOpen.filter(i => !currentFingerprints.has(i.fingerprint));

      if (toResolve.length > 0) {
        // Mark resolved by inserting a resolved event
        const resolvedRows = toResolve.map(i => ({
          user_id: user.id,
          event_type: 'health_scan_result' as string,
          severity: 'info' as string,
          details: {
            message: i.message,
            source: i.source,
            fingerprint: i.fingerprint,
            page: i.page,
            status: 'resolved',
            resolved_by: 'auto_scan',
            scan_timestamp: result.timestamp,
          },
        }));
        await supabase.from('system_events').insert(resolvedRows);
      }

      toast({
        title: 'Scan Complete',
        description: `Found ${issuesFound.length} issue(s). ${toResolve.length} resolved.`,
      });

      await loadIssues();
    } catch (err: any) {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  const markStatus = async (fingerprint: string, status: 'resolved' | 'ignored') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'health_scan_result',
        severity: 'info',
        details: {
          fingerprint,
          status,
          resolved_by: 'manual',
          resolved_at: new Date().toISOString(),
        },
      });

      setIssues(prev => prev.map(i =>
        i.fingerprint === fingerprint ? { ...i, status } : i
      ));

      toast({ title: status === 'resolved' ? 'Marked resolved' : 'Marked ignored' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const filtered = issues.filter(i => filter === 'all' || i.status === filter);
  const openCount = issues.filter(i => i.status === 'open').length;
  const resolvedCount = issues.filter(i => i.status === 'resolved').length;

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open Issues</CardDescription>
            <CardTitle className="text-3xl text-destructive">{openCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Resolved</CardDescription>
            <CardTitle className="text-3xl text-green-600">{resolvedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tracked</CardDescription>
            <CardTitle className="text-3xl">{issues.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="flex items-center justify-center">
          <CardContent className="pt-6 flex gap-2">
            <Button onClick={runScan} disabled={scanning} className="gap-2">
              {scanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {scanning ? 'Scanning...' : 'Run Scan'}
            </Button>
            <Button variant="outline" onClick={loadIssues} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
        <TabsList>
          <TabsTrigger value="open" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Open ({openCount})
          </TabsTrigger>
          <TabsTrigger value="resolved" className="gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" />
            Resolved ({resolvedCount})
          </TabsTrigger>
          <TabsTrigger value="ignored" className="gap-1.5">
            <EyeOff className="h-3.5 w-3.5" />
            Ignored
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            All
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Issues table */}
      <Card>
        <CardHeader>
          <CardTitle>Health Issues</CardTitle>
          <CardDescription>
            Client errors and scan results grouped by fingerprint. Issues auto-resolve when a new scan no longer detects them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="md" text="Loading issues..." />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {filter === 'open' ? '🎉 No open issues!' : 'No issues found.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>First Seen</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 100).map((issue) => (
                  <TableRow key={issue.fingerprint}>
                    <TableCell>
                      <Badge variant={issue.severity === 'error' ? 'destructive' : 'secondary'}>
                        {issue.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate font-mono text-xs">
                      {issue.message}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{issue.source}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{issue.page}</TableCell>
                    <TableCell>{issue.occurrence_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(issue.first_seen), 'MMM d, HH:mm')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(issue.last_seen), 'MMM d, HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={issue.status === 'open' ? 'destructive' : issue.status === 'resolved' ? 'default' : 'secondary'}>
                        {issue.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {issue.status === 'open' && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Mark resolved" onClick={() => markStatus(issue.fingerprint, 'resolved')}>
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Ignore" onClick={() => markStatus(issue.fingerprint, 'ignored')}>
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Simple hash matching global-error-capture */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 16).padEnd(8, '0');
}
