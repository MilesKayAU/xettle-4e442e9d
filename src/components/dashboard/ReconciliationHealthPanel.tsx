/**
 * ReconciliationHealthPanel — Unified setup & readiness checklist.
 * Combines Xero reconciliation readiness checks with setup warnings
 * (tax profile, fulfilment, account mappings) into a single panel.
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, XCircle, HeartPulse } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDashboardTaskCounts } from '@/hooks/useDashboardTaskCounts';
import {
  PHASE_1_RAILS,
  DESTINATION_KEY_PREFIX,
  DESTINATION_DEFAULT_KEY,
  LEGACY_KEY_PREFIX,
  LEGACY_DEFAULT_KEY,
  toRailCode,
} from '@/constants/settlement-rails';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface HealthCheck {
  label: string;
  status: CheckStatus;
  detail: string;
  actionLabel?: string;
  actionSection?: string;
}

type OverallStatus = 'ready' | 'incomplete' | 'missing';

function getOverallStatus(checks: HealthCheck[]): OverallStatus {
  if (checks.some(c => c.status === 'fail')) return 'missing';
  if (checks.some(c => c.status === 'warn')) return 'incomplete';
  return 'ready';
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />;
  if (status === 'warn') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
}

function OverallBadge({ status }: { status: OverallStatus }) {
  if (status === 'ready') {
    return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">Ready</Badge>;
  }
  if (status === 'incomplete') {
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">Incomplete</Badge>;
  }
  return <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">Action Needed</Badge>;
}

export function ReconciliationHealthBadge({ status }: { status: OverallStatus }) {
  return <OverallBadge status={status} />;
}

function navigateToSection(section: string) {
  window.dispatchEvent(new CustomEvent('open-settings-tab'));
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('open-settings-section', { detail: { section } }));
  }, 150);
}

export default function ReconciliationHealthPanel() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const { setupWarnings } = useDashboardTaskCounts();

  const runChecks = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [
        xeroTokensRes,
        destSettingsRes,
        legacySettingsRes,
        connectionsRes,
        bankTxRes,
      ] = await Promise.all([
        supabase.from('xero_tokens').select('id').limit(1),
        supabase.from('app_settings').select('key, value').like('key', `${DESTINATION_KEY_PREFIX}%`),
        supabase.from('app_settings').select('key, value').like('key', `${LEGACY_KEY_PREFIX}%`),
        supabase.from('marketplace_connections').select('marketplace_code, marketplace_name').in('connection_status', ['active', 'connected']),
        supabase.from('bank_transactions').select('id').limit(1),
      ]);

      const results: HealthCheck[] = [];

      // 1. Xero connected
      const xeroConnected = !!(xeroTokensRes.data && xeroTokensRes.data.length > 0);
      results.push({
        label: 'Xero connected',
        status: xeroConnected ? 'pass' : 'fail',
        detail: xeroConnected ? 'Xero is connected' : 'Connect Xero to enable journal posting',
        actionLabel: xeroConnected ? undefined : 'Connect',
        actionSection: xeroConnected ? undefined : 'api_connections',
      });

      // 2. Tax profile
      const hasTaxWarning = setupWarnings.some(w => w.key === 'tax_profile_missing');
      results.push({
        label: 'Tax profile',
        status: hasTaxWarning ? 'warn' : 'pass',
        detail: hasTaxWarning ? 'Set your organisation tax profile (GST registered / not registered)' : 'Tax profile configured',
        actionLabel: hasTaxWarning ? 'Set profile' : undefined,
        actionSection: hasTaxWarning ? 'account-mapper' : undefined,
      });

      // 3. Destination accounts mapped
      const activeRails = (connectionsRes.data || []).map(c => toRailCode(c.marketplace_code));
      const destSettings = destSettingsRes.data || [];
      const legacySettings = legacySettingsRes.data || [];
      const hasDefault = destSettings.some(s => s.key === DESTINATION_DEFAULT_KEY && s.value) ||
                         legacySettings.some(s => s.key === LEGACY_DEFAULT_KEY && s.value);

      const mappedRails = new Set<string>();
      for (const s of destSettings) {
        if (s.key !== DESTINATION_DEFAULT_KEY && s.value) {
          mappedRails.add(s.key.replace(DESTINATION_KEY_PREFIX, ''));
        }
      }
      for (const s of legacySettings) {
        if (s.key !== LEGACY_DEFAULT_KEY && s.value) {
          const code = toRailCode(s.key.replace(LEGACY_KEY_PREFIX, ''));
          mappedRails.add(code);
        }
      }

      const unmappedRails = activeRails.filter(r => !mappedRails.has(r) && !hasDefault);
      results.push({
        label: 'Destination accounts mapped',
        status: unmappedRails.length === 0 ? 'pass' : 'warn',
        detail: unmappedRails.length === 0
          ? 'All active rails have destination accounts'
          : `Map destination accounts for: ${unmappedRails.join(', ')}`,
        actionLabel: unmappedRails.length > 0 ? 'Map destinations' : undefined,
        actionSection: unmappedRails.length > 0 ? 'destination-accounts' : undefined,
      });

      // 4. Account mappings — use setupWarnings from useDashboardTaskCounts (source of truth)
      const coaWarning = setupWarnings.find(w => w.key === 'coa_mapping_incomplete' || w.key === 'coa_mapping_unconfirmed');
      if (coaWarning) {
        results.push({
          label: coaWarning.label,
          status: 'warn',
          detail: coaWarning.message,
          actionLabel: coaWarning.actionLabel || 'Set up mappings',
          actionSection: 'account-mapper',
        });
      } else if (connections.length > 0 && xeroConnected) {
        results.push({
          label: 'Account mappings complete',
          status: 'pass',
          detail: 'All marketplaces have fee/sales account mappings',
        });
      }

      // 5. Fulfilment methods
      const hasFulfilmentWarning = setupWarnings.some(w => w.key === 'fulfilment_methods_incomplete');
      const hasPostageWarning = setupWarnings.some(w => w.key === 'postage_cost_missing');
      if (hasFulfilmentWarning || hasPostageWarning) {
        const fulfilmentW = setupWarnings.find(w => w.key === 'fulfilment_methods_incomplete' || w.key === 'postage_cost_missing');
        results.push({
          label: hasFulfilmentWarning ? 'Fulfilment methods' : 'Postage costs',
          status: 'warn',
          detail: fulfilmentW?.message || 'Configure fulfilment methods for accurate profit',
          actionLabel: 'Configure',
          actionSection: 'fulfilment',
        });
      } else if (connections.length > 0) {
        results.push({
          label: 'Fulfilment methods',
          status: 'pass',
          detail: 'All marketplaces have fulfilment methods configured',
        });
      }

      // 6. Bank feed detection
      const hasBankTx = !!(bankTxRes.data && bankTxRes.data.length > 0);
      if (hasBankTx) {
        results.push({
          label: 'Bank feed detected',
          status: 'pass',
          detail: 'Bank transactions found — settlements can auto-match',
        });
      } else if (xeroConnected) {
        results.push({
          label: 'Bank feed not detected',
          status: 'warn',
          detail: 'No bank transactions cached — settlements may not auto-match in Xero',
        });
      }

      // 7. PayPal account check (if PayPal rail active)
      const activeRailSet = new Set(activeRails);
      if (activeRailSet.has('paypal')) {
        const paypalMapped = mappedRails.has('paypal') || hasDefault;
        results.push({
          label: 'PayPal account configured',
          status: paypalMapped ? 'pass' : 'warn',
          detail: paypalMapped
            ? 'PayPal rail has a destination account mapped'
            : 'PayPal rail active but no PayPal account mapped',
        });
      }

      setChecks(results);
    } catch (err) {
      console.error('Health check failed:', err);
    } finally {
      setLoading(false);
    }
  }, [setupWarnings]);

  useEffect(() => { runChecks(); }, [runChecks]);

  if (loading || checks.length === 0) return null;

  const overall = getOverallStatus(checks);
  const passCount = checks.filter(c => c.status === 'pass').length;
  const totalCount = checks.length;

  // Hide entirely when all checks pass — free up dashboard space
  if (overall === 'ready') return null;

  // Only show incomplete/failed checks
  const incompleteChecks = checks.filter(c => c.status !== 'pass');

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" />
            Setup &amp; Readiness
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{passCount}/{totalCount} complete</span>
            <OverallBadge status={overall} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Complete the remaining {incompleteChecks.length} item{incompleteChecks.length !== 1 ? 's' : ''} to enable automated Xero posting and reconciliation.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {incompleteChecks.map((check, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <StatusIcon status={check.status} />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-xs">{check.label}</span>
                <p className="text-[11px] text-muted-foreground">
                  {check.detail}
                  {check.actionLabel && check.actionSection && (
                    <button
                      className="ml-1.5 text-primary hover:underline font-medium"
                      onClick={() => navigateToSection(check.actionSection!)}
                    >
                      {check.actionLabel} →
                    </button>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export { getOverallStatus, type OverallStatus };
