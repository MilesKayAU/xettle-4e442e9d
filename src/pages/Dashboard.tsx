import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import SetupWizard from '@/components/onboarding/SetupWizard';
import AccountingDashboard from '@/components/admin/accounting/AccountingDashboard';
import GenericMarketplaceDashboard from '@/components/admin/accounting/GenericMarketplaceDashboard';
import MarketplaceSwitcher, { type UserMarketplace } from '@/components/admin/accounting/MarketplaceSwitcher';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';

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
import DashboardConnectionStrip from '@/components/dashboard/DashboardConnectionStrip';
import ChannelAlertsBanner from '@/components/dashboard/ChannelAlertsBanner';
import PostSetupBanner from '@/components/dashboard/PostSetupBanner';
import WelcomeGuide from '@/components/dashboard/WelcomeGuide';
import RecentUploads from '@/components/dashboard/RecentUploads';
import AskAiButton from '@/components/ai-assistant/AskAiButton';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, Settings, Sparkles, FileText, BarChart3, Upload, LayoutDashboard, ClipboardList } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import CoaDetectedPanel from '@/components/dashboard/CoaDetectedPanel';
import PayoutBankAccountMapper from '@/components/settings/PayoutBankAccountMapper';

const SmartUploadFlow = lazy(() => import('@/components/admin/accounting/SmartUploadFlow'));
const ShopifyOrdersDashboard = lazy(() => import('@/components/admin/accounting/ShopifyOrdersDashboard'));
const OutstandingTab = lazy(() => import('@/components/dashboard/OutstandingTab'));

import { ReconciliationSummaryCard } from '@/components/admin/accounting/ReconciliationHub';
const ReconciliationHub = lazy(() => import('@/components/admin/accounting/ReconciliationHub'));

type DashboardView = 'dashboard' | 'outstanding' | 'smart_upload' | 'settlements' | 'insights';
type SettlementsSubTab = 'all' | 'overview' | 'reconciliation';
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
  const [justConnectedXero, setJustConnectedXero] = useState(false);
  const [showAiMapper, setShowAiMapper] = useState(false);
  const [showSetupBanner, setShowSetupBanner] = useState(false);
  const [showBankMappingNudge, setShowBankMappingNudge] = useState(false);

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
        const [settRes, amazonRes, shopifyRes, wizardRes] = await Promise.all([
          supabase.from('settlements').select('id').limit(1),
          supabase.from('amazon_tokens').select('id').limit(1),
          supabase.from('shopify_tokens').select('id').limit(1),
          supabase.from('app_settings').select('value').eq('key', 'onboarding_wizard_complete').maybeSingle(),
        ]);

        const hasSettlements = !!(settRes.data && settRes.data.length > 0);
        const hasAmz = !!(amazonRes.data && amazonRes.data.length > 0);
        const hasShp = !!(shopifyRes.data && shopifyRes.data.length > 0);
        const wizardComplete = wizardRes.data?.value === 'true';

        setHasAmazon(hasAmz);
        setHasShopify(hasShp);

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
    return (localStorage.getItem('xettle_dashboard_view') as DashboardView) || 'dashboard';
  });
  const [settlementsSubTab, setSettlementsSubTab] = useState<SettlementsSubTab>(() => {
    return (localStorage.getItem('xettle_settlements_subtab') as SettlementsSubTab) || 'all';
  });
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
        const { data: flags } = await supabase
          .from('app_settings')
          .select('key, value')
          .in('key', [
            'ai_mapper_status',
            'setup_hub_dismissed',
            'setup_phase3_complete',
            'xero_scan_completed',
            'amazon_scan_completed',
            'shopify_scan_completed',
            'payout_account:_default',
          ]);
        const flagMap = new Map(flags?.map(f => [f.key, f.value]) || []);

        // AI Mapper banner
        setShowAiMapper(flagMap.get('ai_mapper_status') === 'suggested');

        // Bank mapping nudge — show if no default payout account mapped
        setShowBankMappingNudge(!flagMap.has('payout_account:_default'));

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

  // Fetch outstanding (Awaiting Payment) count for badge
  useEffect(() => {
    if (!user) return;
    async function fetchOutstandingCount() {
      const { count } = await supabase
        .from('settlements')
        .select('id', { count: 'exact', head: true })
        .eq('xero_status', 'authorised_in_xero');
      setOutstandingCount(count ?? 0);
    }
    fetchOutstandingCount();
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
        // Separate active channels from suggested (CoA-detected)
        const activeConnections = data.filter((m: any) => m.connection_status !== 'suggested');
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

        const { data: existing } = await supabase
          .from('marketplace_connections')
          .select('id')
          .eq('marketplace_code', marketplace)
          .maybeSingle();

        if (!existing) {
          const catDef = MARKETPLACE_CATALOG.find(m => m.code === marketplace);
          await supabase.from('marketplace_connections').insert({
            user_id: user.id,
            marketplace_code: marketplace,
            marketplace_name: catDef?.name || marketplace,
            country_code: catDef?.country || 'AU',
            connection_type: 'auto_detected',
            connection_status: 'active',
          } as any);
        }

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
      } catch (err) {
        console.error('Failed to claim demo session:', err);
      }
    };
    claimDemo();
  }, [user]);

  function switchView(view: DashboardView) {
    setActiveView(view);
    localStorage.setItem('xettle_dashboard_view', view);
  }

  function switchSettlementsSubTab(tab: SettlementsSubTab) {
    setSettlementsSubTab(tab);
    localStorage.setItem('xettle_settlements_subtab', tab);
  }

  function switchInsightsSubTab(tab: InsightsSubTab) {
    setInsightsSubTab(tab);
    localStorage.setItem('xettle_insights_subtab', tab);
  }

  // ─── AI Assistant context per view ─────────────────────────────
  const aiContext = useMemo(() => {
    const now = new Date();
    const monthLabel = now.toLocaleString('en-AU', { month: 'long', year: 'numeric' });
    if (activeView === 'insights') {
      return { page: 'insights', period: monthLabel, marketplaces: userMarketplaces.map(m => m.marketplace_code) };
    }
    if (activeView === 'settlements') {
      return { page: 'settlements', marketplace: selectedMarketplace, marketplaces: userMarketplaces.map(m => m.marketplace_code) };
    }
    return { page: 'dashboard', month: monthLabel, marketplaces: userMarketplaces.map(m => m.marketplace_code) };
  }, [activeView, selectedMarketplace, userMarketplaces]);

  const aiSuggestedPrompts = useMemo(() => {
    if (activeView === 'insights') return ['Which marketplace is most profitable?', 'Why are my fees so high this month?', 'How does this month compare to last?'];
    if (activeView === 'settlements') return ['Why is this settlement negative?', 'Is this ready to push to Xero?', 'Explain these fees', 'What does this gap mean?'];
    return ['What needs my attention today?', 'Why do I have settlements missing?', 'Am I up to date with Xero?'];
  }, [activeView]);

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

  const settlementSubTabs: { key: SettlementsSubTab; label: string }[] = [
    { key: 'all', label: 'All Settlements' },
    { key: 'overview', label: 'Overview' },
    { key: 'reconciliation', label: 'Reconciliation Hub' },
  ];

  const insightsSubTabs: { key: InsightsSubTab; label: string; pro?: boolean }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'reconciliation', label: 'Reconciliation' },
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
            <Button variant="ghost" size="sm" onClick={() => {
              switchView('settlements');
              setTimeout(() => window.dispatchEvent(new Event('xettle:open-settings')), 100);
            }}>
              <Settings className="h-4 w-4 mr-1" />
              Settings
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin">
                  <Shield className="h-4 w-4 mr-1" />
                  Admin
                </Link>
              </Button>
            )}
            <ConnectionStatusBar onNavigateToSettings={() => {
              switchView('settlements');
              setTimeout(() => window.dispatchEvent(new Event('xettle:open-settings')), 100);
            }} />
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
              { key: 'dashboard' as DashboardView, label: 'Dashboard', icon: LayoutDashboard },
              { key: 'outstanding' as DashboardView, label: 'Outstanding', icon: ClipboardList, badgeCount: outstandingCount },
              { key: 'smart_upload' as DashboardView, label: 'Upload', icon: Upload },
              { key: 'settlements' as DashboardView, label: 'Settlements', icon: FileText },
              { key: 'insights' as DashboardView, label: 'Insights', icon: BarChart3 },
            ]).map(tab => {
              const Icon = tab.icon;
              const isActive = activeView === tab.key;
              const showDot = (tab.key === 'dashboard' && pendingChannelAlerts > 0) || ((tab as any).badgeCount > 0);
              const badgeNum = tab.key === 'dashboard' ? pendingChannelAlerts : (tab as any).badgeCount || 0;
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
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                    settlementsSubTab === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
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
        {activeView === 'dashboard' && <SetupInProgressBanner show={showSetupBanner} />}

        {/* ─── Dashboard (Data hub — tables, actions, validation) ──── */}
        {/* ─── Dashboard (always useful — strip, actions, validation) ──── */}
        {activeView === 'dashboard' && (
          <ErrorBoundary>
            <div className="space-y-6">
              {/* Post-setup scan banner — triggers adaptive sync on first load */}
              <PostSetupBanner
                onSwitchToUpload={() => switchView('smart_upload')}
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

              {/* Compact connection health strip */}
              <DashboardConnectionStrip
                onSwitchToUpload={() => switchView('smart_upload')}
              />

              {/* Bank account mapping nudge */}
              {showBankMappingNudge && xeroConnected && (
                <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Settings className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-foreground">
                      Map your Xero bank accounts to enable deposit matching
                    </span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => {
                    switchView('settlements');
                    setTimeout(() => window.dispatchEvent(new Event('xettle:open-settings')), 100);
                  }}>
                    Map bank accounts
                  </Button>
                </div>
              )}

              {/* AI Account Mapper suggestion banner */}
              <AiMapperBanner show={showAiMapper} />

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
              <ActionCentre
                onSwitchToUpload={(missing) => {
                  if (missing) setMissingSettlements(missing);
                  switchView('smart_upload');
                }}
                onSwitchToSettlements={() => {
                  switchView('settlements');
                  switchSettlementsSubTab('overview');
                }}
                userName={user?.email?.split('@')[0]}
              />

              {/* Recent settlements — real payout/settlement records only */}
              <RecentSettlements
                onViewAll={() => {
                  switchView('settlements');
                  switchSettlementsSubTab('overview');
                }}
              />
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Outstanding (Xero reconciliation action tab) ────────── */}
        {activeView === 'outstanding' && (
          <ErrorBoundary>
            <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
              <OutstandingTab onSwitchToUpload={() => switchView('smart_upload')} />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* ─── Upload Hub — uploader first, everything else below ── */}
        {activeView === 'smart_upload' && (
          <ErrorBoundary>
            <div className="space-y-6">
              {/* Hero message — stronger AI detection messaging */}
              <div className="text-center space-y-2 pt-2">
                <h2 className="text-2xl font-bold text-foreground">
                  Upload any settlement file — Xettle handles the rest
                </h2>
                <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                  Drop a CSV, XLSX, or PDF from any marketplace. Xettle automatically detects the platform,
                  extracts fees, refunds, sales & GST, and prepares it for Xero.
                </p>
                <p className="text-xs text-muted-foreground/70 max-w-md mx-auto">
                  Works alongside your API connections — use automated imports for Amazon & Shopify, 
                  then upload files for everything else. Xettle learns new formats instantly.
                </p>
              </div>

              {/* Smart Upload drop zone — PRIMARY action, front and center */}
              <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
                <SmartUploadFlow
                  onSettlementsSaved={loadMarketplaces}
                  onMarketplacesChanged={loadMarketplaces}
                  onViewSettlements={() => switchView('settlements')}
                  missingSettlements={missingSettlements}
                  onReturnToDashboard={() => {
                    setMissingSettlements([]);
                    switchView('dashboard');
                  }}
                />
              </Suspense>

              {/* Recent uploads — confirmation that files were processed */}
              <RecentUploads />

              {/* Workflow options — below the uploader */}
              <WelcomeGuide
                onUpload={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onConnectStore={() => {
                  setWizardInitialStep(1);
                  setShowWizard(true);
                }}
              />
            </div>
          </ErrorBoundary>
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
                  />
                )}
              </div>

              {/* Marketplace Dashboard Content */}
              {userMarketplaces.length === 0 ? (
                <div className="rounded-lg border border-border bg-card p-8 text-center space-y-3">
                  <h3 className="text-lg font-semibold text-foreground">No marketplaces connected yet</h3>
                  <p className="text-sm text-muted-foreground">Upload a settlement file or connect a store to get started. Xettle will auto-detect your marketplace.</p>
                  <Button onClick={() => switchView('smart_upload')} className="mt-2">
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
                <GenericMarketplaceDashboard marketplace={selectedUserMarketplace} onMarketplacesChanged={loadMarketplaces} onSwitchToUpload={() => switchView('smart_upload')} />
              ) : null}
            </div>
          </ErrorBoundary>
        )}

        {/* ─── Settlements → Overview ────────────────────────────────── */}
        {activeView === 'settlements' && settlementsSubTab === 'overview' && (
          <ErrorBoundary>
            <div className="space-y-6">
              <ValidationSweep
                onSwitchToUpload={() => switchView('smart_upload')}
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
      </div>

      {/* AI Assistant floating button */}
      <AskAiButton
        context={aiContext}
        suggestedPrompts={aiSuggestedPrompts}
      />
    </div>
  );
}
