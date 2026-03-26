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
import { normalizeKeyLabel } from '@/utils/marketplace-codes';
import { SCOPE_VERSION } from '@/policy/supportPolicy';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SetupWarning {
  key: string;
  label: string;
  severity: 'blocking' | 'warning';
  message: string;
  actionLabel?: string;
  actionTarget?: string;
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
    mfnLinesRes,
    validationCountsRes,
  ] = await Promise.all([
    // Settlements with status breakdowns (non-hidden, non-pre-boundary)
    supabase
      .from('settlements')
      .select('id, status, xero_status, reconciliation_status, marketplace, is_hidden, is_pre_boundary')
      .eq('is_hidden', false)
      .eq('is_pre_boundary', false)
      .gte('period_end', '2026-01-01')
      .order('created_at', { ascending: false })
      .limit(1000),

    // Active marketplace connections
    supabase
      .from('marketplace_connections')
      .select('marketplace_code, marketplace_name, connection_status')
      .in('connection_status', [...ACTIVE_CONNECTION_STATUSES]),

    // App settings for setup checks (include fulfilment_method:* and postage_cost:*)
    supabase
      .from('app_settings')
      .select('key, value')
      .or('key.in.(accounting_xero_account_codes,scope_acknowledged_at,scope_version,tax_profile),key.like.fulfilment_method:%,key.like.postage_cost:%'),

    // Reconciliation alerts (missing/partial from marketplace_validation)
    supabase
      .from('marketplace_validation')
      .select('id', { count: 'exact', head: true })
      .in('overall_status', ['missing', 'partial'])
      .gte('period_end', '2026-01-01'),

    // Xero tokens — the actual source of truth for Xero connection
    supabase
      .from('xero_tokens')
      .select('id', { count: 'exact', head: true }),

    // MFN/FBM lines — detect fulfilment mismatch for FBA-only accounts
    supabase
      .from('settlement_lines')
      .select('settlement_id, fulfilment_channel')
      .in('fulfilment_channel', ['MFN', 'MFN_inferred'])
      .limit(100),

    // Validation pipeline counts — the canonical source of truth for stage counts
    supabase
      .from('marketplace_validation')
      .select('overall_status'),
  ]);

  const settlements = settlementsRes.data || [];
  const rawConnections = connectionsRes.data || [];
  // Deduplicate connections by marketplace_code (duplicates cause phantom warnings)
  const seenCodes = new Set<string>();
  const connections = rawConnections.filter(c => {
    if (seenCodes.has(c.marketplace_code)) return false;
    seenCodes.add(c.marketplace_code);
    return true;
  });
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
  // Merge confirmed + draft mappings (draft takes precedence) so unconfirmed work counts
  const accountCodes = settingsMap.get('accounting_xero_account_codes');
  const draftCodes = settingsMap.get('accounting_xero_account_codes_draft');
  const confirmedMappings: Record<string, string> = accountCodes
    ? (() => { try { return JSON.parse(accountCodes); } catch { return {}; } })()
    : {};
  const draftMappings: Record<string, string> = draftCodes
    ? (() => { try { return JSON.parse(draftCodes); } catch { return {}; } })()
    : {};
  const parsedMappings: Record<string, string> = { ...confirmedMappings, ...draftMappings };

  // Track whether drafts cover gaps that confirmed mappings don't
  let hasDraftOnlyMappings = false;

  if (hasXeroTokens && connections.length > 0) {
    let totalMissing = 0;
    let totalRequired = 0;
    const missingDetails: string[] = [];
    for (const conn of connections) {
      const code = conn.marketplace_code;
      const keyLabel = normalizeKeyLabel(code);
      const missingCats: string[] = [];
      for (const cat of REQUIRED_CATEGORIES) {
        totalRequired++;
        // Check per-marketplace override using the same key format as AccountMapperCard
        const mpKeyByLabel = `${cat}:${keyLabel}`;
        const mpKeyByCode = `${cat}:${code}`;
        const merged = parsedMappings[mpKeyByLabel] || parsedMappings[mpKeyByCode] || parsedMappings[cat] || DEFAULT_FALLBACK;
        if (merged === DEFAULT_FALLBACK || !merged) {
          missingCats.push(cat);
          totalMissing++;
        } else {
          // Check if this was only filled by draft (not confirmed)
          const confirmedVal = confirmedMappings[mpKeyByLabel] || confirmedMappings[mpKeyByCode] || confirmedMappings[cat];
          if (!confirmedVal || confirmedVal === DEFAULT_FALLBACK) {
            hasDraftOnlyMappings = true;
          }
        }
      }
      if (missingCats.length > 0) {
        missingDetails.push(`${conn.marketplace_name || code}: ${missingCats.join(', ')}`);
      }
    }

    if (missingDetails.length > 0) {
      // If most mappings are done (>75% covered), downgrade to warning
      const coveragePct = totalRequired > 0 ? ((totalRequired - totalMissing) / totalRequired) * 100 : 0;
      const severity: 'blocking' | 'warning' = coveragePct >= 75 ? 'warning' : 'blocking';
      setupWarnings.push({
        key: 'coa_mapping_incomplete',
        label: severity === 'blocking' ? 'Account mapping incomplete' : 'Account mapping almost done',
        severity,
        message: severity === 'blocking'
          ? `Missing mappings — ${missingDetails.join('; ')}.`
          : `Nearly there! ${totalMissing} mapping${totalMissing !== 1 ? 's' : ''} remaining — ${missingDetails.join('; ')}.`,
        actionLabel: 'Open mapper',
        actionTarget: 'settings:account-mapper',
      });
    } else if (hasDraftOnlyMappings) {
      // All categories covered, but some only via draft — prompt to confirm
      setupWarnings.push({
        key: 'coa_mapping_unconfirmed',
        label: 'Mappings ready — confirm to complete',
        severity: 'warning',
        message: 'All account mappings are filled in, but haven\'t been confirmed yet. Open the Account Mapper and press "Confirm Mapping" to finalise.',
        actionLabel: 'Open mapper',
        actionTarget: 'settings:account-mapper',
      });
    }
  }

  // 5. Fulfilment method — warn if any active marketplace has no explicit method set
  if (connections.length > 0) {
    const unconfiguredMarketplaces: string[] = [];
    const missingPostageCost: string[] = [];
    for (const conn of connections) {
      const fulfilmentValue = settingsMap.get(`fulfilment_method:${conn.marketplace_code}`);
      if (!fulfilmentValue || fulfilmentValue === 'not_sure') {
        unconfiguredMarketplaces.push(conn.marketplace_name || conn.marketplace_code);
      } else if (fulfilmentValue === 'self_ship' || fulfilmentValue === 'third_party_logistics' || fulfilmentValue === 'mixed_fba_fbm') {
        // Check if postage cost setting exists at all (user may have deliberately set to 0 or cleared)
        const postageCostKey = `postage_cost:${conn.marketplace_code}`;
        const postageCostExists = settingsMap.has(postageCostKey);
        if (!postageCostExists) {
          missingPostageCost.push(conn.marketplace_name || conn.marketplace_code);
        }
      }
    }
    if (unconfiguredMarketplaces.length > 0) {
      setupWarnings.push({
        key: 'fulfilment_methods_incomplete',
        label: 'Fulfilment methods not configured',
        severity: 'warning',
        message: `Review and save fulfilment method for: ${unconfiguredMarketplaces.join(', ')}.`,
        actionLabel: 'Configure',
        actionTarget: 'settings:fulfilment',
      });
    }
    if (missingPostageCost.length > 0) {
      setupWarnings.push({
        key: 'postage_cost_missing',
        label: 'Postage cost not set',
        severity: 'warning',
        message: `For more accurate profit, set your average postage cost for: ${missingPostageCost.join(', ')}.`,
        actionLabel: 'Set costs',
        actionTarget: 'settings:fulfilment',
      });
    }

    // 6. FBM mismatch detection — MFN lines found but marketplace set to FBA-only
    const mfnLines = mfnLinesRes.data || [];
    if (mfnLines.length > 0) {
      // Get marketplace codes from settlements that have MFN lines
      const mfnSettlementIds = new Set(mfnLines.map(l => l.settlement_id));
      const mfnMarketplaces = new Set(
        settlements
          .filter(s => mfnSettlementIds.has(s.id))
          .map(s => s.marketplace)
          .filter(Boolean)
      );

      for (const conn of connections) {
        const fulfilmentValue = settingsMap.get(`fulfilment_method:${conn.marketplace_code}`);
        if (fulfilmentValue === 'marketplace_fulfilled' && mfnMarketplaces.has(conn.marketplace_code)) {
          setupWarnings.push({
            key: `fbm_mismatch_detected:${conn.marketplace_code}`,
            label: 'FBM orders detected on FBA-only account',
            severity: 'warning',
            message: `We found merchant-fulfilled orders for ${conn.marketplace_name || conn.marketplace_code}. Update your fulfilment method to "Mixed FBA + FBM" for accurate profit.`,
            actionLabel: 'Update now',
            actionTarget: 'settings:fulfilment',
          });
        }
      }
    }
  }

  // ─── Settlement stage counts (from marketplace_validation — canonical truth) ─

  let needsReview = 0;
  let readyToPost = 0;
  let awaitingReconciliation = 0;

  const validationRows = validationCountsRes.data || [];
  for (const v of validationRows) {
    const os = (v as any).overall_status;
    if (os === 'settlement_needed' || os === 'missing' || os === 'gap_detected') {
      needsReview++;
    } else if (os === 'ready_to_push') {
      readyToPost++;
    } else if (os === 'pushed_to_xero') {
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
