import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useAiPageContext } from '@/ai/context/useAiPageContext';
import { useAiActionTracker } from '@/ai/context/useAiActionTracker';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import SetupWizard from '@/components/onboarding/SetupWizard';
import AccountingDashboard from '@/components/admin/accounting/AccountingDashboard';
import GenericMarketplaceDashboard from '@/components/admin/accounting/GenericMarketplaceDashboard';
import MarketplaceSwitcher, { type UserMarketplace } from '@/components/admin/accounting/MarketplaceSwitcher';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';
import { toast } from 'sonner';

import ValidationSweep from '@/components/onboarding/ValidationSweep';
import RecentSettlements from '@/components/dashboard/RecentSettlements';
import ActionCentre, { type MissingSettlement } from '@/components/dashboard/ActionCentre';
import InsightsDashboard from '@/components/admin/accounting/InsightsDashboard';
import { ReconciliationHealth } from '@/components/shared/ReconciliationStatus';
import MarketplaceProfitComparison from '@/components/insights/MarketplaceProfitComparison';
import SkuComparisonView from '@/components/insights/SkuComparisonView';
import LoadingSpinner from '@/components/ui/loading-spinner';
import ErrorBoundary from '@/components/ErrorBoundary';
import BugReportNotificationBanner from '@/components/bug-report/BugReportNotificationBanner';
import ConnectionStatusBar from '@/components/shared/ConnectionStatusBar';
import XettleLogo from '@/components/shared/XettleLogo';
import SystemStatusStrip from '@/components/dashboard/SystemStatusStrip';
import ChannelAlertsBanner from '@/components/dashboard/ChannelAlertsBanner';
import PostSetupBanner from '@/components/dashboard/PostSetupBanner';
import WelcomeGuide from '@/components/dashboard/WelcomeGuide';
import RecentUploads from '@/components/dashboard/RecentUploads';
import SyncStatusCard from '@/components/dashboard/SyncStatusCard';

import { Button } from '@/components/ui/button';
import { LogOut, Shield, Settings, Sparkles, FileText, BarChart3, Upload, LayoutDashboard, ClipboardList, ChevronDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import CoaDetectedPanel from '@/components/dashboard/CoaDetectedPanel';
import DailyTaskStrip from '@/components/dashboard/DailyTaskStrip';
import DestinationAccountMapper from '@/components/settings/DestinationAccountMapper';
import AccountMapperCard from '@/components/settings/AccountMapperCard';
import PaymentVerificationSettings from '@/components/settings/PaymentVerificationSettings';
import RailPostingSettings from '@/components/settings/RailPostingSettings';
import AccountingBoundarySettings from '@/components/onboarding/AccountingBoundarySettings';
import ApiConnectionsPanel from '@/components/settings/ApiConnectionsPanel';

const SmartUploadFlow = lazy(() => import('@/components/admin/accounting/SmartUploadFlow'));
const ShopifyOrdersDashboard = lazy(() => import('@/components/admin/accounting/ShopifyOrdersDashboard'));
const OutstandingTab = lazy(() => import('@/components/dashboard/OutstandingTab'));

import { ReconciliationSummaryCard } from '@/components/admin/accounting/ReconciliationHub';
const ReconciliationHub = lazy(() => import('@/components/admin/accounting/ReconciliationHub'));

type DashboardView = 'home' | 'settlements' | 'insights' | 'settings';
type SettlementsSubTab = 'overview' | 'all' | 'outstanding' | 'reconciliation';
type InsightsSubTab = 'overview' | 'reconciliation' | 'profit' | 'sku';

function AiMapperBanner({ show: showProp }: { show?: boolean }) {
  const [show, setShow] = useState(showProp ?? false);
  useEffect(() => { if (showProp !== undefined) setShow(showProp); }, [showProp]);
  if (!show) return null;
  return (
    <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-5 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">
          We've mapped your Xero accounts automatically — review and confirm in Settings
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={() => {
        setShow(false);
        window.dispatchEvent(new CustomEvent('open-settings-tab'));
      }}>
        Review mapping
      </Button>
    </div>
  );
}

function SetupInProgressBanner({ show: showProp }: { show?: boolean }) {
  if (!showProp) return null;
  return (
    <div className="mb-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-lg">⚙️</span>
        <span className="text-sm font-medium text-foreground">
          Your account setup is still in progress — see what's been found so far
        </span>
      </div>
      <a
        href="/setup"
        className="inline-flex items-center gap-1.5 rounded-md bg-background text-primary font-semibold text-sm px-4 py-2 shadow-sm border border-primary/20 hover:bg-primary hover:text-primary-foreground transition-colors"
      >
        Continue setup →
      </a>
    </div>
  );
}

function SettingsAccordion({ title, description, defaultOpen = false, children }: { title: string; description: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, isLoading, user, handleSignOut } = useAdminAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [xeroConnected, setXeroConnected] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardInitialStep, setWizardInitialStep] = useState(1);
  const [hasAmazon, setHasAmazon] = useState(false);
  const [hasShopify, setHasShopify] = useState(false);
  const [hasEbay, setHasEbay] = useState(false);
  const [justConnectedXero, setJustConnectedXero] = useState(false);
  const [showAiMapper, setShowAiMapper] = useState(false);
  const [showSetupBanner, setShowSetupBanner] = useState(false);
  const [showBankMappingNudge, setShowBankMappingNudge] = useState(false);
  const [showBankMapper, setShowBankMapper] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<{ marketplace: string; month: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    const connected = searchParams.get('connected');
    if (connected === 'xero') {
      setXeroConnected(true);
      setJustConnectedXero(true);
    }
    supabase.from('xero_tokens').select('id').limit(1)
      .then(({ data }) => setXeroConnected(!!(data && data.length > 0)));
  }, [user]);

  // ─── Setup wizard pre-check ───────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const isTestMode = searchParams.get('test_wizard') === 'true';
    if (isTestMode) {
      const connected = searchParams.get('connected');
      if (connected === 'amazon' || connected === 'shopify') setWizardInitialStep(2);
      else if (connected === 'xero') setWizardInitialStep(2);
      setShowWizard(true);
      return;
    }
    const connected = searchParams.get('connected');
    const checkWizard = async () => {
      try {
      const [settRes, amazonRes, shopifyRes, ebayRes, wizardRes] = await Promise.all([
          supabase.from('settlements').select('id').limit(1),
          supabase.from('amazon_tokens').select('id').limit(1),
          supabase.from('shopify_tokens').select('id').limit(1),
          supabase.from('ebay_tokens').select('id').limit(1),
          supabase.from('app_settings').select('value').eq('key', 'onboarding_wizard_complete').maybeSingle(),
        ]);

        const hasSettlements = !!(settRes.data && settRes.data.length > 0);
        const hasAmz = !!(amazonRes.data && amazonRes.data.length > 0);
        const hasShp = !!(shopifyRes.data && shopifyRes.data.length > 0);
        const hasEby = !!(ebayRes.data && ebayRes.data.length > 0);
        const wizardComplete = wizardRes.data?.value === 'true';

        setHasAmazon(hasAmz);
        setHasShopify(hasShp);
        setHasEbay(hasEby);

        const dismissKey = user ? `xettle_wizard_dismiss_count_${user.id}` : 'xettle_wizard_dismiss_count';
        const dismissCount = parseInt(sessionStorage.getItem(dismissKey) || '0', 10);

        // If user just connected via OAuth callback, always show wizard regardless of existing data
        if (connected) {
          // Don't skip — let the wizard handle the post-connection flow
        } else if (hasSettlements || wizardComplete || dismissCount >= 3) {
          setShowWizard(false);
          return;
        }

        if (!hasAmz || !hasShp || !xeroConnected) {
          if (connected === 'amazon' || connected === 'shopify') {
            setWizardInitialStep(2);
            if (connected === 'amazon') setHasAmazon(true);
            if (connected === 'shopify') setHasShopify(true);
          } else if (connected === 'xero') {
            setWizardInitialStep(2);
          }
          if (connected) {
            searchParams.delete('connected');
            setSearchParams(searchParams, { replace: true });
          }
          setShowWizard(true);
        }
      } catch (error) {
        console.error("Wizard check failed, defaulting to show:", error);
        setShowWizard(true);
      }
    };
    checkWizard();
  }, [user, xeroConnected]);

  const handleWizardClose = () => {
    const dismissKey = user ? `xettle_wizard_dismiss_count_${user.id}` : 'xettle_wizard_dismiss_count';
    const count = parseInt(sessionStorage.getItem(dismissKey) || '0', 10) + 1;
    sessionStorage.setItem(dismissKey, String(count));
    setShowWizard(false);
  };

  const handleWizardComplete = async () => {
    setShowWizard(false);
    sessionStorage.removeItem('xettle_setup_step');
    try {
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', 'onboarding_wizard_complete')
        .maybeSingle();
      if (existing) {
        await supabase.from('app_settings').update({ value: 'true' }).eq('id', existing.id);
      } else {
        await supabase.from('app_settings').insert({
          user_id: user!.id,
          key: 'onboarding_wizard_complete',
          value: 'true',
        });
      }
    } catch {}
  };

  // Dashboard is always the default landing page
  const [activeView, setActiveView] = useState<DashboardView>(() => {
    const stored = localStorage.getItem('xettle_dashboard_view');
    // Migrate legacy view names
    if (stored === 'dashboard') return 'home';
    if (stored === 'outstanding') { localStorage.setItem('xettle_settlements_subtab', 'outstanding'); return 'settlements'; }
    if (stored === 'smart_upload') return 'home';
    if (stored === 'home' || stored === 'settlements' || stored === 'insights' || stored === 'settings') return stored as DashboardView;
    return 'home';
  });
  const [settlementsSubTab, setSettlementsSubTab] = useState<SettlementsSubTab>(() => {
    return (localStorage.getItem('xettle_settlements_subtab') as SettlementsSubTab) || 'overview';
  });
  const [showUploadSheet, setShowUploadSheet] = useState(false);
  const [insightsSubTab, setInsightsSubTab] = useState<InsightsSubTab>(() => {
    return (localStorage.getItem('xettle_insights_subtab') as InsightsSubTab) || 'overview';
  });
  const [userMarketplaces, setUserMarketplaces] = useState<UserMarketplace[]>([]);
  const [suggestedConnections, setSuggestedConnections] = useState<any[]>([]);
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('');
  const [marketplacesLoading, setMarketplacesLoading] = useState(true);
  const [missingSettlements, setMissingSettlements] = useState<MissingSettlement[]>([]);
  const [pendingChannelAlerts, setPendingChannelAlerts] = useState(0);
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [settlementCounts, setSettlementCounts] = useState<Record<string, number>>({});
  const [readyToPushCount, setReadyToPushCount] = useState(0);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/auth');
    }
  }, [isLoading, isAuthenticated, navigate]);

  useEffect(() => {
    async function checkAdmin() {
      if (!user) return;
      const { data } = await supabase.rpc('has_role', { _role: 'admin' });
      setIsAdmin(!!data);
    }
    checkAdmin();
  }, [user]);

  // ─── Consolidated app_settings query (banners + flags) ────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        // Fetch fixed keys + any payout_account:% mappings in parallel
        const [flagsResp, destResp, legacyResp, mappingResp, userRes] = await Promise.all([
          supabase
            .from('app_settings')
            .select('key, value, updated_at')
            .in('key', [
              'ai_mapper_status',
              'setup_hub_dismissed',
              'setup_phase3_complete',
              'xero_scan_completed',
              'amazon_scan_completed',
              'shopify_scan_completed',
            ]),
          supabase
            .from('app_settings')
            .select('key')
            .like('key', 'payout_destination:%')
            .limit(1),
          supabase
            .from('app_settings')
            .select('key')
            .like('key', 'payout_account:%')
            .limit(1),
          // Fetch confirmed mapping timestamp from app_settings
          supabase
            .from('app_settings')
            .select('key, value, updated_at')
            .eq('key', 'accounting_xero_account_codes'),
          supabase.auth.getUser(),
        ]);
        const flagMap = new Map(flagsResp.data?.map(f => [f.key, f.value]) || []);

        // Bank mapping nudge — show if NO destination mapping exists (check both namespaces)
        const hasAnyDestMapping = (destResp.data?.length || 0) > 0 || (legacyResp.data?.length || 0) > 0;
        setShowBankMappingNudge(!hasAnyDestMapping);

        // AI Mapper banner — conditional logic:
        // Show only when: mapping_blocking (missing dest), user is new (<7d), or mapping recently changed
        const aiMapperStatus = flagMap.get('ai_mapper_status');
        const mappingBlockingCount = hasAnyDestMapping ? 0 : 1; // simplified: 0 if any dest mapped
        const userCreated = userRes.data?.user?.created_at ? new Date(userRes.data.user.created_at) : null;
        const userIsNew = userCreated ? (Date.now() - userCreated.getTime()) < 7 * 86400000 : false;
        const mappingLastChanged = (mappingResp.data && mappingResp.data.length > 0)
          ? new Date(mappingResp.data[0].updated_at!)
          : null;
        const mappingRecentlyChanged = mappingLastChanged
          ? (Date.now() - mappingLastChanged.getTime()) < 7 * 86400000
          : false;

        // Only show AI mapper banner if there's an actual reason
        const shouldShowMapper = aiMapperStatus === 'suggested' && (
          mappingBlockingCount > 0 ||
          userIsNew ||
          mappingRecentlyChanged
        );
        setShowAiMapper(shouldShowMapper);

        // Setup in progress banner
        const dismissed = flagMap.get('setup_hub_dismissed') === 'true';
        const phase3Done = flagMap.get('setup_phase3_complete') === 'true';
        if (!dismissed && !phase3Done) {
          const allScansComplete =
            (flagMap.get('xero_scan_completed') === 'true' || !flagMap.has('xero_scan_completed')) &&
            (flagMap.get('amazon_scan_completed') === 'true' || !flagMap.has('amazon_scan_completed')) &&
            (flagMap.get('shopify_scan_completed') === 'true' || !flagMap.has('shopify_scan_completed'));
          const hasAnyScan = flagMap.has('xero_scan_completed') || flagMap.has('amazon_scan_completed') || flagMap.has('shopify_scan_completed');
          if (!(hasAnyScan && allScansComplete)) {
            setShowSetupBanner(true);
          }
        }
      } catch {}
    })();
  }, [user]);

  // Fetch outstanding (Awaiting Payment) count + ready_to_push count for badges
  useEffect(() => {
    if (!user) return;
    async function fetchBadgeCounts() {
      const [outstanding, ready] = await Promise.all([
        supabase.from('settlements').select('id', { count: 'exact', head: true })
          .eq('xero_status', 'authorised_in_xero'),
        supabase.from('settlements').select('id', { count: 'exact', head: true })
          .eq('status', 'ready_to_push').eq('is_hidden', false).eq('is_pre_boundary', false),
      ]);
      setOutstandingCount(outstanding.count ?? 0);
      setReadyToPushCount(ready.count ?? 0);
    }
    fetchBadgeCounts();
  }, [user]);

  const loadMarketplaces = useCallback(async () => {
    if (!user) return;
    setMarketplacesLoading(true);
    try {
      const { data, error } = await supabase
        .from('marketplace_connections')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        // Separate active channels from suggested and paused (CoA-detected / user-hidden)
        const activeConnections = data.filter((m: any) => m.connection_status !== 'suggested' && m.connection_status !== 'paused');
        const suggested = data.filter((m: any) => m.connection_status === 'suggested');

        setUserMarketplaces(activeConnections as UserMarketplace[]);
        setSuggestedConnections(suggested);
        setSelectedMarketplace(prev => {
          if (activeConnections.find((m: any) => m.marketplace_code === prev)) return prev;
          return activeConnections.length > 0 ? activeConnections[0].marketplace_code : '';
        });

        // Fetch settlement counts per marketplace (using count queries, not downloading all rows)
        const codes = activeConnections.map((m: any) => m.marketplace_code);
        const counts: Record<string, number> = {};
        const countPromises = codes.map(async (code: string) => {
          const { count } = await supabase
            .from('settlements')
            .select('id', { count: 'exact', head: true })
            .eq('marketplace', code);
          counts[code] = count ?? 0;
        });
        await Promise.all(countPromises);
        setSettlementCounts(counts);
      } else {
        setUserMarketplaces([]);
        setSuggestedConnections([]);
        setSelectedMarketplace('');
        setSettlementCounts({});
      }
    } catch {
      // silently fail
    } finally {
      setMarketplacesLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadMarketplaces();
      provisionAllMarketplaceConnections(user.id).catch(err =>
        console.warn('[dashboard] ghost cleanup failed:', err)
      );
    }
  }, [user, loadMarketplaces]);

  // First-load heavy bootstrap scan removed to avoid duplicate API storms.
  // PostSetupBanner owns adaptive scanning and retry UX.

  // ─── Claim demo session (post-signup from landing page) ───────────────────
  useEffect(() => {
    if (!user) return;
    const claimDemo = async () => {
      try {
        const raw = sessionStorage.getItem('xettle_demo_settlements');
        const marketplace = sessionStorage.getItem('xettle_demo_marketplace');
        if (!raw || !marketplace) return;

        const settlements = JSON.parse(raw);
        if (!Array.isArray(settlements) || settlements.length === 0) return;

        sessionStorage.removeItem('xettle_demo_settlements');
        sessionStorage.removeItem('xettle_demo_marketplace');

        const { saveSettlement } = await import('@/utils/settlement-engine');
        const { MARKETPLACE_CATALOG } = await import('@/components/admin/accounting/MarketplaceSwitcher');

        const { upsertMarketplaceConnection } = await import('@/utils/marketplace-connections');
        const catDef = MARKETPLACE_CATALOG.find(m => m.code === marketplace);
        await upsertMarketplaceConnection({
          userId: user.id,
          marketplaceCode: marketplace,
          marketplaceName: catDef?.name || marketplace,
          connectionType: 'auto_detected',
          connectionStatus: 'active',
          countryCode: catDef?.country || 'AU',
        });

        let saved = 0;
        for (const s of settlements) {
          const result = await saveSettlement(s);
          if (result.success) saved++;
        }

        if (saved > 0) {
          const { toast } = await import('sonner');
          toast.success(`🎉 ${saved} settlement${saved > 1 ? 's' : ''} from your demo — ready to push to Xero!`);
        }

        await loadMarketplaces();
        setSelectedMarketplace(marketplace);
        switchView('settlements');
        switchSettlementsSubTab('all');
      } catch (err) {
        console.error('Failed to claim demo session:', err);
      }
    };
    claimDemo();
  }, [user]);

  const trackAction = useAiActionTracker();

  function switchView(view: DashboardView) {
    setActiveView(view);
    trackAction('switched_tab', view);
    localStorage.setItem('xettle_dashboard_view', view);
  }

  // Listen for open-settings-tab events from other components (e.g. CoaBlockerCta)
  useEffect(() => {
    const handler = () => switchView('settings');
    window.addEventListener('open-settings-tab', handler);
    return () => window.removeEventListener('open-settings-tab', handler);
  }, []);

  function switchSettlementsSubTab(tab: SettlementsSubTab) {
    setSettlementsSubTab(tab);
    localStorage.setItem('xettle_settlements_subtab', tab);
  }

  function switchInsightsSubTab(tab: InsightsSubTab) {
    setInsightsSubTab(tab);
    localStorage.setItem('xettle_insights_subtab', tab);
  }

  // ─── AI Assistant context (sitewide via AiContextProvider) ─────
  const aiRouteId = activeView === 'settings' ? 'settings' as const
    : activeView === 'insights' ? 'insights' as const
    : activeView === 'settlements' ? (settlementsSubTab === 'outstanding' ? 'outstanding' as const : 'settlements' as const)
    : 'dashboard' as const;

  const aiSuggestedPrompts = useMemo(() => {
    if (activeView === 'insights') return ['Which marketplace is most profitable?', 'Why are my fees so high this month?', 'How does this month compare to last?'];
    if (activeView === 'settlements' && settlementsSubTab === 'outstanding') return ['Are these invoices pushed to Xero?', 'Which settlements are ready to push?', 'What does matched exact mean?'];
    if (activeView === 'settlements') return ['Why is this settlement negative?', 'Is this ready to push to Xero?', 'Explain these fees'];
    return ['What needs my attention today?', 'Why do I have settlements missing?', 'Am I up to date with Xero?'];
  }, [activeView, settlementsSubTab]);

  useAiPageContext(() => ({
    routeId: aiRouteId,
    pageTitle: activeView === 'settlements' ? (settlementsSubTab === 'outstanding' ? 'Awaiting Payment' : 'Settlements')
      : activeView === 'insights' ? 'Insights'
      : activeView === 'settings' ? 'Settings'
      : 'Home',
    primaryEntities: {
      marketplace_codes: userMarketplaces.map(m => m.marketplace_code),
    },
    pageStateSummary: {
      active_marketplaces: userMarketplaces.length,
      outstanding_count: outstandingCount,
      ready_to_push: readyToPushCount,
      selected_marketplace: selectedMarketplace || 'none',
      xero_connected: xeroConnected,
    },
    suggestedPrompts: aiSuggestedPrompts,
    capabilities: ['view_settlements', 'view_outstanding', 'view_insights'],
  }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" text="Loading..." />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const isAmazonAU = selectedMarketplace === 'amazon_au';
  const isShopifyOrders = selectedMarketplace === 'shopify_orders';
  const selectedUserMarketplace = userMarketplaces.find(m => m.marketplace_code === selectedMarketplace);

  const settlementSubTabs: { key: SettlementsSubTab; label: string; badgeCount?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'all', label: 'All Settlements' },
    { key: 'outstanding', label: 'Awaiting Payment', badgeCount: outstandingCount },
    { key: 'reconciliation', label: 'Action Queue' },
  ];

  const insightsSubTabs: { key: InsightsSubTab; label: string; pro?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'reconciliation', label: 'Reconciliation Health' },
    { key: 'profit', label: 'Profit Analysis', pro: true },
    { key: 'sku', label: 'SKU Comparison', pro: true },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SetupWizard
        open={showWizard}
        onClose={handleWizardClose}
        onComplete={handleWizardComplete}
        initialStep={wizardInitialStep}
        hasAmazon={hasAmazon}
        hasShopify={hasShopify}
        hasXero={xeroConnected}
        justConnectedXero={justConnectedXero}
      />
      {/* Top bar */}
      <header className="border-b border-border bg-card">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center">
            <XettleLogo height={32} />
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/pricing">
                <Sparkles className="h-4 w-4 mr-1" />
                Plans
              </Link>
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin">
                  <Shield className="h-4 w-4 mr-1" />
                  Admin
                </Link>
              </Button>
            )}
            <ConnectionStatusBar onNavigateToSettings={() => switchView('settings')} />
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-1" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Primary tab bar */}
      <div className="border-b border-border bg-card/50">
        <div className="container-custom">
          <nav className="flex gap-1 py-2">
            {([
              { key: 'home' as DashboardView, label: 'Home', icon: LayoutDashboard },
              { key: 'settlements' as DashboardView, label: 'Settlements', icon: FileText, badgeCount: readyToPushCount + outstandingCount },
              { key: 'insights' as DashboardView, label: 'Insights', icon: BarChart3 },
              { key: 'settings' as DashboardView, label: 'Settings', icon: Settings },
            ]).map(tab => {
              const Icon = tab.icon;
              const isActive = activeView === tab.key;
              const showDot = (tab.key === 'home' && pendingChannelAlerts > 0) || ((tab as any).badgeCount > 0);
              const badgeNum = tab.key === 'home' ? pendingChannelAlerts : (tab as any).badgeCount || 0;
              return (
                <button
                  key={tab.key}
                  onClick={() => switchView(tab.key)}
                  className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  {showDot && badgeNum > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                      {badgeNum}
                    </span>
                  )}
                </button>
              );
            })}
            {/* Upload action button — always visible in nav */}
            <button
              onClick={() => setShowUploadSheet(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ml-auto bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground border border-primary/20"
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>
          </nav>
        </div>
      </div>

      {/* Sub-tab bar for Settlements and Insights */}
      {(activeView === 'settlements' || activeView === 'insights') && (
        <div className="border-b border-border/60 bg-muted/30">
          <div className="container-custom">
            <nav className="flex gap-0.5 -mb-px">
              {activeView === 'settlements' && settlementSubTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => switchSettlementsSubTab(tab.key)}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                    settlementsSubTab === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  {tab.badgeCount && tab.badgeCount > 0 ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive text-destructive-foreground font-bold">{tab.badgeCount}</span>
                  ) : null}
                </button>
              ))}
              {activeView === 'insights' && insightsSubTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => switchInsightsSubTab(tab.key)}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                    insightsSubTab === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  {tab.pro && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-semibold">PRO</span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      <div className="container-custom py-8">
        <BugReportNotificationBanner />
        {activeView === 'home' && <SetupInProgressBanner show={showSetupBanner} />}

        {/* ─── Home (command centre — strip, actions, status) ──── */}
        {activeView === 'home' && (
          <ErrorBoundary>
            <div className="space-y-6">
              {/* Today's Tasks — what needs doing right now */}
              <DailyTaskStrip
                onNavigate={(view, subTab) => {
                  switchView(view as DashboardView);
                  if (subTab) switchSettlementsSubTab(subTab as SettlementsSubTab);
                }}
                onScrollToActionCentre={() => {
                  setTimeout(() => {
                    document.getElementById('action-centre-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 100);
                }}
              />
              {/* Post-setup scan banner — triggers adaptive sync on first load */}
              <PostSetupBanner
                onSwitchToUpload={() => setShowUploadSheet(true)}
                hasXero={xeroConnected}
                hasAmazon={hasAmazon}
                hasShopify={hasShopify}
                onConnectXero={() => {
                  setWizardInitialStep(1);
                  setShowWizard(true);
                }}
                onConnectAmazon={() => {
                  setWizardInitialStep(2);
                  setShowWizard(true);
                }}
                onConnectShopify={() => {
                  setWizardInitialStep(2);
                  setShowWizard(true);
                }}
                onScanComplete={loadMarketplaces}
              />

              {/* System status — consolidated connections + actions */}
              <SystemStatusStrip
                showAiMapper={showAiMapper}
                showBankMappingNudge={showBankMappingNudge}
                xeroConnected={xeroConnected}
                onReviewMapping={() => {
                  window.dispatchEvent(new CustomEvent('open-settings-tab'));
                }}
                onMapBankAccounts={() => setShowBankMapper(!showBankMapper)}
                onConnect={() => setShowUploadSheet(true)}
                onRefreshStatus={() => {
                  // Trigger the validation sweep via ActionCentre's existing mechanism
                  import('@/utils/settlement-engine').then(({ triggerValidationSweep }) => {
                    triggerValidationSweep();
                    toast.success('Status refresh started');
                  });
                }}
              />
              {showBankMapper && (
                <DestinationAccountMapper />
              )}

              {/* Sync activity — per-rail last sync + manual trigger */}
              <SyncStatusCard />

              {/* CoA-detected channels awaiting confirmation */}
              {suggestedConnections.length > 0 && (
                <CoaDetectedPanel
                  suggestedConnections={suggestedConnections}
                  onChanged={loadMarketplaces}
                />
              )}

              {/* Channel alerts — accounting health info */}
              <ChannelAlertsBanner onAlertCountChange={setPendingChannelAlerts} />

              {/* Action Centre — what needs attention */}
              <div id="action-centre-section">
              <ActionCentre
                onSwitchToUpload={(missing) => {
                  if (missing) setMissingSettlements(missing);
                  setShowUploadSheet(true);
                }}
                onSwitchToSettlements={() => {
                  switchView('settlements');
                  switchSettlementsSubTab('overview');
                }}
                onSwitchToReconciliation={() => {
                  switchView('settlements');
                  switchSettlementsSubTab('reconciliation');
                }}
                userName={user?.email?.split('@')[0]}
                onPipelineFilter={(marketplace, month) => {
                  setPipelineFilter({ marketplace, month });
                  // Scroll to settlements table
                  setTimeout(() => {
                    document.getElementById('settlements-table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 100);
                }}
              />
              </div>

              {/* Recent settlements — real payout/settlement records only */}
              <div id="settlements-table-section">
                <RecentSettlements
                  onViewAll={() => {
                    switchView('settlements');
                    switchSettlementsSubTab('overview');
                  }}
                  pipelineFilter={pipelineFilter}
                  onClearPipelineFilter={() => setPipelineFilter(null)}
                />
              </div>
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Settlements → Awaiting Payment ──────────────────────── */}
        {activeView === 'settlements' && settlementsSubTab === 'outstanding' && (
          <ErrorBoundary>
            <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
              <OutstandingTab onSwitchToUpload={() => setShowUploadSheet(true)} />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* ─── Upload Sheet (modal overlay) ─────────────────────────── */}
        {showUploadSheet && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
            <div className="fixed inset-x-0 top-0 bottom-0 z-50 overflow-y-auto bg-background">
              <div className="container-custom py-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="text-center flex-1 space-y-2">
                    <h2 className="text-2xl font-bold text-foreground">
                      Upload any settlement file — Xettle handles the rest
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                      Drop a CSV, XLSX, or PDF from any marketplace. Xettle automatically detects the platform,
                      extracts fees, refunds, sales & GST, and prepares it for Xero.
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setShowUploadSheet(false); setMissingSettlements([]); }} className="shrink-0 ml-4">
                    ✕ Close
                  </Button>
                </div>
                <ErrorBoundary>
                  <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
                    <SmartUploadFlow
                      onSettlementsSaved={loadMarketplaces}
                      onMarketplacesChanged={loadMarketplaces}
                      onViewSettlements={() => { setShowUploadSheet(false); switchView('settlements'); }}
                      missingSettlements={missingSettlements}
                      onReturnToDashboard={() => {
                        setMissingSettlements([]);
                        setShowUploadSheet(false);
                      }}
                    />
                  </Suspense>
                  <RecentUploads />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        )}

        {/* ─── Settlements → All Settlements ─────────────────────────── */}
        {activeView === 'settlements' && settlementsSubTab === 'all' && (
          <ErrorBoundary>
            <div className="space-y-6">
              {/* Marketplace Switcher */}
              <div>
                {!marketplacesLoading && (
                  <MarketplaceSwitcher
                    selectedMarketplace={selectedMarketplace}
                    onMarketplaceChange={setSelectedMarketplace}
                    userMarketplaces={userMarketplaces}
                    onMarketplacesChanged={loadMarketplaces}
                    settlementCounts={settlementCounts}
                    apiConnectedCodes={new Set([
                      ...(hasAmazon ? ['amazon_au'] : []),
                      ...(hasShopify ? ['shopify_payments', 'shopify_orders'] : []),
                      ...(hasEbay ? ['ebay_au'] : []),
                    ])}
                  />
                )}
              </div>

              {/* Marketplace Dashboard Content */}
              {userMarketplaces.length === 0 ? (
                <div className="rounded-lg border border-border bg-card p-8 text-center space-y-3">
                  <h3 className="text-lg font-semibold text-foreground">No marketplaces connected yet</h3>
                  <p className="text-sm text-muted-foreground">Upload a settlement file or connect a store to get started. Xettle will auto-detect your marketplace.</p>
                  <Button onClick={() => setShowUploadSheet(true)} className="mt-2">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Your First File
                  </Button>
                </div>
              ) : isAmazonAU ? (
                <AccountingDashboard />
              ) : isShopifyOrders && selectedUserMarketplace ? (
                <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
                  <ShopifyOrdersDashboard onMarketplacesChanged={loadMarketplaces} />
                </Suspense>
              ) : selectedUserMarketplace ? (
                <GenericMarketplaceDashboard marketplace={selectedUserMarketplace} onMarketplacesChanged={loadMarketplaces} onSwitchToUpload={() => setShowUploadSheet(true)} />
              ) : null}
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Settlements → Overview ────────────────────────────────── */}
        {activeView === 'settlements' && settlementsSubTab === 'overview' && (
          <ErrorBoundary>
            <div className="space-y-6">
              <ValidationSweep
                onSwitchToUpload={() => setShowUploadSheet(true)}
              />
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Settlements → Reconciliation Hub ──────────────────────── */}
        {activeView === 'settlements' && settlementsSubTab === 'reconciliation' && (
          <ErrorBoundary>
            <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
              <ReconciliationHub />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* ─── Insights → Overview ───────────────────────────────────── */}
        {activeView === 'insights' && insightsSubTab === 'overview' && (
          <ErrorBoundary>
            <InsightsDashboard />
          </ErrorBoundary>
        )}

        {/* ─── Insights → Reconciliation ─────────────────────────────── */}
        {activeView === 'insights' && insightsSubTab === 'reconciliation' && (
          <ErrorBoundary>
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Reconciliation</h2>
                <p className="text-muted-foreground mt-1">
                  Settlement vs order reconciliation across all connected marketplaces.
                </p>
              </div>
              <ReconciliationHealth />
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Insights → Profit Analysis ────────────────────────────── */}
        {activeView === 'insights' && insightsSubTab === 'profit' && (
          <ErrorBoundary>
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Profit Analysis</h2>
                <p className="text-muted-foreground mt-1">
                  Cross-marketplace profit ranking and margin comparison.
                </p>
              </div>
              <MarketplaceProfitComparison />
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Insights → SKU Comparison ─────────────────────────────── */}
        {activeView === 'insights' && insightsSubTab === 'sku' && (
          <ErrorBoundary>
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">SKU Comparison</h2>
                <p className="text-muted-foreground mt-1">
                  Compare SKU-level profitability across marketplaces.
                </p>
              </div>
              <SkuComparisonView />
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Settings ──────────────────────────────────────────────── */}
        {activeView === 'settings' && (
          <ErrorBoundary>
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Settings</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Manage connections, account mappings, posting rules, and reconciliation preferences.
                </p>
              </div>

              <SettingsAccordion title="API Connections" description="Connect marketplaces and accounting integrations" defaultOpen>
                <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
                  <ApiConnectionsPanel
                    isPaid={true}
                    syncCutoffDate={undefined}
                    onSettlementsAutoFetched={async () => {}}
                    onRequestSettings={() => {}}
                    onFetchStateChange={() => {}}
                  />
                </Suspense>
              </SettingsAccordion>

              <SettingsAccordion title="Destination Accounts" description="Map settlement line items to your Xero chart of accounts">
                <DestinationAccountMapper />
              </SettingsAccordion>

              <SettingsAccordion title="Account Mapper" description="AI-assisted account code suggestions and overrides">
                <AccountMapperCard />
              </SettingsAccordion>

              <SettingsAccordion title="Destination Posting Mode" description="Configure how each marketplace rail posts to Xero">
                <RailPostingSettings />
              </SettingsAccordion>

              <SettingsAccordion title="Accounting Boundary" description="Set the start date and backfill horizon for settlement processing">
                <AccountingBoundarySettings
                  xeroConnected={xeroConnected}
                  onConnectXero={() => {
                    setWizardInitialStep(2);
                    setShowWizard(true);
                  }}
                  onGoToUpload={() => setShowUploadSheet(true)}
                />
              </SettingsAccordion>

              <SettingsAccordion title="Payment Verification" description="Configure payout confirmation and bank matching rules">
                <PaymentVerificationSettings />
              </SettingsAccordion>
            </div>
          </ErrorBoundary>
        )}
      </div>

    </div>
  );
}
