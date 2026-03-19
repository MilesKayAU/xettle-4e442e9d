/**
 * CANONICAL SETTLEMENT STATUS — Single source of truth
 *
 * settlements.status represents ONLY the workflow lifecycle.
 * UI flags (hidden, duplicate, pre-boundary, sync origin) are stored
 * in separate columns — never in status.
 *
 * ┌─────────────────────┐
 * │     ingested        │  ← Initial state for ALL ingestion paths
 * └────────┬────────────┘
 *          │
 * ┌────────▼────────────┐
 * │  ready_to_push      │  ← After Xero scan confirms not in Xero
 * └────────┬────────────┘
 *          │
 * ┌────────▼────────────┐
 * │  pushed_to_xero     │  ← Xero entry created (draft or authorised)
 * └────────┬────────────┘
 *          │
 * ┌────────▼────────────┐
 * │ reconciled_in_xero  │  ← Xero status = PAID or reconciled
 * └────────┬────────────┘
 *          │
 * ┌────────▼────────────┐
 * │  bank_verified      │  ← Bank deposit matched and confirmed
 * └─────────────────────┘
 *
 * Error path:
 *   ready_to_push → push_failed → push_failed_permanent
 *   ready_to_push → mapping_error → ready_to_push (after user fixes mapping)
 *
 * Rollback:
 *   pushed_to_xero → ready_to_push
 *
 * ═══════════════════════════════════════════════════════════════
 * NON-STATUS COLUMNS (never stored in status):
 *
 *   is_hidden              boolean  — UI hide/unhide
 *   is_pre_boundary        boolean  — before accounting boundary date
 *   duplicate_of_settlement_id text — duplicate link
 *   duplicate_reason       text     — why it's a duplicate
 *   sync_origin            text     — 'xettle' or 'external'
 * ═══════════════════════════════════════════════════════════════
 */

export const SETTLEMENT_STATUS = {
  /** Initial state for ALL ingestion paths (upload, Amazon API, Shopify API) */
  INGESTED: 'ingested',
  /** After Xero scan confirms this settlement is NOT already in Xero */
  READY_TO_PUSH: 'ready_to_push',
  /** Xero entry created (draft, authorised, or bill) */
  PUSHED_TO_XERO: 'pushed_to_xero',
  /** Xero status = PAID or reconciled */
  RECONCILED_IN_XERO: 'reconciled_in_xero',
  /** Bank deposit matched and confirmed */
  BANK_VERIFIED: 'bank_verified',
  /** Transient push failure; retryable */
  PUSH_FAILED: 'push_failed',
  /** Exhausted retries */
  PUSH_FAILED_PERMANENT: 'push_failed_permanent',
  /** Account mapping references invalid/inactive Xero accounts */
  MAPPING_ERROR: 'mapping_error',
} as const;

export type SettlementStatus = typeof SETTLEMENT_STATUS[keyof typeof SETTLEMENT_STATUS];

/** Sync origin values for the sync_origin column */
export const SYNC_ORIGIN = {
  XETTLE: 'xettle',
  EXTERNAL: 'external',
} as const;

export type SyncOrigin = typeof SYNC_ORIGIN[keyof typeof SYNC_ORIGIN];

/**
 * Valid transitions: from → [allowed next statuses]
 */
export const VALID_TRANSITIONS: Record<SettlementStatus, readonly SettlementStatus[]> = {
  [SETTLEMENT_STATUS.INGESTED]: [
    SETTLEMENT_STATUS.READY_TO_PUSH,
  ],
  [SETTLEMENT_STATUS.READY_TO_PUSH]: [
    SETTLEMENT_STATUS.PUSHED_TO_XERO,
    SETTLEMENT_STATUS.PUSH_FAILED,
    SETTLEMENT_STATUS.MAPPING_ERROR,
  ],
  [SETTLEMENT_STATUS.PUSHED_TO_XERO]: [
    SETTLEMENT_STATUS.RECONCILED_IN_XERO,
    SETTLEMENT_STATUS.READY_TO_PUSH, // Rollback / undo
  ],
  [SETTLEMENT_STATUS.RECONCILED_IN_XERO]: [
    SETTLEMENT_STATUS.BANK_VERIFIED,
  ],
  [SETTLEMENT_STATUS.BANK_VERIFIED]: [],
  [SETTLEMENT_STATUS.PUSH_FAILED]: [
    SETTLEMENT_STATUS.READY_TO_PUSH, // Retry
    SETTLEMENT_STATUS.PUSH_FAILED_PERMANENT,
  ],
  [SETTLEMENT_STATUS.PUSH_FAILED_PERMANENT]: [
    SETTLEMENT_STATUS.READY_TO_PUSH, // Manual reset
  ],
  [SETTLEMENT_STATUS.MAPPING_ERROR]: [
    SETTLEMENT_STATUS.READY_TO_PUSH, // After user fixes mapping
  ],
};

/**
 * Validate a status transition. Returns true if the transition is allowed.
 */
export function isValidTransition(
  from: string | null | undefined,
  to: string,
): boolean {
  if (!from && to === SETTLEMENT_STATUS.INGESTED) return true;
  if (!from) return false;
  const allowed = VALID_TRANSITIONS[from as SettlementStatus];
  if (!allowed) return false;
  return allowed.includes(to as SettlementStatus);
}

/**
 * Normalise legacy status values to canonical states.
 * Used by readers during the transition period.
 */
export function normaliseStatus(raw: string | null | undefined): SettlementStatus {
  if (!raw) return SETTLEMENT_STATUS.INGESTED;
  const LEGACY_MAP: Record<string, SettlementStatus> = {
    saved: SETTLEMENT_STATUS.INGESTED,
    parsed: SETTLEMENT_STATUS.INGESTED,
    processing: SETTLEMENT_STATUS.INGESTED,
    already_recorded: SETTLEMENT_STATUS.INGESTED,
    synced_external: SETTLEMENT_STATUS.PUSHED_TO_XERO,
    synced: SETTLEMENT_STATUS.PUSHED_TO_XERO,
    draft_in_xero: SETTLEMENT_STATUS.PUSHED_TO_XERO,
    authorised_in_xero: SETTLEMENT_STATUS.PUSHED_TO_XERO,
    pushed_to_xero: SETTLEMENT_STATUS.PUSHED_TO_XERO,
    deposit_matched: SETTLEMENT_STATUS.BANK_VERIFIED,
    verified_payout: SETTLEMENT_STATUS.BANK_VERIFIED,
    hidden: SETTLEMENT_STATUS.INGESTED,
    duplicate_suppressed: SETTLEMENT_STATUS.INGESTED,
    mapping_error: SETTLEMENT_STATUS.MAPPING_ERROR,
  };
  return LEGACY_MAP[raw] ?? (raw as SettlementStatus);
}

/**
 * Standard dashboard query filter: active, visible, non-duplicate settlements.
 * Apply these conditions to any settlement query for user-facing views.
 */
export function activeSettlementFilters() {
  return {
    is_hidden: false,
    duplicate_of_settlement_id: null,
  };
}

/**
 * Helper: statuses that mean "needs attention / action from user"
 */
export const ATTENTION_STATUSES: readonly SettlementStatus[] = [
  SETTLEMENT_STATUS.INGESTED,
  SETTLEMENT_STATUS.PUSH_FAILED,
  SETTLEMENT_STATUS.PUSH_FAILED_PERMANENT,
  SETTLEMENT_STATUS.MAPPING_ERROR,
];

/**
 * Helper: statuses that mean "in Xero" (any form)
 */
export const XERO_LINKED_STATUSES: readonly SettlementStatus[] = [
  SETTLEMENT_STATUS.PUSHED_TO_XERO,
  SETTLEMENT_STATUS.RECONCILED_IN_XERO,
];

/**
 * Helper: statuses eligible for Xero push
 */
export const PUSHABLE_STATUSES: readonly SettlementStatus[] = [
  SETTLEMENT_STATUS.READY_TO_PUSH,
];
