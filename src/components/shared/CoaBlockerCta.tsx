/**
 * CoaBlockerCta — Shared component for resolving COA mapping blockers.
 *
 * Renders resolution CTAs when MAPPING_REQUIRED errors are detected:
 * 1. Open Account Mapper (filtered to marketplace)
 * 2. Clone COA for this marketplace (PIN-gated, opens CloneCoaDialog)
 * 3. Create accounts manually (guidance)
 *
 * Used in: PushSafetyPreview, SettlementDetailDrawer, onboarding flows.
 * All paths use canonical actions — no direct edge calls.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Copy, Settings, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  getCachedXeroAccounts,
  getCoaLastSyncedAt,
  type CachedXeroAccount,
} from '@/actions';
import { getMarketplaceCoverage } from '@/actions/coaCoverage';
import CloneCoaDialog from '@/components/settings/CloneCoaDialog';
import { useSettingsPin } from '@/hooks/use-settings-pin';
import { toast } from 'sonner';

interface CoaBlockerCtaProps {
  /** The marketplace code that is uncovered */
  marketplace: string;
  /** Missing category names, if known */
  missingCategories?: string[];
  /** Called after clone completes with created code mappings */
  onResolved?: (createdCodes: Record<string, string>) => void;
  /** Compact mode for inline use */
  compact?: boolean;
}

export default function CoaBlockerCta({
  marketplace,
  missingCategories,
  onResolved,
  compact = false,
}: CoaBlockerCtaProps) {
  const [coaAccounts, setCoaAccounts] = useState<CachedXeroAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [taxProfile, setTaxProfile] = useState<string | null>(null);
  const { requirePin, showDialog, verifyPin, unlock, cancelDialog, isUnlocked } = useSettingsPin();

  // Load COA data on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const accounts = await getCachedXeroAccounts();
        setCoaAccounts(accounts);

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from('app_settings')
            .select('value')
            .eq('user_id', user.id)
            .eq('key', 'tax_profile')
            .maybeSingle();
          setTaxProfile(data?.value || null);
        }
      } catch {
        // Non-critical
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Compute coverage to find eligible templates
  const coverage = useMemo(() => {
    if (coaAccounts.length === 0) return null;
    // Get all marketplaces that are covered (potential templates)
    const allMarketplaces = [...new Set(
      coaAccounts
        .filter(a => a.is_active && a.account_name)
        .map(a => {
          const name = a.account_name.toLowerCase();
          // Extract marketplace name from account name patterns
          const patterns = ['amazon', 'shopify', 'ebay', 'bunnings', 'catch', 'kogan', 'bigw', 'mydeal'];
          return patterns.find(p => name.includes(p));
        })
        .filter(Boolean) as string[]
    )];
    return getMarketplaceCoverage(allMarketplaces, coaAccounts);
  }, [coaAccounts]);

  const coveredMarketplaces = coverage?.covered || [];
  const hasTemplates = coveredMarketplaces.length > 0;

  const handleCloneClick = () => {
    requirePin(() => {
      setShowCloneDialog(true);
    });
  };

  const handleCloneComplete = async (createdCodes: Record<string, string>) => {
    // Auto-save mappings to app_settings as draft
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: existing } = await supabase
          .from('app_settings')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', 'accounting_xero_account_codes')
          .maybeSingle();

        let currentMappings: Record<string, string> = {};
        if (existing?.value) {
          try { currentMappings = JSON.parse(existing.value); } catch { /* */ }
        }

        // Merge new codes into existing mappings
        const updatedMappings = { ...currentMappings, ...createdCodes };
        await supabase.from('app_settings').upsert({
          user_id: user.id,
          key: 'accounting_xero_account_codes',
          value: JSON.stringify(updatedMappings),
        }, { onConflict: 'user_id,key' });

        toast.success('COA created + mappings applied. Push readiness updated.');
      }
    } catch (err) {
      console.warn('[CoaBlockerCta] Failed to auto-save mappings:', err);
    }

    onResolved?.(createdCodes);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking COA coverage…
      </div>
    );
  }

  return (
    <>
      <Alert className={`border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 ${compact ? 'p-3' : ''}`}>
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="space-y-3">
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <span className="font-semibold">{marketplace}</span> is missing account mappings
            {missingCategories && missingCategories.length > 0 && (
              <span> for: {missingCategories.map(c => (
                <Badge key={c} variant="outline" className="ml-1 text-[9px]">{c}</Badge>
              ))}</span>
            )}
          </div>

          <div className={`flex ${compact ? 'flex-col' : 'flex-wrap'} gap-2`}>
            {hasTemplates && (
              <Button
                size="sm"
                variant="default"
                className="gap-1.5 text-xs h-7"
                onClick={handleCloneClick}
              >
                <Copy className="h-3 w-3" />
                Clone COA for {marketplace}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7"
              onClick={() => {
                // Navigate to settings with marketplace filter
                window.location.hash = '#settings-mapper';
                window.location.href = '/admin?tab=settings';
              }}
            >
              <Settings className="h-3 w-3" />
              Open Account Mapper
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs h-7 text-muted-foreground"
              onClick={() => {
                toast.info(
                  'Create accounts manually in Xero, then refresh your Chart of Accounts in Account Mapper.',
                  { duration: 6000 }
                );
              }}
            >
              <FileText className="h-3 w-3" />
              Create manually
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      {/* Settings PIN dialog — rendered by the hook user */}
      {showDialog && (
        <div /> // PIN dialog is rendered by SettingsPinDialog in the parent layout
      )}

      {/* Clone COA Dialog */}
      {showCloneDialog && (
        <CloneCoaDialog
          open={showCloneDialog}
          onOpenChange={setShowCloneDialog}
          targetMarketplace={marketplace}
          coveredMarketplaces={coveredMarketplaces}
          coaAccounts={coaAccounts}
          taxProfile={taxProfile}
          onComplete={handleCloneComplete}
        />
      )}
    </>
  );
}
