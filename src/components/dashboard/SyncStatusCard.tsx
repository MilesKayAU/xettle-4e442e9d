/**
 * SyncStatusCard — Dashboard card showing recent sync activity.
 * Uses useSyncStatus hook + canonical sync actions only.
 * No direct Supabase calls.
 */

import React, { useState } from 'react';
import { useSyncStatus, type SyncStatusValue } from '@/hooks/useSyncStatus';
import { runXeroSync, runMarketplaceSync } from '@/actions/sync';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, CheckCircle2, XCircle, Clock, Loader2, Minus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

function StatusIcon({ status }: { status: SyncStatusValue }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case 'never':
      return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatLastRun(date: Date | null): string {
  if (!date) return 'Never';
  try {
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

interface SyncRowProps {
  label: string;
  status: SyncStatusValue;
  lastRun: Date | null;
  message?: string;
  onSync: () => Promise<void>;
  syncing: boolean;
}

function SyncRow({ label, status, lastRun, message, onSync, syncing }: SyncRowProps) {
  const isRunning = syncing || status === 'running';

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <StatusIcon status={isRunning ? 'running' : status} />
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              {isRunning ? 'Syncing…' : formatLastRun(lastRun)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {status === 'error' && message && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-destructive cursor-help">Error</span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[240px]">
                <p className="text-xs">{message}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={isRunning}
          onClick={onSync}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRunning && 'animate-spin')} />
        </Button>
      </div>
    </div>
  );
}

export default function SyncStatusCard() {
  const { xero, marketplaces, loading } = useSyncStatus();
  const [syncingXero, setSyncingXero] = useState(false);
  const [syncingRail, setSyncingRail] = useState<string | null>(null);

  const handleXeroSync = async () => {
    setSyncingXero(true);
    try {
      const result = await runXeroSync();
      if (result.success) {
        toast.success('Xero sync complete');
      } else {
        toast.error(result.error || 'Xero sync failed');
      }
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncingXero(false);
    }
  };

  const handleMarketplaceSync = async (rail: string) => {
    setSyncingRail(rail);
    try {
      const result = await runMarketplaceSync(rail);
      if (result.success) {
        toast.success('Marketplace sync complete');
      } else {
        toast.error(result.error || 'Sync failed');
      }
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncingRail(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            Sync Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Don't render if no connections at all
  if (xero.status === 'never' && marketplaces.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          Sync Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="divide-y divide-border">
          {/* Xero row — always show if any sync history exists */}
          <SyncRow
            label="Xero"
            status={xero.status}
            lastRun={xero.lastRun}
            message={xero.message}
            onSync={handleXeroSync}
            syncing={syncingXero}
          />

          {/* Marketplace rows */}
          {marketplaces.map(mp => (
            <SyncRow
              key={mp.rail}
              label={mp.name}
              status={mp.status}
              lastRun={mp.lastRun}
              message={mp.message}
              onSync={() => handleMarketplaceSync(mp.rail)}
              syncing={syncingRail === mp.rail}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
