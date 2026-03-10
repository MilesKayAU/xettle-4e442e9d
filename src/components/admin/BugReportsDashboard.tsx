import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Copy, ChevronDown, ChevronUp, RefreshCw, Plus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import LoadingSpinner from '@/components/ui/loading-spinner';

interface BugReport {
  id: string;
  created_at: string;
  submitted_by: string;
  page_url: string | null;
  description: string;
  screenshot_base64: string | null;
  console_errors: any[];
  severity: string;
  ai_summary: string | null;
  ai_classification: string | null;
  ai_lovable_prompt: string | null;
  ai_complexity: string | null;
  status: string;
  owner_notes: string | null;
  resolved_at: string | null;
  notify_submitter: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── New Marketplace Details (for First Contact reports) ────────────────────

function NewMarketplaceDetails({ data, reportId }: { data: any; reportId: string }) {
  const [adding, setAdding] = useState(false);

  let parsed: any = null;
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch { /* ignore */ }

  if (!parsed || typeof parsed !== 'object') {
    return <pre className="text-xs bg-muted p-2 rounded mt-1 max-h-32 overflow-auto font-mono">{JSON.stringify(data, null, 2)}</pre>;
  }

  const handleAddToDictionary = async () => {
    if (!parsed.headers || !parsed.marketplace) return;
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await supabase.from('marketplace_file_fingerprints').insert({
        user_id: user.id,
        marketplace_code: parsed.userMarketplace || parsed.marketplace,
        column_signature: parsed.headers as any,
        column_mapping: {} as any,
        is_multi_marketplace: false,
        file_pattern: parsed.filename || null,
      } as any);

      sonnerToast.success(`Added "${parsed.userMarketplace || parsed.marketplace}" to fingerprint dictionary`);
    } catch (err: any) {
      sonnerToast.error(err.message || 'Failed to add');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mt-1 space-y-2">
      <div className="bg-muted/50 rounded-md p-3 space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div><span className="text-muted-foreground">Filename:</span> <span className="font-medium">{parsed.filename || '—'}</span></div>
          <div><span className="text-muted-foreground">Confidence:</span> <span className="font-medium">{parsed.confidence ?? '—'}%</span></div>
          <div><span className="text-muted-foreground">Detected as:</span> <span className="font-medium">{parsed.detectedMarketplace || parsed.marketplace || '—'}</span></div>
          <div><span className="text-muted-foreground">User identified:</span> <span className="font-medium">{parsed.userMarketplace || 'Not specified'}</span></div>
          <div><span className="text-muted-foreground">User saved:</span> <span className="font-medium">{parsed.userSaved === true ? '✅ Yes' : parsed.userSaved === false ? '❌ No' : '—'}</span></div>
          <div><span className="text-muted-foreground">Tier:</span> <span className="font-medium">{parsed.confidenceTier || '—'}</span></div>
        </div>
        {parsed.headers && (
          <div>
            <span className="text-muted-foreground">Columns ({parsed.headers.length}):</span>
            <p className="font-mono text-[10px] mt-0.5 text-foreground">{parsed.headers.join(', ')}</p>
          </div>
        )}
        {parsed.sampleRows && parsed.sampleRows.length > 0 && (
          <div>
            <span className="text-muted-foreground">Sample rows ({parsed.sampleRows.length}):</span>
            <pre className="font-mono text-[10px] mt-0.5 max-h-20 overflow-auto bg-background/50 p-1.5 rounded">
              {parsed.sampleRows.map((r: string[], i: number) => `Row ${i + 1}: ${r.join(' | ')}`).join('\n')}
            </pre>
          </div>
        )}
      </div>
      {parsed.headers && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1.5"
          onClick={handleAddToDictionary}
          disabled={adding}
        >
          <Plus className="h-3 w-3" />
          {adding ? 'Adding...' : 'Add to dictionary'}
        </Button>
      )}
    </div>
  );
}

export default function BugReportsDashboard() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterComplexity, setFilterComplexity] = useState<string>('all');
  const [filterClassification, setFilterClassification] = useState<string>('all');

  const loadReports = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('bug_reports' as any)
      .select('*')
      .order('created_at', { ascending: false }) as any;

    if (!error && data) setReports(data);
    setLoading(false);
  };

  useEffect(() => { loadReports(); }, []);

  const updateReport = async (id: string, updates: Partial<BugReport>) => {
    const { error } = await supabase
      .from('bug_reports' as any)
      .update(updates as any)
      .eq('id', id) as any;
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const setStatus = (id: string, status: string) => {
    const updates: any = { status };
    if (status === 'resolved') updates.resolved_at = new Date().toISOString();
    updateReport(id, updates);
  };

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    toast({ title: 'Copied', description: 'Lovable prompt copied to clipboard' });
  };

  const filtered = reports.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterSeverity !== 'all' && r.severity !== filterSeverity) return false;
    if (filterComplexity !== 'all' && r.ai_complexity !== filterComplexity) return false;
    if (filterClassification !== 'all' && r.ai_classification !== filterClassification) return false;
    return true;
  });

  if (loading) return <LoadingSpinner size="md" text="Loading bug reports..." />;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterComplexity} onValueChange={setFilterComplexity}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Complexity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Complexity</SelectItem>
            <SelectItem value="Quick fix">Quick fix</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Complex">Complex</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterClassification} onValueChange={setFilterClassification}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Classification" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="UI bug">UI bug</SelectItem>
            <SelectItem value="Data bug">Data bug</SelectItem>
            <SelectItem value="API bug">API bug</SelectItem>
            <SelectItem value="Logic bug">Logic bug</SelectItem>
            <SelectItem value="Performance">Performance</SelectItem>
            <SelectItem value="New marketplace">New Marketplace</SelectItem>
            <SelectItem value="New marketplace saved">New Marketplace (Saved)</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={loadReports}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} report{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Reports list */}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">No bug reports found</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const isExpanded = expandedId === r.id;
            return (
              <Card key={r.id} className="overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <Badge className={SEVERITY_COLORS[r.severity] || ''} variant="secondary">
                    {r.severity}
                  </Badge>
                  {r.ai_classification && (
                    <Badge variant="outline" className="text-xs">{r.ai_classification}</Badge>
                  )}
                  {r.ai_complexity && (
                    <span className="text-xs text-muted-foreground">{r.ai_complexity}</span>
                  )}
                  <Badge className={STATUS_COLORS[r.status] || ''} variant="secondary">
                    {r.status.replace('_', ' ')}
                  </Badge>
                  <span className="text-sm truncate flex-1">{r.description.substring(0, 80)}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{r.page_url?.replace(/https?:\/\/[^/]+/, '') || ''}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(r.created_at)}</span>
                </div>

                {isExpanded && (
                  <CardContent className="border-t border-border pt-4 space-y-4">
                    {/* Description */}
                    <div>
                      <Label className="text-xs font-semibold text-muted-foreground">Description</Label>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{r.description}</p>
                    </div>

                    {/* AI Summary */}
                    {r.ai_summary && (
                      <div>
                        <Label className="text-xs font-semibold text-muted-foreground">AI Summary</Label>
                        <p className="text-sm mt-1 bg-muted/50 p-2 rounded">{r.ai_summary}</p>
                      </div>
                    )}

                    {/* AI Lovable Prompt */}
                    {r.ai_lovable_prompt && (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Label className="text-xs font-semibold text-muted-foreground">Lovable Fix Prompt</Label>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyPrompt(r.ai_lovable_prompt!)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap font-mono border border-border">
                          {r.ai_lovable_prompt}
                        </pre>
                      </div>
                    )}

                    {/* Screenshot */}
                    {r.screenshot_base64 && (
                      <div>
                        <Label className="text-xs font-semibold text-muted-foreground">Screenshot</Label>
                        <img src={r.screenshot_base64} alt="Bug screenshot" className="max-h-64 rounded border border-border mt-1" />
                      </div>
                    )}

                    {/* Console Errors / New Marketplace Data */}
                    {r.console_errors && (r.console_errors as any[]).length > 0 && (
                      <div>
                        <Label className="text-xs font-semibold text-muted-foreground">
                          {(r.ai_classification === 'New marketplace' || r.ai_classification === 'New marketplace saved') ? 'File Analysis' : `Console Errors (${(r.console_errors as any[]).length})`}
                        </Label>
                        {(r.ai_classification === 'New marketplace' || r.ai_classification === 'New marketplace saved') ? (
                          <NewMarketplaceDetails data={r.console_errors} reportId={r.id} />
                        ) : (
                          <pre className="text-xs bg-muted p-2 rounded mt-1 max-h-32 overflow-auto font-mono">
                            {JSON.stringify(r.console_errors, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Owner Notes */}
                    <div>
                      <Label className="text-xs font-semibold text-muted-foreground">Owner Notes</Label>
                      <Textarea
                        className="mt-1 text-sm"
                        rows={2}
                        placeholder="Add your notes..."
                        defaultValue={r.owner_notes || ''}
                        onBlur={(e) => {
                          if (e.target.value !== (r.owner_notes || '')) {
                            updateReport(r.id, { owner_notes: e.target.value });
                          }
                        }}
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex gap-1.5">
                        {(['open', 'in_progress', 'resolved'] as const).map(s => (
                          <Button
                            key={s}
                            size="sm"
                            variant={r.status === s ? 'default' : 'outline'}
                            onClick={() => setStatus(r.id, s)}
                            className="text-xs capitalize"
                          >
                            {s.replace('_', ' ')}
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        <Label htmlFor={`notify-${r.id}`} className="text-xs">Notify Submitter</Label>
                        <Switch
                          id={`notify-${r.id}`}
                          checked={r.notify_submitter}
                          onCheckedChange={(v) => updateReport(r.id, { notify_submitter: v })}
                        />
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
