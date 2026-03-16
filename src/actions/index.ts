/**
 * Canonical Actions — Barrel Export
 * 
 * Import ALL canonical actions from this single file:
 *   import { deleteSettlement, pushSettlementToXero, provisionMarketplace } from '@/actions';
 * 
 * This is the ONLY approved client-side entry point for these operations.
 * Direct table writes and edge function invocations are blocked by guardrail tests.
 */

// ─── Marketplace Provisioning ────────────────────────────────────────────────
export {
  provisionMarketplace,
  provisionMarketplaces,
  removeMarketplace,
  type ProvisionResult,
  type RemoveResult,
} from './marketplaces';

// ─── Settlement CRUD ─────────────────────────────────────────────────────────
export {
  deleteSettlement,
  deleteSettlements,
  updateSettlementVisibility,
  revertSettlementToSaved,
  resetFailedSettlement,
  resetFailedSettlements,
  markBankVerified,
  type ActionResult,
} from './settlements';

// ─── Xero Push / Rollback ────────────────────────────────────────────────────
export {
  pushSettlementToXero,
  rollbackFromXero,
  triggerAutoPost,
  type PushResult,
  type RollbackResult,
} from './xeroPush';

// ─── Safe Repost ─────────────────────────────────────────────────────────────
export {
  rollbackSettlement,
  type RepostResult,
} from './repost';

// ─── Xero Readiness ──────────────────────────────────────────────────────────
export {
  checkXeroReadinessForMarketplace,
  REQUIRED_CATEGORIES,
  getRailPostingEligibility,
  type XeroReadinessResult,
  type XeroReadinessCheck,
  type RailPostingEligibility,
} from './xeroReadiness';

// ─── Support Policy ──────────────────────────────────────────────────────────
export {
  computeSupportTier,
  getSupportWarnings,
  getAutomationEligibility,
  SUPPORTED_TAX_PROFILES,
  TAX_MODES,
  SCOPE_VERSION,
  type SupportTier,
  type TaxProfile,
  type TaxMode,
  type ScopeConsent,
  type TierInput,
  type SupportWarning,
  type AutomationEligibility,
} from '@/policy/supportPolicy';

// ─── Scope Consent ───────────────────────────────────────────────────────────
export {
  getScopeConsent,
  acknowledgeScopeConsent,
  getOrgTaxProfile,
  setOrgTaxProfile,
  acknowledgeRailSupport,
} from './scopeConsent';

// ─── Xero Invoice (Refresh / Rescan / Compare) ──────────────────────────────
export {
  refreshXeroInvoiceDetails,
  rescanMatchForInvoice,
  getXeroVsXettlePayloadDiff,
  type XeroInvoiceDetail,
  type XeroLineItem,
  type RefreshResult,
  type RescanResult,
  type PayloadDiffResult,
  type PayloadDifference,
} from './xeroInvoice';
