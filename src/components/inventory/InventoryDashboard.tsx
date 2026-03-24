/**
 * Unified Inventory Dashboard — read-only, Phase 1.
 * Shows per-platform tabs based on active connections.
 * 
 * ISOLATION: This module must NOT import any settlement, validation,
 * or Xero push logic. Only allowed shared deps: marketplace_connections,
 * token tables, connection-status, UI components, auth helpers.
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ACTIVE_CONNECTION_STATUSES } from '@/constants/connection-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PackageOpen, Settings2, AlertTriangle } from 'lucide-react';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { useInventoryRules, type SkuLink } from '@/hooks/useInventoryRules';
import { useInventoryFetch } from './useInventoryFetch';

import UniversalInventoryTab from './UniversalInventoryTab';
import ShopifyInventoryTab from './ShopifyInventoryTab';
import AmazonInventoryTab from './AmazonInventoryTab';
import KoganInventoryTab from './KoganInventoryTab';
import EbayInventoryTab from './EbayInventoryTab';
import MiraklInventoryTab from './MiraklInventoryTab';
import InventoryRulesPanel from './InventoryRulesPanel';

interface ConnectionInfo {
  marketplace_code: string;
  marketplace_name: string;
  connection_status: string;
  connection_type: string;
}

type TabKey = 'universal' | 'shopify' | 'amazon' | 'kogan' | 'ebay' | 'mirakl';

interface TabDef {
  key: TabKey;
  label: string;
  requiresCode?: string[];
}

const ALL_TABS: TabDef[] = [
  { key: 'universal', label: 'Universal' },
  { key: 'shopify', label: 'Shopify', requiresCode: ['shopify_payments', 'shopify_orders'] },
  { key: 'amazon', label: 'Amazon', requiresCode: ['amazon_au', 'amazon_us', 'amazon_uk', 'amazon_ca'] },
  { key: 'kogan', label: 'Kogan', requiresCode: ['kogan'] },
  { key: 'ebay', label: 'eBay', requiresCode: ['ebay_au'] },
  { key: 'mirakl', label: 'Bunnings / Mirakl', requiresCode: ['bunnings_marketplace', 'baby_bunting', 'jb_hi_fi'] },
];

export default function InventoryDashboard({ onNavigateToSettings }: { onNavigateToSettings: () => void }) {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('universal');
  const [rulesOpen, setRulesOpen] = useState(false);

  // Inventory rules (live state for preview, save persists)
  const { rules, setRules, saveRules, loading: rulesLoading, saving } = useInventoryRules();

  // Platform-level fetches for Universal tab aggregation
  const shopifyFetch = useInventoryFetch('fetch-shopify-inventory');
  const amazonFetch = useInventoryFetch('fetch-amazon-inventory');
  const koganFetch = useInventoryFetch('fetch-kogan-inventory');
  const ebayFetch = useInventoryFetch('fetch-ebay-inventory');
  const miraklFetch = useInventoryFetch('fetch-mirakl-inventory');

  // Also check for Kogan API creds in app_settings and direct token tables
  const [hasKoganCreds, setHasKoganCreds] = useState(false);
  const [hasAmazonToken, setHasAmazonToken] = useState(false);
  const [hasShopifyToken, setHasShopifyToken] = useState(false);
  const [hasEbayToken, setHasEbayToken] = useState(false);
  const [hasMiraklToken, setHasMiraklToken] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [connRes, koganRes, amazonRes, shopifyRes, ebayRes, miraklRes] = await Promise.all([
        supabase.from('marketplace_connections').select('marketplace_code, marketplace_name, connection_status, connection_type'),
        supabase.from('app_settings').select('value').eq('user_id', user.id).eq('key', 'kogan_api_seller_token').maybeSingle(),
        supabase.from('amazon_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('shopify_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('ebay_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('mirakl_tokens').select('id').eq('user_id', user.id).limit(1),
      ]);

      setConnections((connRes.data || []) as ConnectionInfo[]);
      setHasKoganCreds(!!(koganRes.data?.value));
      setHasAmazonToken(!!(amazonRes.data && amazonRes.data.length > 0));
      setHasShopifyToken(!!(shopifyRes.data && shopifyRes.data.length > 0));
      setHasEbayToken(!!(ebayRes.data && ebayRes.data.length > 0));
      setHasMiraklToken(!!(miraklRes.data && miraklRes.data.length > 0));
      setConnectionsLoaded(true);
    })();
  }, []);

  const activeCodes = useMemo(() => new Set(
    connections
      .filter(c => (ACTIVE_CONNECTION_STATUSES as readonly string[]).includes(c.connection_status))
      .map(c => c.marketplace_code)
  ), [connections]);

  const hasConnection = (tab: TabDef): boolean => {
    if (!tab.requiresCode) return true;
    if (tab.requiresCode.some(code => activeCodes.has(code))) return true;
    if (tab.key === 'shopify') return hasShopifyToken;
    if (tab.key === 'amazon') return hasAmazonToken;
    if (tab.key === 'ebay') return hasEbayToken;
    if (tab.key === 'mirakl') return hasMiraklToken;
    if (tab.key === 'kogan') return hasKoganCreds || activeCodes.has('kogan');
    return false;
  };

  // Auto-fetch all platform inventory once connections are loaded
  const [universalFetched, setUniversalFetched] = useState(false);
  useEffect(() => {
    if (!connectionsLoaded || universalFetched) return;
    setUniversalFetched(true);
    if (hasShopifyToken || activeCodes.has('shopify_payments') || activeCodes.has('shopify_orders')) shopifyFetch.fetch();
    if (hasAmazonToken || ['amazon_au', 'amazon_us', 'amazon_uk', 'amazon_ca'].some(c => activeCodes.has(c))) amazonFetch.fetch();
    if (hasKoganCreds || activeCodes.has('kogan')) koganFetch.fetch();
    if (hasEbayToken || activeCodes.has('ebay_au')) ebayFetch.fetch();
    if (hasMiraklToken || ['bunnings_marketplace', 'baby_bunting', 'jb_hi_fi'].some(c => activeCodes.has(c))) miraklFetch.fetch();
  }, [connectionsLoaded, universalFetched, activeCodes, hasShopifyToken, hasAmazonToken, hasKoganCreds, hasEbayToken, hasMiraklToken]);

  const visibleTabs = ALL_TABS.filter(t => t.key === 'universal' || hasConnection(t));

  const universalLoading = shopifyFetch.loading || amazonFetch.loading || koganFetch.loading || ebayFetch.loading || miraklFetch.loading;
  const anyPartial = shopifyFetch.partial || amazonFetch.partial || koganFetch.partial || ebayFetch.partial || miraklFetch.partial;
  const platformErrors = [
    shopifyFetch.error && 'Shopify',
    amazonFetch.error && 'Amazon',
    koganFetch.error && 'Kogan',
    ebayFetch.error && 'eBay',
    miraklFetch.error && 'Mirakl',
  ].filter(Boolean);

  const handleSaveRules = async () => {
    await saveRules(rules);
    setRulesOpen(false);
  };

  const handleSaveSkuLink = useCallback(async (link: SkuLink) => {
    const existing = rules.sku_links ?? [];
    // Upsert: merge if canonical already exists
    const idx = existing.findIndex(l => l.canonical === link.canonical);
    let updated: SkuLink[];
    if (idx >= 0) {
      const merged = new Set([...existing[idx].linked, ...link.linked]);
      updated = [...existing];
      updated[idx] = { canonical: link.canonical, linked: Array.from(merged) };
    } else {
      updated = [...existing, link];
    }
    const newRules = { ...rules, sku_links: updated };
    setRules(newRules);
    await saveRules(newRules);
  }, [rules, setRules, saveRules]);

  if (!connectionsLoaded || rulesLoading) {
    return <LoadingSpinner size="lg" text="Loading inventory..." />;
  }

  if (connections.length === 0 && !hasShopifyToken && !hasAmazonToken && !hasEbayToken && !hasMiraklToken) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center space-y-4">
        <PackageOpen className="h-12 w-12 text-muted-foreground/40 mx-auto" />
        <h3 className="text-lg font-semibold text-foreground">No Marketplaces Connected</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Connect your marketplaces in Settings to see your inventory here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-foreground">Inventory</h2>
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Beta</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Live read-only view of your product inventory across all connected platforms.
          </p>
        </div>
        {activeTab === 'universal' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRulesOpen(o => !o)}
            className="text-xs gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Rules
          </Button>
        )}
      </div>

      {/* Rules panel — collapsible, only on Universal tab */}
      {activeTab === 'universal' && (
        <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
          <CollapsibleContent className="pt-1">
            <InventoryRulesPanel
              rules={rules}
              onChange={setRules}
              onSave={handleSaveRules}
              saving={saving}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap border-b border-border pb-0">
        {visibleTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Partial / error banners for Universal */}
      {activeTab === 'universal' && platformErrors.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Failed to load: {platformErrors.join(', ')}. Totals may be incomplete.
        </div>
      )}
      {activeTab === 'universal' && anyPartial && !universalLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Some platforms returned partial results. Totals may not reflect full inventory.
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'universal' && (
        <UniversalInventoryTab
          platformData={{
            shopify: shopifyFetch.data,
            amazon: amazonFetch.data,
            kogan: koganFetch.data,
            ebay: ebayFetch.data,
            mirakl: miraklFetch.data,
          }}
          loading={universalLoading}
          inventoryRules={rules}
        />
      )}
      {activeTab === 'shopify' && <ShopifyInventoryTab />}
      {activeTab === 'amazon' && <AmazonInventoryTab connected={hasAmazonToken} />}
      {activeTab === 'kogan' && <KoganInventoryTab connected={hasKoganCreds} onNavigateToSettings={onNavigateToSettings} />}
      {activeTab === 'ebay' && <EbayInventoryTab connected={hasEbayToken} onNavigateToSettings={onNavigateToSettings} />}
      {activeTab === 'mirakl' && <MiraklInventoryTab connected={hasMiraklToken} onNavigateToSettings={onNavigateToSettings} />}
    </div>
  );
}
