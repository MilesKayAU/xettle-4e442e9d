/**
 * useDashboardTaskCounts — Shared hook for dashboard pipeline stage counts.
 *
 * Computes counts for 5 accounting pipeline stages:
 *   1. Setup required — config gaps blocking push (COA, mappings, scope, tax)
 *   2. Needs review — settlements ingested but not yet ready_to_push
 *   3. Ready to post — settlements eligible for Xero push
 *   4. Awaiting reconciliation — pushed to Xero, awaiting bank match
 *   5. Alerts — reconciliation mismatches / missing / partial
 *
 * All DB reads are centralised here. Components must NOT query Supabase directly.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ACTIVE_CONNECTION_STATUSES } from '@/constants/connection-status';
import { REQUIRED_CATEGORIES } from '@/actions/xeroReadiness';
import { SCOPE_VERSION } from '@/policy/supportPolicy';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SetupWarning {
  key: string;
  label: string;
  severity: 'blocking' | 'warning';
  message: string;
}

export interface DashboardTaskCounts {
  setupRequired: number;
  setupWarnings: SetupWarning[];
  needsReview: number;
  readyToPost: number;
  awaitingReconciliation: number;
  alerts: number;
  loading: boolean;
}

// ─── Default fallback code that indicates "not configured" ───────────────────
const DEFAULT_FALLBACK = '400';

// ─── Fetch logic ─────────────────────────────────────────────────────────────

async function fetchTaskCounts(): Promise<Omit<DashboardTaskCounts, 'loading'>> {
  const setupWarnings: SetupWarning[] = [];

  // Parallel data fetch — all from existing tables
  const [
    settlementsRes,
    connectionsRes,
    settingsRes,
    alertsRes,
    xeroTokensRes,
  ] = await Promise.all([
    // Settlements with status breakdowns (non-hidden, non-pre-boundary)
    supabase
      .from('settlements')
      .select('id, status, xero_status, reconciliation_status, marketplace, is_hidden, is_pre_boundary')
      .eq('is_hidden', false)
      .eq('is_pre_boundary', false)
      .order('created_at', { ascending: false })
      .limit(1000),

    // Active marketplace connections
    supabase
      .from('marketplace_connections')
      .select('marketplace_code, marketplace_name, connection_status')
      .in('connection_status', [...ACTIVE_CONNECTION_STATUSES]),

    // App settings for setup checks
    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', [
        'accounting_xero_account_codes',
        'scope_acknowledged_at',
        'scope_version',
        'tax_profile',
      ]),

    // Reconciliation alerts (missing/partial from marketplace_validation)
    supabase
      .from('marketplace_validation')
      .select('id', { count: 'exact', head: true })
      .in('overall_status', ['missing', 'partial']),

    // Xero tokens — the actual source of truth for Xero connection
    supabase
      .from('xero_tokens')
      .select('id', { count: 'exact', head: true }),
  ]);

  const settlements = settlementsRes.data || [];
  const connections = connectionsRes.data || [];
  const settingsMap = new Map(settingsRes.data?.map(s => [s.key, s.value]) || []);

  // ─── Setup checks ─────────────────────────────────────────────────────

  // 1. Xero connected? Check xero_tokens table (source of truth)
  const hasXeroTokens = (xeroTokensRes.count ?? 0) > 0;
  if (!hasXeroTokens) {
    setupWarnings.push({
      key: 'xero_not_connected',
      label: 'Xero not connected',
      severity: 'blocking',
      message: 'Connect Xero to enable posting settlements.',
    });
  }

  // 2. Scope consent acknowledged?
  const scopeVersion = settingsMap.get('scope_version');
  const scopeAckedAt = settingsMap.get('scope_acknowledged_at');
  if (scopeVersion !== SCOPE_VERSION || !scopeAckedAt) {
    setupWarnings.push({
      key: 'scope_not_acknowledged',
      label: 'Scope not acknowledged',
      severity: 'blocking',
      message: 'Acknowledge the AU-validated scope before posting.',
    });
  }

  // 3. Tax profile set?
  const taxProfile = settingsMap.get('tax_profile');
  if (!taxProfile) {
    setupWarnings.push({
      key: 'tax_profile_missing',
      label: 'Tax profile not set',
      severity: 'warning',
      message: 'Set your organisation tax profile in Settings.',
    });
  }

  // 4. COA mapping coverage — check per active marketplace
  const accountCodes = settingsMap.get('accounting_xero_account_codes');
  const parsedMappings: Record<string, string> = accountCodes
    ? (() => { try { return JSON.parse(accountCodes); } catch { return {}; } })()
    : {};

  if (xeroTenantId && connections.length > 0) {
    let anyMissing = false;
    for (const conn of connections) {
      const code = conn.marketplace_code;
      for (const cat of REQUIRED_CATEGORIES) {
        const mpKey = `${cat}:${code}`;
        const mapped = parsedMappings[mpKey] || parsedMappings[cat] || DEFAULT_FALLBACK;
        if (mapped === DEFAULT_FALLBACK || !mapped) {
          anyMissing = true;
          break;
        }
      }
      if (anyMissing) break;
    }

    if (anyMissing) {
      setupWarnings.push({
        key: 'coa_mapping_incomplete',
        label: 'Account mapping incomplete',
        severity: 'blocking',
        message: 'Some marketplaces are missing required Xero account mappings.',
      });
    }
  }

  // ─── Settlement stage counts ───────────────────────────────────────────

  let needsReview = 0;
  let readyToPost = 0;
  let awaitingReconciliation = 0;

  for (const s of settlements) {
    const status = s.status;
    const xeroStatus = s.xero_status;

    if (status === 'ingested' || status === 'saved') {
      needsReview++;
    } else if (status === 'ready_to_push' && !xeroStatus) {
      readyToPost++;
    } else if (
      xeroStatus === 'draft_in_xero' ||
      xeroStatus === 'authorised_in_xero' ||
      xeroStatus === 'submitted_in_xero'
    ) {
      awaitingReconciliation++;
    }
  }

  const setupRequired = setupWarnings.filter(w => w.severity === 'blocking').length;

  return {
    setupRequired,
    setupWarnings,
    needsReview,
    readyToPost,
    awaitingReconciliation,
    alerts: alertsRes.count ?? 0,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDashboardTaskCounts(): DashboardTaskCounts {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-task-counts'],
    queryFn: fetchTaskCounts,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  return {
    setupRequired: data?.setupRequired ?? 0,
    setupWarnings: data?.setupWarnings ?? [],
    needsReview: data?.needsReview ?? 0,
    readyToPost: data?.readyToPost ?? 0,
    awaitingReconciliation: data?.awaitingReconciliation ?? 0,
    alerts: data?.alerts ?? 0,
    loading: isLoading,
  };
}
