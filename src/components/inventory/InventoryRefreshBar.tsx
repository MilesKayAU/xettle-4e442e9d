import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

interface InventoryRefreshBarProps {
  lastFetched: Date | null;
  loading: boolean;
  partial?: boolean;
  error?: string | null;
  onRefresh: () => void;
}

export default function InventoryRefreshBar({ lastFetched, loading, partial, error, onRefresh }: InventoryRefreshBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {lastFetched && (
        <span className="text-xs text-muted-foreground">
          Last fetched {formatDistanceToNow(lastFetched, { addSuffix: true })}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Fetching...' : 'Refresh'}
      </Button>
      {partial && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          Some results could not be loaded. Tap Refresh to try again.
        </div>
      )}
      {error && !partial && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </div>
  );
}
