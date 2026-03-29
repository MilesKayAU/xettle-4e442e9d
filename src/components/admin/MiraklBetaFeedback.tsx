import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface IssueReport {
  id: string;
  marketplace_label: string;
  base_url: string | null;
  error_message: string | null;
  event_log: any;
  resolved: boolean;
  created_at: string;
}

export default function MiraklBetaFeedback() {
  const [reports, setReports] = useState<IssueReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadReports = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('mirakl_issue_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setReports(data as IssueReport[]);
    setLoading(false);
  };

  useEffect(() => { loadReports(); }, []);

  const toggleResolved = async (id: string, current: boolean) => {
    setToggling(id);
    const { error } = await supabase
      .from('mirakl_issue_reports')
      .update({ resolved: !current })
      .eq('id', id);
    if (error) {
      toast.error('Failed to update status');
    } else {
      setReports(prev => prev.map(r => r.id === id ? { ...r, resolved: !current } : r));
    }
    setToggling(null);
  };

  const filtered = showResolved ? reports : reports.filter(r => !r.resolved);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Mirakl Beta Feedback
            </CardTitle>
            <CardDescription className="text-xs">
              Issue reports from beta marketplace users (JB Hi-Fi, Baby Bunting)
            </CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            <Badge variant="outline" className="text-xs">
              {reports.filter(r => !r.resolved).length} open
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setShowResolved(!showResolved)} className="text-xs">
              {showResolved ? 'Hide Resolved' : 'Show All'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No issue reports yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Marketplace</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Reported</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{r.marketplace_label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs max-w-[300px] truncate" title={r.error_message || ''}>
                    {r.error_message || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {r.resolved ? (
                      <Badge className="bg-primary/10 text-primary text-[10px] gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Resolved
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 text-[10px] gap-1">
                        <Clock className="h-2.5 w-2.5" /> Open
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      disabled={toggling === r.id}
                      onClick={() => toggleResolved(r.id, r.resolved)}
                    >
                      {toggling === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : r.resolved ? 'Reopen' : 'Resolve'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
