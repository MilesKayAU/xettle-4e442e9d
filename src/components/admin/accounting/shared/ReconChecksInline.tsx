/**
 * ReconChecksInline — Inline reconciliation check display per settlement.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import React from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import type { UniversalReconciliationResult } from '@/utils/universal-reconciliation';

interface ReconChecksInlineProps {
  settlementId: string;
  reconResult: UniversalReconciliationResult | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function ReconChecksInline({
  settlementId,
  reconResult,
  isExpanded,
  onToggle,
}: ReconChecksInlineProps) {
  return (
    <>
      <button
        onClick={onToggle}
        className="text-[10px] text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 cursor-pointer"
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
        {reconResult
          ? `Recon: ${reconResult.overallStatus === 'pass' ? '✅ Pass' : reconResult.overallStatus === 'warn' ? '⚠️ Warnings' : '❌ Fail'}`
          : 'Run recon checks'
        }
      </button>
      {isExpanded && reconResult && (
        <div className="mt-1.5 space-y-1 bg-muted/30 rounded-md px-3 py-2">
          {reconResult.checks.map((check) => (
            <div key={check.id} className="flex items-center gap-2 text-[10px]">
              <span>
                {check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'}
              </span>
              <span className="font-medium text-foreground">{check.label}</span>
              <span className="text-muted-foreground">— {check.detail}</span>
            </div>
          ))}
          {!reconResult.canSync && (
            <p className="text-[10px] font-medium text-destructive mt-1">⛔ Xero push blocked — resolve critical issues first</p>
          )}
        </div>
      )}
    </>
  );
}
