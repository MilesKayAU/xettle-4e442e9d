/**
 * SupportTierBadge — Displays the computed support tier for a rail.
 * Used in RailPostingSettings and PushSafetyPreview.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Shield, AlertTriangle, XCircle } from 'lucide-react';
import type { SupportTier } from '@/policy/supportPolicy';

interface SupportTierBadgeProps {
  tier: SupportTier;
  className?: string;
}

export default function SupportTierBadge({ tier, className }: SupportTierBadgeProps) {
  if (tier === 'SUPPORTED') {
    return (
      <Badge variant="outline" className={`text-[10px] border-emerald-400/60 text-emerald-700 ${className || ''}`}>
        <Shield className="h-2.5 w-2.5 mr-0.5" /> Supported
      </Badge>
    );
  }

  if (tier === 'EXPERIMENTAL') {
    return (
      <Badge variant="outline" className={`text-[10px] border-amber-400/60 text-amber-700 ${className || ''}`}>
        <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Experimental
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={`text-[10px] border-destructive/60 text-destructive ${className || ''}`}>
      <XCircle className="h-2.5 w-2.5 mr-0.5" /> Unsupported
    </Badge>
  );
}
