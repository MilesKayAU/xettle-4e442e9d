/**
 * MarketplaceManagerPanel — Site-wide on/off switch for each marketplace.
 *
 * Shows all marketplace_connections with a toggle to activate/deactivate.
 * Uses DeactivateMarketplaceDialog for confirmation + safety checks.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, Store } from 'lucide-react';
import { ACTIVE_CONNECTION_STATUSES, isApiConnectionType } from '@/constants/connection-status';
import DeactivateMarketplaceDialog from '@/components/settings/DeactivateMarketplaceDialog';

interface MarketplaceConnection {
  id: string;
  marketplace_code: string;
  marketplace_name: string;
  connection_type: string;
  connection_status: string;
}

const connectionTypeLabel = (type: string) => {
  if (type === 'shopify_sub_channel') return 'Sub-channel';
  if (isApiConnectionType(type)) return 'API';
  return 'Manual';
};

const connectionTypeBadgeVariant = (type: string): 'default' | 'secondary' | 'outline' => {
  if (isApiConnectionType(type)) return 'default';
  if (type === 'shopify_sub_channel') return 'secondary';
  return 'outline';
};

export default function MarketplaceManagerPanel() {
  const [connections, setConnections] = useState<MarketplaceConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogTarget, setDialogTarget] = useState<{ code: string; name: string; reactivate: boolean } | null>(null);

  const fetchConnections = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('marketplace_connections')
      .select('id, marketplace_code, marketplace_name, connection_type, connection_status')
      .eq('user_id', user.id)
      .order('marketplace_name');

    setConnections(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const isActive = (c: MarketplaceConnection) =>
    (ACTIVE_CONNECTION_STATUSES as readonly string[]).includes(c.connection_status);

  const activeConns = connections.filter(isActive);
  const inactiveConns = connections.filter(c => !isActive(c));

  const handleToggle = (c: MarketplaceConnection) => {
    setDialogTarget({
      code: c.marketplace_code,
      name: c.marketplace_name,
      reactivate: !isActive(c),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading marketplaces…
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground text-sm">
        <Store className="h-5 w-5" />
        <p>No marketplace connections found. Add one from API Connections above.</p>
      </div>
    );
  }

  const renderRow = (c: MarketplaceConnection) => {
    const active = isActive(c);
    return (
      <div
        key={c.id}
        className={`flex items-center justify-between py-2.5 px-3 rounded-md transition-colors ${
          active ? 'bg-background' : 'bg-muted/50 opacity-60'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-sm font-medium truncate ${active ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
            {c.marketplace_name}
          </span>
          <Badge variant={connectionTypeBadgeVariant(c.connection_type)} className="text-[10px] shrink-0">
            {connectionTypeLabel(c.connection_type)}
          </Badge>
        </div>
        <Switch
          checked={active}
          onCheckedChange={() => handleToggle(c)}
          aria-label={`Toggle ${c.marketplace_name}`}
        />
      </div>
    );
  };

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground mb-3">
        Toggle marketplaces on or off site-wide. Deactivated marketplaces are excluded from all scoring, syncs, posting, and reconciliation.
      </p>

      <div className="space-y-0.5">
        {activeConns.map(renderRow)}
      </div>

      {inactiveConns.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-3 pb-1 px-3 font-medium">
            Deactivated
          </div>
          <div className="space-y-0.5">
            {inactiveConns.map(renderRow)}
          </div>
        </>
      )}

      {dialogTarget && (
        <DeactivateMarketplaceDialog
          open={!!dialogTarget}
          onOpenChange={(open) => { if (!open) setDialogTarget(null); }}
          marketplaceCode={dialogTarget.code}
          marketplaceName={dialogTarget.name}
          reactivate={dialogTarget.reactivate}
          onStatusChanged={() => {
            setDialogTarget(null);
            fetchConnections();
          }}
        />
      )}
    </div>
  );
}
