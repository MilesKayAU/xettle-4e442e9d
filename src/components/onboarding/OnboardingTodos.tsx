/**
 * OnboardingTodos — Ranked actionable to-do list derived from coverage map + system state.
 * Evidence-gated: "Upload required" only appears when unmatched bank deposits exist.
 */

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertTriangle, Upload, Link2, Search, Info, ChevronDown,
  CheckCircle2, ExternalLink,
} from 'lucide-react';
import type { CoverageData } from './SettlementCoverageMap';

// ─── Types ──────────────────────────────────────────────────────

type TodoType = 'connect' | 'exception' | 'unmatched_deposit' | 'upload' | 'info';

interface TodoItem {
  type: TodoType;
  priority: number;
  title: string;
  description: string;
  marketplace?: string;
  dateRange?: { start: string; end: string };
  actionLabel: string;
}

interface OnboardingTodosProps {
  coverageData: CoverageData | null;
  onUpload?: (marketplace?: string, dateRange?: { start: string; end: string }) => void;
  onConnect?: () => void;
  onReview?: () => void;
}

// ─── Component ──────────────────────────────────────────────────

export default function OnboardingTodos({ coverageData, onUpload, onConnect, onReview }: OnboardingTodosProps) {
  const [expanded, setExpanded] = useState(false);
  const [connectIssues, setConnectIssues] = useState<TodoItem[]>([]);
  const [exceptions, setExceptions] = useState<TodoItem[]>([]);

  // Load connect issues + exceptions from system state
  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [amazonTokenRes, authErrorsRes, exceptionsRes] = await Promise.all([
          supabase.from('amazon_tokens')
            .select('expires_at')
            .limit(1)
            .maybeSingle(),
          supabase.from('system_events')
            .select('marketplace_code, details')
            .in('event_type', ['xero_push_failed', 'shopify_token_expired'])
            .eq('severity', 'error')
            .order('created_at', { ascending: false })
            .limit(5),
          supabase.from('system_events')
            .select('event_type, details, marketplace_code')
            .eq('severity', 'error')
            .order('created_at', { ascending: false })
            .limit(10),
        ]);

        const issues: TodoItem[] = [];

        // Amazon token expiry
        if (amazonTokenRes.data?.expires_at) {
          const expiry = new Date(amazonTokenRes.data.expires_at);
          if (expiry < new Date()) {
            issues.push({
              type: 'connect',
              priority: 1,
              title: 'Amazon connection expired',
              description: 'Your Amazon SP-API token has expired. Reconnect to continue syncing.',
              actionLabel: 'Reconnect',
            });
          }
        }

        // Auth errors from system events
        const authErrors = authErrorsRes.data || [];
        const seenCodes = new Set<string>();
        for (const err of authErrors) {
          const code = err.marketplace_code || 'unknown';
          if (seenCodes.has(code)) continue;
          seenCodes.add(code);
          issues.push({
            type: 'connect',
            priority: 1,
            title: `${code} connection issue`,
            description: 'Recent sync failed with an authentication error.',
            marketplace: code,
            actionLabel: 'Fix connection',
          });
        }

        setConnectIssues(issues);

        // Exceptions (non-auth errors)
        const excItems: TodoItem[] = [];
        const excs = (exceptionsRes.data || []).filter(e =>
          !['xero_push_failed', 'shopify_token_expired'].includes(e.event_type)
        );
        if (excs.length > 0) {
          excItems.push({
            type: 'exception',
            priority: 2,
            title: `${excs.length} exception(s) need review`,
            description: 'Errors detected during processing that may need attention.',
            actionLabel: 'Review',
          });
        }
        setExceptions(excItems);
      } catch { /* silent */ }
    }
    load();
  }, []);

  // Build ranked todo list
  const todos = useMemo(() => {
    const items: TodoItem[] = [...connectIssues, ...exceptions];

    if (coverageData) {
      // Unmatched deposits / upload needed — only from red cells
      for (const mkt of coverageData.marketplaces) {
        const mktCells = coverageData.cells[mkt] || {};
        for (const [weekLabel, cell] of Object.entries(mktCells)) {
          if (cell.state !== 'red') continue;
          const week = coverageData.weekBuckets.find(w => w.label === weekLabel);
          if (!week) continue;

          items.push({
            type: 'unmatched_deposit',
            priority: 3,
            title: `Possible missing settlement — ${mkt}`,
            description: `${cell.unmatchedDepositCount} unmatched bank deposit(s) found for ${week.start} – ${week.end}`,
            marketplace: mkt,
            dateRange: { start: week.start, end: week.end },
            actionLabel: 'Upload settlement',
          });
        }
      }

      // Shopify sub-channels as info items
      for (const ch of coverageData.subChannels) {
        items.push({
          type: 'info',
          priority: 5,
          title: `Sales channel detected: ${ch.marketplace_label}`,
          description: `${ch.order_count || 0} orders found via Shopify`,
          actionLabel: 'View',
        });
      }
    }

    // Sort by priority
    return items.sort((a, b) => a.priority - b.priority);
  }, [connectIssues, exceptions, coverageData]);

  const visibleTodos = expanded ? todos : todos.slice(0, 5);

  const handleAction = async (todo: TodoItem) => {
    // Log metric
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('system_events').insert({
          user_id: user.id,
          event_type: 'onboarding_todo_clicked',
          severity: 'info',
          details: { type: todo.type, marketplace: todo.marketplace },
        } as any);
      }
    } catch { /* silent */ }

    switch (todo.type) {
      case 'connect':
        onConnect?.();
        break;
      case 'exception':
        onReview?.();
        break;
      case 'unmatched_deposit':
      case 'upload':
        onUpload?.(todo.marketplace, todo.dateRange);
        break;
      default:
        break;
    }
  };

  if (todos.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <span>No action items — you're all set!</span>
      </div>
    );
  }

  const ICON_MAP: Record<TodoType, React.ReactNode> = {
    connect: <Link2 className="h-4 w-4 text-destructive" />,
    exception: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    unmatched_deposit: <Search className="h-4 w-4 text-destructive" />,
    upload: <Upload className="h-4 w-4 text-amber-500" />,
    info: <Info className="h-4 w-4 text-muted-foreground" />,
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Next Steps</h3>
      <div className="space-y-1.5">
        {visibleTodos.map((todo, i) => (
          <button
            key={`${todo.type}-${todo.marketplace}-${i}`}
            onClick={() => handleAction(todo)}
            className="w-full flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-accent/50 transition-colors group"
          >
            {ICON_MAP[todo.type]}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{todo.title}</p>
              <p className="text-xs text-muted-foreground truncate">{todo.description}</p>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {todo.actionLabel}
            </Badge>
          </button>
        ))}
      </div>

      {todos.length > 5 && !expanded && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} className="w-full text-xs">
          <ChevronDown className="h-3 w-3 mr-1" />
          Show all ({todos.length})
        </Button>
      )}
    </div>
  );
}
