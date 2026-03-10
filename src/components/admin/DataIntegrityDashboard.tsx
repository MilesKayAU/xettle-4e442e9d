import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShieldAlert, Database, GitBranch, AlertTriangle } from 'lucide-react';
import LoadingSpinner from '@/components/ui/loading-spinner';

interface SuppressedSettlement {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  source: string;
  created_at: string;
}

interface SourceBreakdown {
  source: string;
  count: number;
}

interface DriftEvent {
  id: string;
  created_at: string;
  details: any;
}

export default function DataIntegrityDashboard() {
  const [loading, setLoading] = useState(true);
  const [suppressed, setSuppressed] = useState<SuppressedSettlement[]>([]);
  const [sourceBreakdown, setSourceBreakdown] = useState<SourceBreakdown[]>([]);
  const [driftEvents, setDriftEvents] = useState<DriftEvent[]>([]);
  const [aliasCount, setAliasCount] = useState(0);

  const loadData = async () => {
    setLoading(true);
    try {
      const [suppRes, allRes, driftRes, aliasRes] = await Promise.all([
        supabase.from('settlements')
          .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, source, created_at')
          .eq('status', 'duplicate_suppressed' as any)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('settlements')
          .select('source')
          .limit(1000),
        supabase.from('system_events' as any)
          .select('id, created_at, details')
          .in('event_type', ['parser_version_drift', 'duplicate_detected', 'duplicate_blocked'])
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('settlement_id_aliases' as any)
          .select('id')
          .limit(1000),
      ]);

      setSuppressed((suppRes.data as any) || []);

      // Compute source breakdown
      const counts: Record<string, number> = {};
      for (const row of (allRes.data || [])) {
        const src = (row as any).source || 'unknown';
        counts[src] = (counts[src] || 0) + 1;
      }
      setSourceBreakdown(Object.entries(counts).map(([source, count]) => ({ source, count })));

      setDriftEvents((driftRes.data as any) || []);
      setAliasCount((aliasRes.data as any)?.length || 0);
    } catch (err) {
      console.error('DataIntegrity load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="md" text="Loading data integrity..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" />
              Duplicates Suppressed
            </CardDescription>
            <CardTitle className="text-3xl">{suppressed.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" />
              ID Aliases Registered
            </CardDescription>
            <CardTitle className="text-3xl">{aliasCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Sources Tracked
            </CardDescription>
            <CardTitle className="text-3xl">{sourceBreakdown.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              Integrity Events
            </CardDescription>
            <CardTitle className="text-3xl">{driftEvents.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Source breakdown */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <CardTitle>Settlement Source Breakdown</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {sourceBreakdown.map((s) => (
              <Badge key={s.source} variant="secondary" className="text-sm px-3 py-1.5">
                {s.source}: <span className="font-bold ml-1">{s.count}</span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Suppressed duplicates */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <CardTitle>Suppressed Duplicates</CardTitle>
          </div>
          <CardDescription>Settlements detected as duplicates and excluded from processing</CardDescription>
        </CardHeader>
        <CardContent>
          {suppressed.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">No duplicates detected — data is clean ✓</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Settlement ID</TableHead>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressed.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.settlement_id}</TableCell>
                    <TableCell>{s.marketplace}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{s.period_start} → {s.period_end}</TableCell>
                    <TableCell>${(s.bank_deposit || 0).toFixed(2)}</TableCell>
                    <TableCell><Badge variant="outline">{s.source}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Integrity events */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <CardTitle>Integrity Events</CardTitle>
          </div>
          <CardDescription>Parser version drift, duplicate detections, and blocked inserts</CardDescription>
        </CardHeader>
        <CardContent>
          {driftEvents.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">No integrity events logged</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {driftEvents.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {JSON.stringify(e.details, null, 0)}
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
