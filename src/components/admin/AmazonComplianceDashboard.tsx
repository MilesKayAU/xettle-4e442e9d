import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/ui/loading-spinner';
import {
  CheckCircle, XCircle, RefreshCw, Plus, Download, Search, Send, Shield,
  FileText, Bot, AlertTriangle, Clock, Copy, Lock, FileCheck, GitBranch,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ComplianceItem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  is_compliant: boolean;
  evidence_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditRow {
  id: string;
  integration: string;
  endpoint: string;
  method: string;
  status_code: number | null;
  latency_ms: number | null;
  rate_limit_remaining: number | null;
  error_summary: string | null;
  request_context: Record<string, any> | null;
  created_at: string;
}

interface ComplianceRequirement {
  requirement: string;
  status: 'compliant' | 'partial' | 'not_implemented';
  evidence: string;
  action_needed?: string | null;
}

interface AnalysisResult {
  requirements: ComplianceRequirement[];
  draft_reply: string;
}

/* ------------------------------------------------------------------ */
/*  Category labels                                                    */
/* ------------------------------------------------------------------ */
const CATEGORY_LABELS: Record<string, string> = {
  code_architecture: 'Code Architecture',
  data_protection: 'Data Protection',
  operational: 'Operational',
  security_controls: 'Security Controls',
  documentation: 'Documentation',
  scope_decision: 'Scope Decision',
  custom: 'Custom',
};

const CATEGORY_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  code_architecture: { label: 'Core', variant: 'outline', icon: <GitBranch className="h-3 w-3" /> },
  data_protection: { label: 'Privacy', variant: 'destructive', icon: <Lock className="h-3 w-3" /> },
  operational: { label: 'Ops', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  security_controls: { label: 'High priority', variant: 'destructive', icon: <Shield className="h-3 w-3" /> },
  documentation: { label: 'Docs required', variant: 'default', icon: <FileCheck className="h-3 w-3" /> },
  scope_decision: { label: 'Scope question', variant: 'secondary', icon: <AlertTriangle className="h-3 w-3" /> },
  custom: { label: 'Custom', variant: 'outline', icon: <Plus className="h-3 w-3" /> },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AmazonComplianceDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Amazon API Compliance
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          SP-API approval requirements, audit evidence, and email analyzer
        </p>
      </div>

      <Tabs defaultValue="checklist">
        <TabsList>
          <TabsTrigger value="checklist" className="gap-1.5">
            <CheckCircle className="h-3.5 w-3.5" /> Checklist
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> API Audit
          </TabsTrigger>
          <TabsTrigger value="analyzer" className="gap-1.5">
            <Bot className="h-3.5 w-3.5" /> Email Analyzer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checklist"><ComplianceChecklist /></TabsContent>
        <TabsContent value="audit"><AuditConsole /></TabsContent>
        <TabsContent value="analyzer"><EmailAnalyzer /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ================================================================== */
/*  Checklist Tab                                                      */
/* ================================================================== */

function ComplianceChecklist() {
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('custom');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase.from('amazon_compliance_items' as any).select('*').order('category').order('created_at') as any);
    if (!error && data) setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleCompliant = async (item: ComplianceItem) => {
    const { error } = await (supabase.from('amazon_compliance_items' as any).update({ is_compliant: !item.is_compliant } as any).eq('id', item.id) as any);
    if (!error) setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_compliant: !i.is_compliant } : i));
  };

  const saveNotes = async (id: string) => {
    const { error } = await (supabase.from('amazon_compliance_items' as any).update({ evidence_notes: noteDraft } as any).eq('id', id) as any);
    if (!error) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, evidence_notes: noteDraft } : i));
      setEditingNotes(null);
      toast({ title: 'Notes saved' });
    }
  };

  const addItem = async () => {
    if (!newTitle.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await (supabase.from('amazon_compliance_items' as any).insert({
      user_id: userData.user.id,
      title: newTitle.trim(),
      description: newDesc.trim() || null,
      category: newCategory,
    } as any) as any);
    if (!error) {
      setNewTitle('');
      setNewDesc('');
      setAddOpen(false);
      load();
      toast({ title: 'Item added' });
    }
  };

  const compliantCount = items.filter(i => i.is_compliant).length;

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="md" text="Loading checklist..." /></div>;

  return (
    <div className="space-y-4 mt-4">
      {/* Summary strip */}
      <div className="flex items-center gap-4">
        <Badge variant={compliantCount === items.length ? 'default' : 'secondary'} className="text-sm px-3 py-1">
          {compliantCount}/{items.length} Compliant
        </Badge>
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${items.length ? (compliantCount / items.length) * 100 : 0}%` }}
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(!addOpen)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
        </Button>
      </div>

      {/* Add form */}
      {addOpen && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <Input placeholder="Requirement title" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
            <Input placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={addItem}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items by category */}
      {Object.entries(
        items.reduce((groups, item) => {
          const cat = item.category || 'custom';
          if (!groups[cat]) groups[cat] = [];
          groups[cat].push(item);
          return groups;
        }, {} as Record<string, ComplianceItem[]>)
      ).map(([cat, catItems]) => (
        <Card key={cat}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {CATEGORY_LABELS[cat] || cat}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {catItems.map(item => (
              <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                <Switch
                  checked={item.is_compliant}
                  onCheckedChange={() => toggleCompliant(item)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium text-sm ${item.is_compliant ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {item.title}
                    </span>
                    {item.is_compliant ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  )}
                  {/* Evidence notes */}
                  {editingNotes === item.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={noteDraft}
                        onChange={e => setNoteDraft(e.target.value)}
                        placeholder="Evidence notes, file references, implementation details..."
                        className="text-xs min-h-[60px]"
                      />
                      <div className="flex gap-1">
                        <Button size="sm" variant="default" onClick={() => saveNotes(item.id)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="mt-1 text-xs text-primary/70 hover:text-primary cursor-pointer text-left"
                      onClick={() => { setEditingNotes(item.id); setNoteDraft(item.evidence_notes || ''); }}
                    >
                      {item.evidence_notes || 'Add evidence notes →'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  Audit Console Tab                                                  */
/* ================================================================== */

function AuditConsole() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterIntegration, setFilterIntegration] = useState('');
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('api_call_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (filterIntegration) {
      query = query.eq('integration', filterIntegration);
    }
    if (filterErrorsOnly) {
      query = query.not('error_summary', 'is', null);
    }

    const { data, error } = await query;
    if (!error && data) setLogs(data as unknown as AuditRow[]);
    setLoading(false);
  }, [filterIntegration, filterErrorsOnly]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!logs.length) return;
    const headers = ['timestamp', 'integration', 'method', 'endpoint', 'status', 'latency_ms', 'rate_limit', 'error'];
    const rows = logs.map(l => [
      l.created_at,
      l.integration,
      l.method,
      l.endpoint,
      l.status_code ?? '',
      l.latency_ms ?? '',
      l.rate_limit_remaining ?? '',
      (l.error_summary || '').replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="text-sm border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
          value={filterIntegration}
          onChange={e => setFilterIntegration(e.target.value)}
        >
          <option value="">All Integrations</option>
          <option value="amazon_sp_api">Amazon SP-API</option>
          <option value="amazon_lwa">Amazon LwA</option>
          <option value="shopify">Shopify</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Switch checked={filterErrorsOnly} onCheckedChange={setFilterErrorsOnly} />
          Errors only
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!logs.length}>
          <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-8"><LoadingSpinner size="md" /></div>
          ) : logs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No API calls logged yet</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Time</TableHead>
                    <TableHead>Integration</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Rate Limit</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{log.integration}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{log.method}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[200px] truncate" title={log.endpoint}>
                        {log.endpoint}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={log.status_code && log.status_code < 400 ? 'default' : 'destructive'} className="text-[10px]">
                          {log.status_code ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">{log.latency_ms != null ? `${log.latency_ms}ms` : '—'}</TableCell>
                      <TableCell className="text-right text-xs">{log.rate_limit_remaining ?? '—'}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-[150px] truncate" title={log.error_summary || ''}>
                        {log.error_summary || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Email Analyzer Tab                                                 */
/* ================================================================== */

function EmailAnalyzer() {
  const [emailText, setEmailText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const analyze = async () => {
    if (!emailText.trim()) return;
    setAnalyzing(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-amazon-compliance', {
        body: { emailText: emailText.trim() },
      });
      if (error) throw error;
      setResult(data as AnalysisResult);
    } catch (err: any) {
      toast({ title: 'Analysis failed', description: err.message, variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const copyDraft = () => {
    if (!result?.draft_reply) return;
    navigator.clipboard.writeText(result.draft_reply);
    toast({ title: 'Copied to clipboard' });
  };

  const statusIcon = (s: string) => {
    if (s === 'compliant') return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (s === 'partial') return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  const statusLabel = (s: string) => {
    if (s === 'compliant') return 'Compliant';
    if (s === 'partial') return 'Partial';
    return 'Not Implemented';
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Paste Amazon Email
          </CardTitle>
          <CardDescription>
            Paste an email from Amazon's developer support team. AI will analyze each requirement against your codebase and draft a reply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={emailText}
            onChange={e => setEmailText(e.target.value)}
            placeholder="Paste the full email from Amazon here..."
            className="min-h-[150px] text-sm font-mono"
          />
          <Button onClick={analyze} disabled={analyzing || !emailText.trim()}>
            {analyzing ? (
              <>
                <Clock className="h-4 w-4 mr-1 animate-spin" /> Analyzing...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-1" /> Analyze Email
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* Requirements breakdown */}
          {result.requirements?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Requirements Analysis</CardTitle>
                <CardDescription>
                  {result.requirements.filter(r => r.status === 'compliant').length}/{result.requirements.length} requirements satisfied
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.requirements.map((req, i) => (
                  <div key={i} className="p-3 rounded-lg border border-border space-y-1">
                    <div className="flex items-start gap-2">
                      {statusIcon(req.status)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{req.requirement}</span>
                          <Badge variant={req.status === 'compliant' ? 'default' : req.status === 'partial' ? 'secondary' : 'destructive'} className="text-[10px]">
                            {statusLabel(req.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{req.evidence}</p>
                        {req.action_needed && (
                          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {req.action_needed}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Draft reply */}
          {result.draft_reply && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Draft Reply</CardTitle>
                  <Button size="sm" variant="outline" onClick={copyDraft}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none bg-muted/30 rounded-lg p-4 text-sm">
                  <ReactMarkdown>{result.draft_reply}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
