/**
 * GapDetector — Renders a gap warning between settlements when periods don't align.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatSettlementDate } from '@/utils/settlement-engine';

interface GapDetectorProps {
  currentStart: string;
  previousEnd: string;
  marketplace: string;
}

/** Returns true if there's a meaningful gap between two settlements */
export function hasSettlementGap(currentStart: string, previousEnd: string, marketplace: string): boolean {
  if (currentStart <= previousEnd) return false;
  const gapMs = new Date(currentStart).getTime() - new Date(previousEnd).getTime();
  const gapDays = gapMs / (1000 * 60 * 60 * 24);
  const isShopify = marketplace.toLowerCase().includes('shopify');
  const tolerance = isShopify ? 7 : 1;
  return gapDays > tolerance;
}

export default function GapDetector({ currentStart, previousEnd, marketplace }: GapDetectorProps) {
  if (!hasSettlementGap(currentStart, previousEnd, marketplace)) return null;
  
  return (
    <div className="flex items-center gap-2 py-1 px-3">
      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        Gap: missing settlement between {formatSettlementDate(previousEnd)} and {formatSettlementDate(currentStart)}
      </p>
    </div>
  );
}
