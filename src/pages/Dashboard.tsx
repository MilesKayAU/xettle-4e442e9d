import React, { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useAiPageContext } from '@/ai/context/useAiPageContext';
import { useAiActionTracker } from '@/ai/context/useAiActionTracker';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import SetupWizard from '@/components/onboarding/SetupWizard';
import AccountingDashboard from '@/components/admin/accounting/AccountingDashboard';
import GenericMarketplaceDashboard from '@/components/admin/accounting/GenericMarketplaceDashboard';
import MarketplaceSwitcher, { type UserMarketplace } from '@/components/admin/accounting/MarketplaceSwitcher';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';
import { useDashboardTaskCounts } from '@/hooks/useDashboardTaskCounts';
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
// ConnectionStatusBar removed — connections now shown in SystemStatusStrip
import XettleLogo from '@/components/shared/XettleLogo';
import SystemStatusStrip from '@/components/dashboard/SystemStatusStrip';
import ChannelAlertsBanner from '@/components/dashboard/ChannelAlertsBanner';
import PostSetupBanner from '@/components/dashboard/PostSetupBanner';
import WelcomeGuide from '@/components/dashboard/WelcomeGuide';
import RecentUploads from '@/components/dashboard/RecentUploads';

import ReconciliationHealthPanel from '@/components/dashboard/ReconciliationHealthPanel';

import { Button } from '@/components/ui/button';
import { LogOut, Shield, Settings, Sparkles, FileText, BarChart3, Upload, LayoutDashboard, ClipboardList, ChevronDown, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import CoaDetectedPanel from '@/components/dashboard/CoaDetectedPanel';
import DailyTaskStrip from '@/components/dashboard/DailyTaskStrip';
import DestinationAccountMapper from '@/components/settings/DestinationAccountMapper';
import AccountMapperCard from '@/components/settings/AccountMapperCard';
import PaymentVerificationSettings from '@/components/settings/PaymentVerificationSettings';
import RailPostingSettings from '@/components/settings/RailPostingSettings';
import AccountingBoundarySettings from '@/components/onboarding/AccountingBoundarySettings';
import ApiConnectionsPanel from '@/components/settings/ApiConnectionsPanel';
import DataQualityPanel from '@/components/settings/DataQualityPanel';
import FulfilmentMethodsPanel from '@/components/settings/FulfilmentMethodsPanel';

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

const SETTINGS_HELP: Record<string, string> = {
  api_connections: 'This is where you connect your marketplace accounts (Amazon, eBay, Shopify) and your Xero accounting software. Xettle needs these connections to automatically pull settlement data and push entries into your books. Start by connecting Xero, then add your marketplace(s).',
  destination_accounts: 'Choose which Xero bank, PayPal, or clearing account each payout rail lands in. This controls reconciliation destinations for Amazon, Shopify, PayPal and other payout sources.',
  account_mapper: 'Map each settlement line item (sales, fees, refunds, shipping, etc.) to the correct account in your Xero chart of accounts. This tells Xettle exactly where each dollar should land when invoices or journals are created.',
  posting_mode: 'Choose whether each marketplace rail posts as an Invoice or a Manual Journal in Xero, and set the default tax treatment. Most users start with "Invoice" mode — it’s simpler and works well for GST-registered businesses.',
  accounting_boundary: 'Set the earliest date Xettle should process settlements from. Any settlement before this date will be ignored. This is useful if you’ve already reconciled older periods manually and only want Xettle handling new ones going forward.',
  payment_verification: 'Configure how Xettle matches marketplace payouts to your actual bank deposits. When enabled, we’ll cross-check settlement amounts against your Xero bank feed to confirm the money actually arrived. This adds a verification layer before marking settlements as fully reconciled.',
  fulfilment_methods: 'Tell Xettle how each marketplace fulfils orders — FBA (marketplace ships it), self-ship, or mixed. This affects profit calculations because shipping costs differ. If you self-ship, you can also enter your average postage cost per order.',
  data_quality: 'Tools to fix historical data issues — re-sync marketplace labels, correct misclassified settlements, and clean up any data that was imported incorrectly. Use this if you notice wrong marketplace names or categories on older records.',
};

function SettingsView({ xeroConnected, onConnectXero, onGoToUpload }: { xeroConnected: boolean; onConnectXero: () => void; onGoToUpload: () => void }) {
  const { setupWarnings } = useDashboardTaskCounts();

  const matchesWarningPattern = (patterns: string[], warnKey: string) =>
    patterns.some((pattern) => pattern.endsWith(':') ? warnKey.startsWith(pattern) : warnKey === pattern);

  // Section badges should only reflect section-completion requirements.
  // Advisory nudges still appear in the setup panel, but should not keep a completed section in "Review".
  const sectionStatusRules: Record<string, { completionWarnings: string[] }> = {
    api_connections: { completionWarnings: ['xero_not_connected'] },
    destination_accounts: { completionWarnings: [] },
    account_mapper: { completionWarnings: ['coa_mapping_incomplete', 'coa_mapping_unconfirmed'] },
    posting_mode: { completionWarnings: ['scope_not_acknowledged'] },
    accounting_boundary: { completionWarnings: [] }, // Boundary auto-sets on first upload — no longer a blocker
    payment_verification: { completionWarnings: [] },
    fulfilment_methods: { completionWarnings: ['fulfilment_methods_incomplete'] },
    data_quality: { completionWarnings: [] },
  };

  const getStatus = (sectionKey: string): 'complete' | 'incomplete' | 'warning' | 'none' => {
    const relevantPatterns = sectionStatusRules[sectionKey]?.completionWarnings || [];
    if (relevantPatterns.length === 0) return 'none';

    const activeWarnings = setupWarnings.filter((warning) => matchesWarningPattern(relevantPatterns, warning.key));
    if (activeWarnings.length === 0) return 'complete'; // all resolved → green

    const hasBlocking = activeWarnings.some(w => w.severity === 'blocking');
    if (hasBlocking) return 'incomplete';
    return 'warning';
  };

  const sectionOrder = ['api_connections', 'destination_accounts', 'account_mapper', 'posting_mode', 'accounting_boundary', 'payment_verification', 'fulfilment_methods', 'data_quality'] as const;
  const statusPriority: Record<'incomplete' | 'warning' | 'none' | 'complete', number> = {
    incomplete: 0,
    warning: 1,
    none: 2,
    complete: 3,
  };

  // Sections that are not 100% complete always stay at the top.
  // Within each group (incomplete/warning vs complete/none), preserve the original order.
  const sortedSections = useMemo(() => {
    return [...sectionOrder].sort((a, b) => {
      const byStatus = statusPriority[getStatus(a)] - statusPriority[getStatus(b)];
      return byStatus !== 0 ? byStatus : sectionOrder.indexOf(a) - sectionOrder.indexOf(b);
    });
  }, [setupWarnings]) as typeof sectionOrder extends readonly (infer T)[] ? T[] : never;

  const blockingCount = sectionOrder.filter(k => getStatus(k) === 'incomplete').length;
  const warningOnlyCount = sectionOrder.filter(k => getStatus(k) === 'warning').length;
  const incompleteCount = blockingCount + warningOnlyCount;

  const sectionContent: Record<typeof sectionOrder[number], React.ReactNode> = {
    api_connections: (
      <SettingsAccordion title="API Connections" description="Connect marketplaces and accounting integrations" defaultOpen={sortedSections[0] === 'api_connections'} status={getStatus('api_connections')} helpText={SETTINGS_HELP.api_connections}>
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
    ),
    destination_accounts: (
      <SettingsAccordion id="destination-accounts" title="Destination Accounts" description="Choose where each payout rail lands in Xero" defaultOpen={sortedSections[0] === 'destination_accounts'} status={getStatus('destination_accounts')} helpText={SETTINGS_HELP.destination_accounts}>
        <ErrorBoundary><DestinationAccountMapper /></ErrorBoundary>
      </SettingsAccordion>
    ),
    account_mapper: (
      <SettingsAccordion id="account-mapper" title="Account Mapper" description="Map sales, fees, refunds, and shipping to your Xero chart" defaultOpen={sortedSections[0] === 'account_mapper'} status={getStatus('account_mapper')} helpText={SETTINGS_HELP.account_mapper}>
        <ErrorBoundary><AccountMapperCard /></ErrorBoundary>
      </SettingsAccordion>
    ),
    posting_mode: (
      <SettingsAccordion title="Destination Posting Mode" description="Configure how each marketplace rail posts to Xero" defaultOpen={sortedSections[0] === 'posting_mode'} status={getStatus('posting_mode')} helpText={SETTINGS_HELP.posting_mode}>
        <ErrorBoundary><RailPostingSettings /></ErrorBoundary>
      </SettingsAccordion>
    ),
    accounting_boundary: (
      <SettingsAccordion title="Accounting Boundary" description="Set the start date and backfill horizon for settlement processing" defaultOpen={sortedSections[0] === 'accounting_boundary'} status={getStatus('accounting_boundary')} helpText={SETTINGS_HELP.accounting_boundary}>
        <ErrorBoundary><AccountingBoundarySettings
          xeroConnected={xeroConnected}
          onConnectXero={onConnectXero}
          onGoToUpload={onGoToUpload}
        /></ErrorBoundary>
      </SettingsAccordion>
    ),
    payment_verification: (
      <SettingsAccordion title="Payment Verification" description="Configure payout confirmation and bank matching rules" defaultOpen={sortedSections[0] === 'payment_verification'} status={getStatus('payment_verification')} helpText={SETTINGS_HELP.payment_verification}>
        <ErrorBoundary><PaymentVerificationSettings /></ErrorBoundary>
      </SettingsAccordion>
    ),
    fulfilment_methods: (
      <SettingsAccordion id="fulfilment" title="Fulfilment Methods" description="Set how orders are fulfilled per marketplace — affects profit calculations" defaultOpen={sortedSections[0] === 'fulfilment_methods'} status={getStatus('fulfilment_methods')} helpText={SETTINGS_HELP.fulfilment_methods}>
        <ErrorBoundary><FulfilmentMethodsPanel /></ErrorBoundary>
      </SettingsAccordion>
    ),
    data_quality: (
      <SettingsAccordion title="Data Quality" description="Re-sync marketplace labels and fix historical misclassifications" defaultOpen={sortedSections[0] === 'data_quality'} status={getStatus('data_quality')} helpText={SETTINGS_HELP.data_quality}>
        <ErrorBoundary><DataQualityPanel /></ErrorBoundary>
      </SettingsAccordion>
    ),
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage connections, account mappings, posting rules, and reconciliation preferences.
        </p>
       {incompleteCount > 0 && (
          <div className={`mt-3 flex items-center gap-2 rounded-lg px-4 py-2.5 ${blockingCount > 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-blue-500/10 border border-blue-500/20'}`}>
            <AlertTriangle className={`h-4 w-4 shrink-0 ${blockingCount > 0 ? 'text-amber-600' : 'text-blue-600'}`} />
            <p className="text-sm text-foreground">
              {blockingCount > 0 ? (
                <><strong>{blockingCount} section{blockingCount !== 1 ? 's' : ''}</strong> need{blockingCount === 1 ? 's' : ''} your attention before settlements can post to Xero.{warningOnlyCount > 0 && ` ${warningOnlyCount} more with optional improvements.`}</>
              ) : (
                <>Everything essential is set up! <strong>{warningOnlyCount} section{warningOnlyCount !== 1 ? 's' : ''}</strong> {warningOnlyCount === 1 ? 'has' : 'have'} optional improvements you can review.</>
              )}
            </p>
          </div>
        )}
      </div>

      {sortedSections.map((sectionKey) => (
        <React.Fragment key={sectionKey}>{sectionContent[sectionKey]}</React.Fragment>
      ))}
    </div>
  );
}

function SettingsAccordion({ id, title, description, defaultOpen = false, children, status, helpText }: { id?: string; title: string; description: string; defaultOpen?: boolean; children: React.ReactNode; status?: 'complete' | 'incomplete' | 'warning' | 'none'; helpText?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showHelp, setShowHelp] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.section === id) {
        setOpen(true);
        setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      }
    };
    window.addEventListener('open-settings-section', handler);
    return () => window.removeEventListener('open-settings-section', handler);
  }, [id]);

  const statusIcon = status === 'complete'
    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    : status === 'incomplete'
    ? <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
    : status === 'warning'
    ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
    : null;

  const borderClass = status === 'incomplete'
    ? 'border-destructive/40'
    : status === 'warning'
    ? 'border-amber-500/40'
    : status === 'complete'
    ? 'border-green-500/30'
    : 'border-border';

  return (
    <div ref={ref} className={`rounded-xl border ${borderClass} bg-card overflow-hidden transition-colors`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {statusIcon}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              {status === 'incomplete' && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Action needed</Badge>
              )}
              {status === 'warning' && (
                <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/20 text-[10px] px-1.5 py-0">Review</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {helpText && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setShowHelp(!showHelp); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setShowHelp(!showHelp); } }}
              className="flex items-center justify-center h-6 w-6 rounded-full bg-muted hover:bg-muted/80 transition-colors"
              title="What is this?"
            >
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {showHelp && helpText && (
        <div className="mx-5 mb-2 rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground/80 leading-relaxed">{helpText}</p>
          </div>
        </div>
      )}
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
  const [amazonXettleCode, setAmazonXettleCode] = useState<string>('amazon_au');
  const [hasShopify, setHasShopify] = useState(false);
  const [hasEbay, setHasEbay] = useState(false);
  const [justConnectedXero, setJustConnectedXero] = useState(false);
  const [showAiMapper, setShowAiMapper] = useState(false);
  const [showSetupBanner, setShowSetupBanner] = useState(false);
  const [showBankMappingNudge, setShowBankMappingNudge] = useState(false);
  const [showBankMapper, setShowBankMapper] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<{ marketplace: string; month: string } | null>(null);
  const [settlementStatusFilter, setSettlementStatusFilter] = useState<string | null>(null);

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
          supabase.from('amazon_tokens').select('id, marketplace_id').limit(1),
          supabase.from('shopify_tokens').select('id').limit(1),
          supabase.from('ebay_tokens').select('id').limit(1),
          supabase.from('app_settings').select('value').eq('user_id', user.id).eq('key', 'onboarding_wizard_complete').maybeSingle(),
        ]);

        const hasSettlements = !!(settRes.data && settRes.data.length > 0);
        const hasAmz = !!(amazonRes.data && amazonRes.data.length > 0);
        const hasShp = !!(shopifyRes.data && shopifyRes.data.length > 0);
        const hasEby = !!(ebayRes.data && ebayRes.data.length > 0);
        const wizardComplete = wizardRes.data?.value === 'true';

        // Resolve Amazon xettleCode from their stored marketplace_id
        if (hasAmz && amazonRes.data?.[0]?.marketplace_id) {
          const { getAmazonRegionByMarketplaceId } = await import('@/constants/amazon-regions');
          const region = getAmazonRegionByMarketplaceId(amazonRes.data[0].marketplace_id);
          setAmazonXettleCode(region?.xettleCode || 'amazon_au');
        }

        setHasAmazon(hasAmz);
        setHasShopify(hasShp);
        setHasEbay(hasEby);

        const dismissKey = user ? `xettle_wizard_dismiss_count_${user.id}` : 'xettle_wizard_dismiss_count';
        const dismissCount = parseInt(sessionStorage.getItem(dismissKey) || '0', 10);

        // ALWAYS suppress wizard for established users — settlements or explicit completion
        if (hasSettlements || wizardComplete || dismissCount >= 3) {
          setShowWizard(false);
          // Still clean up ?connected param if present
          if (connected) {
            searchParams.delete('connected');
            setSearchParams(searchParams, { replace: true });
          }
          return;
        }

        // Only show wizard for genuinely new users who have no settlements
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
        console.error("Wizard check failed:", error);
        // Don't show wizard on error — safer to assume established user
        setShowWizard(false);
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
    try {
      const stored = localStorage.getItem('xettle_dashboard_view');
      if (stored === 'dashboard') return 'home';
      if (stored === 'outstanding') { try { localStorage.setItem('xettle_settlements_subtab', 'outstanding'); } catch {} return 'settlements'; }
      if (stored === 'smart_upload') return 'home';
      if (stored === 'home' || stored === 'settlements' || stored === 'insights' || stored === 'settings') return stored as DashboardView;
    } catch { /* storage unavailable */ }
    return 'home';
  });
  const [settlementsSubTab, setSettlementsSubTab] = useState<SettlementsSubTab>(() => {
    try { return (localStorage.getItem('xettle_settlements_subtab') as SettlementsSubTab) || 'overview'; } catch { return 'overview'; }
  });
  const [showUploadSheet, setShowUploadSheet] = useState(false);
  const [insightsSubTab, setInsightsSubTab] = useState<InsightsSubTab>(() => {
    try { return (localStorage.getItem('xettle_insights_subtab') as InsightsSubTab) || 'overview'; } catch { return 'overview'; }
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
        // Separate suggested connections; show active + paused in the switcher
        const visibleConnections = data.filter((m: any) => m.connection_status !== 'suggested');
        const suggested = data.filter((m: any) => m.connection_status === 'suggested');

        setUserMarketplaces(visibleConnections as UserMarketplace[]);
        setSuggestedConnections(suggested);
        setSelectedMarketplace(prev => {
          const activeCodes = visibleConnections.filter((m: any) => m.connection_status !== 'paused');
          if (activeCodes.find((m: any) => m.marketplace_code === prev)) return prev;
          return activeCodes.length > 0 ? activeCodes[0].marketplace_code : visibleConnections[0]?.marketplace_code || '';
        });

        // Fetch settlement counts per marketplace (using count queries, not downloading all rows)
        const codes = visibleConnections.map((m: any) => m.marketplace_code);
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
    try { localStorage.setItem('xettle_dashboard_view', view); } catch { /* storage unavailable */ }
    if (view !== 'settlements') setSettlementStatusFilter(null);
  }

  // Listen for open-settings-tab events from other components (e.g. CoaBlockerCta)
  useEffect(() => {
    const handler = () => switchView('settings');
    window.addEventListener('open-settings-tab', handler);
    return () => window.removeEventListener('open-settings-tab', handler);
  }, []);

  function switchSettlementsSubTab(tab: SettlementsSubTab) {
    setSettlementsSubTab(tab);
    try { localStorage.setItem('xettle_settlements_subtab', tab); } catch {}
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
                onNavigateToSettings={() => switchView('settings')}
                onRefreshStatus={() => {
                  import('@/utils/settlement-engine').then(({ triggerValidationSweep }) => {
                    triggerValidationSweep();
                    toast.success('Status refresh started');
                  });
                }}
              />
              {showBankMapper && (
                <DestinationAccountMapper />
              )}

              {/* CoA-detected channels awaiting confirmation */}
              {suggestedConnections.length > 0 && (
                <CoaDetectedPanel
                  suggestedConnections={suggestedConnections}
                  onChanged={loadMarketplaces}
                />
              )}

              {/* Action Centre — simplified 3-section daily view */}
              <div id="action-centre-section">
              <ActionCentre
                onSwitchToUpload={(missing) => {
                  if (missing) setMissingSettlements(missing);
                  setShowUploadSheet(true);
                }}
                onSwitchToSettlements={(filter) => {
                  if (filter) setSettlementStatusFilter(filter);
                  switchView('settlements');
                  switchSettlementsSubTab('overview');
                }}
                onSwitchToReconciliation={() => {
                  switchView('settlements');
                  switchSettlementsSubTab('reconciliation');
                }}
                userName={user?.email?.split('@')[0]}
              />
              </div>

              {/* Settlements table — only actionable rows */}
              <div id="settlements-table-section">
                <RecentSettlements
                  onViewAll={() => {
                    switchView('settlements');
                    switchSettlementsSubTab('overview');
                  }}
                  pipelineFilter={pipelineFilter}
                  onClearPipelineFilter={() => setPipelineFilter(null)}
                  actionableOnly
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
                    {missingSettlements.length > 0 ? (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 max-w-xl mx-auto text-left">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">📤 Upload needed for:</p>
                        <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                          {missingSettlements.map((m, i) => (
                            <li key={i}>• <strong>{m.marketplace_label}</strong> — {m.period_label}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                        Drop a CSV, XLSX, or PDF from any marketplace. Xettle automatically detects the platform,
                        extracts fees, refunds, sales & GST, and prepares it for Xero.
                      </p>
                    )}
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
                      ...(hasAmazon ? [amazonXettleCode] : []),
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
                onSwitchToUpload={(marketplaceCode, periodLabel) => {
                  if (marketplaceCode && periodLabel) {
                    const label = marketplaceCode.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                    setMissingSettlements([{
                      marketplace_code: marketplaceCode,
                      marketplace_label: label,
                      period_label: periodLabel,
                      period_start: '',
                      period_end: '',
                    }]);
                  }
                  setShowUploadSheet(true);
                }}
                initialFilter={settlementStatusFilter as any}
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


        {/* ─── Settings ──────────────────────────────────────────────── */}
        {activeView === 'settings' && (
          <ErrorBoundary>
            <SettingsView
              xeroConnected={xeroConnected}
              onConnectXero={() => { setWizardInitialStep(2); setShowWizard(true); }}
              onGoToUpload={() => setShowUploadSheet(true)}
            />
          </ErrorBoundary>
        )}
      </div>

    </div>
  );
}
