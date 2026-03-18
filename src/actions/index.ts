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
  saveSettlementCanonical,
  applySourcePriority,
  checkSourceOverlap,
  getSourcePreference,
  setSourcePreference,
  type ActionResult,
  type SourcePriorityResult,
  type SaveSettlementCanonicalInput,
  type SaveSettlementCanonicalResult,
} from './settlements';

// ─── Xero Push / Rollback ────────────────────────────────────────────────────
export {
  pushSettlementToXero,
  rollbackFromXero,
  triggerAutoPost,
  checkPushCategoryCoverage,
  type PushResult,
  type PushEligibility,
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
  compareXeroInvoiceToSettlement,
  type XeroInvoiceDetail,
  type XeroLineItem,
  type RefreshResult,
  type RescanResult,
  type PayloadDiffResult,
  type PayloadDifference,
  type CompareResult,
  type CompareVerdict,
  type XettlePreviewPayload,
} from './xeroInvoice';

// ─── Xero Chart of Accounts ─────────────────────────────────────────────────
export {
  refreshXeroCOA,
  getCachedXeroAccounts,
  getCachedXeroTaxRates,
  getCoaLastSyncedAt,
  createXeroAccounts,
  type CachedXeroAccount,
  type CachedXeroTaxRate,
  type RefreshCoaResult,
  type CreateXeroAccountInput,
  type CreateXeroAccountsResult,
} from './xeroAccounts';

// ─── COA Coverage (gap detection) ───────────────────────────────────────────
export {
  getMarketplaceCoverage,
  findTemplateAccounts,
  generateNewAccountName,
  detectCategoryFromName,
  type CoverageResult,
  type CoverageStatus,
  type MarketplaceCoverage,
  type TemplateAccount,
} from './coaCoverage';

// ─── COA Clone (canonical action) ───────────────────────────────────────────
export {
  buildClonePreview,
  executeCoaClone,
  validateTemplateEligibility,
  logCloneEvent,
  CLONE_CATEGORIES,
  type CloneAccountRow,
  type ClonePreviewInput,
  type CloneExecuteInput,
  type CloneResult,
  type CloneSystemEvent,
} from './coaClone';

// ─── Account Mappings (canonical source of truth) ───────────────────────────
export {
  getMappings,
  getMappingsRaw,
  getEffectiveMapping,
  saveDraftMappings,
  confirmMappings,
  mergeIntoConfirmedMappings,
  type AccountMappings,
} from './accountMappings';

// ─── Sync Actions ────────────────────────────────────────────────────────────
export {
  runXeroSync,
  runMarketplaceSync,
  type SyncActionResult,
} from './sync';

// ─── Audit Export ────────────────────────────────────────────────────────────
export {
  exportAuditCsv,
  type AuditExportFilters,
  type AuditExportResult,
} from './auditExport';
