import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/ui/loading-spinner';
import {
  Crosshair, Copy, Check, X, ExternalLink, ChevronDown, Sparkles, Filter,
} from 'lucide-react';

interface Opportunity {
  id: string;
  platform: string;
  thread_url: string | null;
  thread_title: string;
  thread_snippet: string | null;
  relevance_score: number;
  draft_response: string | null;
  status: string;
  search_query: string | null;
  created_at: string;
  posted_at: string | null;
}

const platformColors: Record<string, string> = {
  reddit: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  xero_community: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  shopify_community: 'bg-green-500/10 text-green-600 border-green-500/20',
  quora: 'bg-red-500/10 text-red-600 border-red-500/20',
  forum: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
};

const platformLabels: Record<string, string> = {
  reddit: 'Reddit',
  xero_community: 'Xero Community',
  shopify_community: 'Shopify Community',
  quora: 'Quora',
  forum: 'Forum',
};

export default function GrowthScoutDashboard() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [scouting, setScouting] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadOpportunities = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('growth_opportunities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Failed to load opportunities:', error);
    } else {
      setOpportunities((data as unknown as Opportunity[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadOpportunities();
  }, []);

  const runScout = async () => {
    setScouting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/growth-scout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Scout failed');
      }

      const result = await response.json();
      toast({
        title: 'Scout Complete',
        description: `Found ${result.count} new opportunities`,
      });
      loadOpportunities();
    } catch (err: any) {
      toast({
        title: 'Scout Failed',
        description: err.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setScouting(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const update: any = { status };
    if (status === 'posted') update.posted_at = new Date().toISOString();

    const { error } = await supabase
      .from('growth_opportunities')
      .update(update)
      .eq('id', id);

    if (error) {
      toast({ title: 'Error', description: 'Failed to update status', variant: 'destructive' });
    } else {
      setOpportunities(prev =>
        prev.map(o => (o.id === id ? { ...o, ...update } : o))
      );
    }
  };

  const copyDraft = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: 'Copied', description: 'Draft response copied to clipboard' });
  };

  const filtered = filter === 'all'
    ? opportunities
    : opportunities.filter(o => o.status === filter);

  const statusCounts = {
    all: opportunities.length,
    new: opportunities.filter(o => o.status === 'new').length,
    posted: opportunities.filter(o => o.status === 'posted').length,
    dismissed: opportunities.filter(o => o.status === 'dismissed').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            Growth Scout
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered forum & community opportunity finder — answer-first, link-second
          </p>
        </div>
        <Button onClick={runScout} disabled={scouting}>
          {scouting ? (
            <LoadingSpinner size="sm" className="mr-2" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          {scouting ? 'Scouting...' : 'Run Scout'}
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        {(['all', 'new', 'posted', 'dismissed'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              filter === s
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:bg-muted/50'
            }`}
          >
            <p className="text-xs text-muted-foreground capitalize">{s}</p>
            <p className="text-2xl font-bold text-foreground">{statusCounts[s]}</p>
          </button>
        ))}
      </div>

      {/* Opportunities */}
      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="md" text="Loading opportunities..." />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Crosshair className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              {opportunities.length === 0
                ? 'No opportunities yet. Click "Run Scout" to find some!'
                : 'No opportunities match this filter.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(opp => (
            <Collapsible key={opp.id}>
              <Card className={opp.status === 'dismissed' ? 'opacity-50' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge
                          variant="outline"
                          className={platformColors[opp.platform] || 'bg-muted'}
                        >
                          {platformLabels[opp.platform] || opp.platform}
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs">
                          Score: {opp.relevance_score}/10
                        </Badge>
                        {opp.status === 'posted' && (
                          <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                            Posted
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-base leading-snug">
                        {opp.thread_title}
                      </CardTitle>
                      {opp.thread_snippet && (
                        <CardDescription className="mt-1 line-clamp-2">
                          "{opp.thread_snippet}"
                        </CardDescription>
                      )}
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="shrink-0">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </CardHeader>

                <CollapsibleContent>
                  <CardContent className="space-y-4">
                    {/* Draft response */}
                    {opp.draft_response && (
                      <div className="rounded-md border border-border bg-muted/30 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Draft Response
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyDraft(opp.id, opp.draft_response!)}
                          >
                            {copiedId === opp.id ? (
                              <Check className="h-3.5 w-3.5 mr-1 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 mr-1" />
                            )}
                            {copiedId === opp.id ? 'Copied' : 'Copy'}
                          </Button>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                          {opp.draft_response}
                        </p>
                      </div>
                    )}

                    {/* Meta */}
                    {opp.search_query && (
                      <p className="text-xs text-muted-foreground">
                        <Filter className="h-3 w-3 inline mr-1" />
                        Query: {opp.search_query}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {opp.thread_url && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={opp.thread_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5 mr-1" />
                            Open Thread
                          </a>
                        </Button>
                      )}
                      {opp.status !== 'posted' && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => updateStatus(opp.id, 'posted')}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Mark Posted
                        </Button>
                      )}
                      {opp.status !== 'dismissed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateStatus(opp.id, 'dismissed')}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          Dismiss
                        </Button>
                      )}
                      {opp.status === 'dismissed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateStatus(opp.id, 'new')}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
