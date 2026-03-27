/**
 * SystemAuditPanel — AI-powered full system audit for Xettle.
 * Runs guardrails, formula checks, GST consistency, mapping gaps,
 * and parser discrepancies, then sends to Claude for analysis.
 * Admin-only, displayed in Settings → Data Quality.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Info,
  Loader2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AuditFinding {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  category: string;
  description: string;
  affected_settlements: string[];
  recommendation: string;
  auto_fixable: boolean;
}

interface AuditResult {
  audit_data: {
    guardrails: any[];
    formula_discrepancies: any[];
    formula_total_count: number;
    gst_issues: any[];
    gst_total_count: number;
    mapping_gaps: any[];
    parser_discrepancies: any[];
    parser_total_count: number;
    status_distribution: Record<string, number>;
    total_settlements_checked: number;
  };
  ai_analysis: {
    findings: AuditFinding[];
    overall_health_score: number;
    push_safe: boolean;
    summary: string;
  } | null;
  error?: string;
}

const SEVERITY_CONFIG = {
  CRITICAL: {
    icon: XCircle,
    color: 'text-destructive',
    bg: 'bg-destructive/10 border-destructive/30',
    badge: 'destructive' as const,
  },
  WARNING: {
    icon: AlertTriangle,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700',
    badge: 'secondary' as const,
  },
  INFO: {
    icon: Info,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700',
    badge: 'outline' as const,
  },
};

export default function SystemAuditPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [expandedSeverity, setExpandedSeverity] = useState<Record<string, boolean>>({
    CRITICAL: true,
    WARNING: true,
    INFO: false,
  });

  const handleRunAudit = useCallback(async () => {
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Not authenticated');
        return;
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-system-audit`,
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
        const err = await resp.json().catch(() => ({ error: 'Audit failed' }));
        toast.error(err.error || 'Audit failed');
        return;
      }

      const data: AuditResult = await resp.json();
      setResult(data);
      setLastRunAt(new Date().toLocaleString());

      if (data.error) {
        toast.warning(data.error);
      } else if (data.ai_analysis) {
        const critCount = data.ai_analysis.findings.filter(f => f.severity === 'CRITICAL').length;
        if (critCount > 0) {
          toast.error(`Audit complete — ${critCount} critical finding${critCount !== 1 ? 's' : ''}`);
        } else {
          toast.success(`Audit complete — Health Score: ${data.ai_analysis.overall_health_score}/100`);
        }
      }
    } catch (err: any) {
      toast.error(`Audit failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }, []);

  const handleDownloadReport = useCallback(() => {
    if (!result) return;
    const report = JSON.stringify(result, null, 2);
    const blob = new Blob([report], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xettle-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const analysis = result?.ai_analysis;
  const findings = analysis?.findings || [];
  const criticals = findings.filter(f => f.severity === 'CRITICAL');
  const warnings = findings.filter(f => f.severity === 'WARNING');
  const infos = findings.filter(f => f.severity === 'INFO');

  const healthScore = analysis?.overall_health_score ?? null;
  const pushSafe = analysis?.push_safe ?? null;

  return (
    <div className="space-y-4">
      <div className="border-t border-border pt-4 mt-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-4 w-4 text-primary" />
          <h4 className="font-semibold text-sm">System Audit</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Run a comprehensive AI-powered audit of your accounting data, reconciliation formulas,
          GST handling, account mappings, and data integrity. Uses Claude to analyse findings
          and provide actionable recommendations.
        </p>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleRunAudit}
            disabled={running}
            variant="outline"
            className="gap-2"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {running ? 'Running audit…' : 'Run Full Audit'}
          </Button>

          {lastRunAt && (
            <span className="text-xs text-muted-foreground">Last audit: {lastRunAt}</span>
          )}
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4 mt-4">
          {/* Health Score Banner */}
          {analysis && (
            <Card className={cn(
              "border",
              pushSafe ? "border-emerald-300 dark:border-emerald-700" : "border-destructive/50"
            )}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "text-3xl font-bold",
                    healthScore !== null && healthScore >= 80
                      ? "text-emerald-600 dark:text-emerald-400"
                      : healthScore !== null && healthScore >= 50
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-destructive"
                  )}>
                    {healthScore}/100
                  </div>
                  <div>
                    <p className="text-sm font-medium">Health Score</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {pushSafe ? (
                        <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Push Safe
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <ShieldAlert className="h-3 w-3" /> Push Blocked
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-destructive font-semibold">🔴 {criticals.length}</span>
                    <span className="text-amber-600 dark:text-amber-400 font-semibold">🟡 {warnings.length}</span>
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">ℹ️ {infos.length}</span>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={handleDownloadReport}>
                    <Download className="h-3 w-3" />
                    Download Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary */}
          {analysis?.summary && (
            <p className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
              {analysis.summary}
            </p>
          )}

          {/* Findings by severity */}
          {(['CRITICAL', 'WARNING', 'INFO'] as const).map(severity => {
            const items = findings.filter(f => f.severity === severity);
            if (items.length === 0) return null;

            const config = SEVERITY_CONFIG[severity];
            const Icon = config.icon;
            const isExpanded = expandedSeverity[severity];

            return (
              <Collapsible key={severity} open={isExpanded} onOpenChange={(open) => setExpandedSeverity(prev => ({ ...prev, [severity]: open }))}>
                <CollapsibleTrigger className={cn(
                  "flex items-center justify-between w-full rounded-md border px-3 py-2 text-sm cursor-pointer",
                  config.bg
                )}>
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", config.color)} />
                    <span className="font-medium">{severity}</span>
                    <Badge variant={config.badge} className="text-[10px]">{items.length}</Badge>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-2">
                  {items.map((finding, i) => (
                    <Card key={i} className="border-border/50">
                      <CardContent className="py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <Badge variant="outline" className="text-[10px] mb-1">{finding.category}</Badge>
                            <p className="text-sm">{finding.description}</p>
                          </div>
                          {finding.auto_fixable && (
                            <Badge className="bg-emerald-600 text-white text-[10px] shrink-0">Auto-fixable</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Recommendation:</span> {finding.recommendation}
                        </p>
                        {finding.affected_settlements.length > 0 && (
                          <p className="text-[10px] text-muted-foreground font-mono">
                            Affected: {finding.affected_settlements.slice(0, 5).join(', ')}
                            {finding.affected_settlements.length > 5 && ` +${finding.affected_settlements.length - 5} more`}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })}

          {/* Raw Data Summary */}
          {result.audit_data && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer py-1">
                <ChevronDown className="h-3 w-3" />
                Raw audit data ({result.audit_data.total_settlements_checked} settlements checked)
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <div className="rounded-md bg-muted/50 p-2">
                    <span className="text-muted-foreground">Formula discrepancies:</span>{' '}
                    <span className="font-semibold">{result.audit_data.formula_total_count}</span>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <span className="text-muted-foreground">GST issues:</span>{' '}
                    <span className="font-semibold">{result.audit_data.gst_total_count}</span>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <span className="text-muted-foreground">Mapping gaps:</span>{' '}
                    <span className="font-semibold">{result.audit_data.mapping_gaps.length}</span>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <span className="text-muted-foreground">Parser discrepancies:</span>{' '}
                    <span className="font-semibold">{result.audit_data.parser_total_count}</span>
                  </div>
                </div>
                {Object.keys(result.audit_data.status_distribution).length > 0 && (
                  <div className="mt-2 rounded-md bg-muted/50 p-2">
                    <p className="text-[10px] text-muted-foreground font-medium mb-1">Status distribution:</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(result.audit_data.status_distribution).map(([status, count]) => (
                        <Badge key={status} variant="outline" className="text-[9px]">
                          {status}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}
