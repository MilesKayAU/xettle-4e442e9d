import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sparkles, ChevronDown, ChevronUp, Loader2, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function CoaAuditPanel() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const runAudit = useCallback(async () => {
    setLoading(true);
    setResult('');
    setOpen(true);
    setHasRun(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in first');
        setLoading(false);
        return;
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coa-audit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        toast.error(err.error || `Error ${resp.status}`);
        setLoading(false);
        return;
      }

      if (!resp.body) {
        toast.error('No response stream');
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              setResult(accumulated);
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Flush remaining
      if (buffer.trim()) {
        for (let raw of buffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              setResult(accumulated);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Audit failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">COA Health Check</span>
          <span className="text-[10px] text-muted-foreground">AI Best Practice Audit</span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasRun && !loading && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={runAudit}>
              <RotateCcw className="h-3 w-3" />
              Re-run
            </Button>
          )}
          {!hasRun && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={runAudit}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Analyse My COA
            </Button>
          )}
          {hasRun && (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(!open)}>
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </CollapsibleTrigger>
          )}
        </div>
      </div>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleContent>
          <div className="border-t border-border px-4 py-3">
            {loading && !result && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analysing your Chart of Accounts against best practices…
              </div>
            )}
            {result && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&_h3]:text-sm [&_h3]:mt-3 [&_h3]:mb-1 [&_h2]:text-base [&_h2]:mt-4 [&_h2]:mb-2 [&_ul]:my-1 [&_li]:my-0.5 [&_p]:my-1">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            )}
            {loading && result && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Still analysing…
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
