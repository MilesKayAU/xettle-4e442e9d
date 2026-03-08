import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/use-admin-auth';
import AccountingDashboard from '@/components/admin/accounting/AccountingDashboard';
import GenericMarketplaceDashboard from '@/components/admin/accounting/GenericMarketplaceDashboard';
import MarketplaceSwitcher, { MARKETPLACE_CATALOG, type UserMarketplace } from '@/components/admin/accounting/MarketplaceSwitcher';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { Button } from '@/components/ui/button';
import { LogOut, Shield, Settings, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, user, handleSignOut } = useAdminAuth();
  const [isAdmin, setIsAdmin] = useState(false);
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
        // If currently selected marketplace isn't in their list, switch to first
        if (!data.find((m: any) => m.marketplace_code === selectedMarketplace)) {
          setSelectedMarketplace(data[0].marketplace_code);
        }
      } else {
        // Auto-create Amazon AU for existing users
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
            // Re-load
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

      <div className="container-custom py-8">
        {/* Marketplace Switcher */}
        <div className="mb-6">
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
        ) : selectedUserMarketplace ? (
          <GenericMarketplaceDashboard marketplace={selectedUserMarketplace} />
        ) : null}
      </div>
    </div>
  );
}
