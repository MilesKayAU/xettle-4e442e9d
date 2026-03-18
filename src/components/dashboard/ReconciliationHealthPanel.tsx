/**
 * ReconciliationHealthPanel — Setup readiness checklist for Xero reconciliation.
 * Uses only cached/local data. No API calls. Fast, safe, predictable.
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, XCircle, HeartPulse } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
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
  return <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">Missing Accounts</Badge>;
}

export function ReconciliationHealthBadge({ status }: { status: OverallStatus }) {
  return <OverallBadge status={status} />;
}

export default function ReconciliationHealthPanel() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);

  const runChecks = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [
        xeroTokensRes,
        destSettingsRes,
        legacySettingsRes,
        connectionsRes,
        mappingsRes,
        bankTxRes,
      ] = await Promise.all([
        supabase.from('xero_tokens').select('id').limit(1),
        supabase.from('app_settings').select('key, value').like('key', `${DESTINATION_KEY_PREFIX}%`),
        supabase.from('app_settings').select('key, value').like('key', `${LEGACY_KEY_PREFIX}%`),
        supabase.from('marketplace_connections').select('marketplace_code, marketplace_name').in('connection_status', ['active', 'connected']),
        supabase.from('marketplace_account_mapping').select('marketplace_code, category'),
        supabase.from('bank_transactions').select('id').limit(1),
      ]);

      const results: HealthCheck[] = [];

      // 1. Xero connected
      const xeroConnected = !!(xeroTokensRes.data && xeroTokensRes.data.length > 0);
      results.push({
        label: 'Xero connected',
        status: xeroConnected ? 'pass' : 'fail',
        detail: xeroConnected ? 'Xero is connected' : 'Connect Xero to enable journal posting',
      });

      // 2. Get active rails
      const activeRails = (connectionsRes.data || []).map(c => toRailCode(c.marketplace_code));
      const activeRailSet = new Set(activeRails);

      // 3. Destination accounts mapped
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
      if (unmappedRails.length === 0) {
        results.push({
          label: 'Destination accounts mapped',
          status: 'pass',
          detail: 'All active rails have destination accounts',
        });
      } else {
        results.push({
          label: 'Destination accounts mapped',
          status: 'warn',
          detail: `Map destination accounts for: ${unmappedRails.join(', ')}`,
        });
      }

      // 4. PayPal account check (if PayPal rail active)
      const hasPayPalRail = activeRailSet.has('paypal');
      if (hasPayPalRail) {
        // We check destination mapping name — but we don't have account names cached here
        // So we just check if PayPal rail has a mapping
        const paypalMapped = mappedRails.has('paypal') || hasDefault;
        results.push({
          label: 'PayPal account configured',
          status: paypalMapped ? 'pass' : 'warn',
          detail: paypalMapped
            ? 'PayPal rail has a destination account mapped'
            : 'PayPal rail active but no PayPal account mapped — PayPal payouts may not reconcile',
        });
      }

      // 5. Fee/Sales mappings
      const mappings = mappingsRes.data || [];
      const mappedMarketplaces = new Set(mappings.map(m => m.marketplace_code));
      const connections = connectionsRes.data || [];
      const unmappedMarketplaces = connections.filter(c => !mappedMarketplaces.has(c.marketplace_code));

      if (unmappedMarketplaces.length === 0 && connections.length > 0) {
        results.push({
          label: 'Account mappings complete',
          status: 'pass',
          detail: 'All marketplaces have fee/sales account mappings',
        });
      } else if (connections.length === 0) {
        results.push({
          label: 'Account mappings',
          status: 'warn',
          detail: 'No marketplace connections found — connect a marketplace first',
        });
      } else {
        results.push({
          label: 'Account mappings incomplete',
          status: 'warn',
          detail: `Mappings needed for: ${unmappedMarketplaces.map(m => m.marketplace_name).join(', ')}`,
          actionLabel: 'Set up mappings',
          actionSection: 'account-mapper',
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

      setChecks(results);
    } catch (err) {
      console.error('Health check failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { runChecks(); }, [runChecks]);

  if (loading || checks.length === 0) return null;

  const overall = getOverallStatus(checks);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" />
            Reconciliation Readiness
          </CardTitle>
          <OverallBadge status={overall} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Xettle generates journals per payout source. Xero bank and PayPal feeds handle automatic reconciliation.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {checks.map((check, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <StatusIcon status={check.status} />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-xs">{check.label}</span>
                <p className="text-[11px] text-muted-foreground">{check.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export { getOverallStatus, type OverallStatus };
