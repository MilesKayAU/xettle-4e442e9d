import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import AccountingDashboard from '@/components/admin/accounting/AccountingDashboard';
import GenericMarketplaceDashboard from '@/components/admin/accounting/GenericMarketplaceDashboard';
import BunningsDashboard from '@/components/admin/accounting/BunningsDashboard';
import ShopifyPaymentsDashboard from '@/components/admin/accounting/ShopifyPaymentsDashboard';
import MarketplaceSwitcher, { type UserMarketplace } from '@/components/admin/accounting/MarketplaceSwitcher';
import InsightsDashboard from '@/components/admin/accounting/InsightsDashboard';
import LoadingSpinner from '@/components/ui/loading-spinner';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, Settings, Sparkles, FileText, BarChart3, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { supabase } from '@/integrations/supabase/client';

const SmartUploadFlow = lazy(() => import('@/components/admin/accounting/SmartUploadFlow'));

type DashboardView = 'settlements' | 'insights' | 'smart_upload';

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user, handleSignOut } = useAdminAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeView, setActiveView] = useState<DashboardView>(() => {
    return (localStorage.getItem('xettle_dashboard_view') as DashboardView) || 'smart_upload';
  });
  const [userMarketplaces, setUserMarketplaces] = useState<UserMarketplace[]>([]);
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>('amazon_au');
  const [marketplacesLoading, setMarketplacesLoading] = useState(true);

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
        setUserMarketplaces(data as UserMarketplace[]);
        if (!data.find((m: any) => m.marketplace_code === selectedMarketplace)) {
          setSelectedMarketplace(data[0].marketplace_code);
        }
      } else {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          const { error: insertErr } = await supabase
            .from('marketplace_connections')
            .insert({
              user_id: authUser.id,
              marketplace_code: 'amazon_au',
              marketplace_name: 'Amazon AU',
              country_code: 'AU',
              connection_type: 'sp_api',
              connection_status: 'active',
            } as any);

          if (!insertErr) {
            const { data: reloaded } = await supabase
              .from('marketplace_connections')
              .select('*')
              .order('created_at', { ascending: true });
            if (reloaded) setUserMarketplaces(reloaded as UserMarketplace[]);
          }
        }
        setSelectedMarketplace('amazon_au');
      }
    } catch {
      // silently fail
    } finally {
      setMarketplacesLoading(false);
    }
  }, [user, selectedMarketplace]);

  useEffect(() => {
    if (user) loadMarketplaces();
  }, [user]);

  function switchView(view: DashboardView) {
    setActiveView(view);
    localStorage.setItem('xettle_dashboard_view', view);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" text="Loading..." />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const isAmazonAU = selectedMarketplace === 'amazon_au';
  const isBunnings = selectedMarketplace === 'bunnings';
  const isShopifyPayments = selectedMarketplace === 'shopify_payments';
  const selectedUserMarketplace = userMarketplaces.find(m => m.marketplace_code === selectedMarketplace);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-bold text-foreground tracking-tight">
            <span className="text-primary">X</span>ettle
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/pricing">
                <Sparkles className="h-4 w-4 mr-1" />
                Plans
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new Event('xettle:open-settings'))}>
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
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut()}>
              <LogOut className="h-4 w-4 mr-1" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Section switcher — Settlements | Insights */}
      <div className="border-b border-border bg-card/50">
        <div className="container-custom">
          <nav className="flex gap-1 -mb-px">
            <button
              onClick={() => switchView('smart_upload')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeView === 'smart_upload'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Upload className="h-4 w-4" />
              Smart Upload
            </button>
            <button
              onClick={() => switchView('settlements')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeView === 'settlements'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <FileText className="h-4 w-4" />
              Settlements
            </button>
            <button
              onClick={() => switchView('insights')}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeView === 'insights'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Insights
            </button>
          </nav>
        </div>
      </div>

      <div className="container-custom py-8">
        {activeView === 'settlements' ? (
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
                  />
                )}
              </div>

              {/* Marketplace Dashboard Content */}
              {isAmazonAU ? (
                <AccountingDashboard />
              ) : isBunnings && selectedUserMarketplace ? (
                <BunningsDashboard marketplace={selectedUserMarketplace} />
              ) : isShopifyPayments && selectedUserMarketplace ? (
                <ShopifyPaymentsDashboard marketplace={selectedUserMarketplace} />
              ) : selectedUserMarketplace ? (
                <GenericMarketplaceDashboard marketplace={selectedUserMarketplace} onMarketplacesChanged={loadMarketplaces} />
              ) : null}
            </div>
          </ErrorBoundary>
        ) : activeView === 'smart_upload' ? (
          <ErrorBoundary>
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Smart Upload</h2>
                <p className="text-muted-foreground mt-1">
                  Drop any settlement files — Amazon TSV, Shopify CSV, Bunnings PDF, or anything else. Xettle auto-detects the marketplace, parses your data, and if you're uploading from a new marketplace we'll set it up for you automatically. No configuration needed.
                </p>
              </div>
              <Suspense fallback={<LoadingSpinner size="lg" text="Loading..." />}>
                <SmartUploadFlow onSettlementsSaved={loadMarketplaces} onMarketplacesChanged={loadMarketplaces} />
              </Suspense>
            </div>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary>
            <InsightsDashboard />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}