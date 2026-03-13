/**
 * CANONICAL SETTLEMENT STATUS — Single source of truth
 *
 * Every ingestion path (CSV upload, Amazon API, Shopify API, Xero scan)
 * MUST use these statuses. No ad-hoc strings.
 *
 * ┌─────────────────────┐
 * │      saved          │  ← Initial state for all ingestion paths
 * └────────┬────────────┘
 *          │
 * ┌────────▼────────────┐
 * │  ready_to_push      │  ← After Xero scan confirms not in Xero
 * └────────┬────────────┘
 *          │
 *    ┌─────┴──────────────────┐
 *    │                        │
 * ┌──▼──────────────┐  ┌─────▼──────────────┐
 * │ draft_in_xero   │  │ synced_external     │  ← Found in Xero already (not via Xettle)
 * └────────┬────────┘  └────────────────────-┘
 *          │
 * ┌────────▼────────────┐
 * │ authorised_in_xero  │  ← Xero status promoted to AUTHORISED
 * └────────┬────────────┘
 *          │
 * ┌────────▼────────────┐
 * │ reconciled_in_xero  │  ← Xero status = PAID or reconciled
 * └────────┬────────────┘
 *          │
 * ┌────────▼────────────┐
 * │ bank_verified       │  ← Bank deposit matched and confirmed
 * └─────────────────────┘
 *
 * Special statuses (terminal / side branches):
 *   already_recorded   ← Before accounting boundary; never pushed
 *   push_failed        ← Transient Xero push error; retryable
 *   push_failed_permanent ← Exhausted retries
 *   duplicate          ← Fingerprint collision; suppressed
 */

export const SETTLEMENT_STATUS = {
  /** Initial state for ALL ingestion paths (upload, Amazon API, Shopify API) */
  SAVED: 'saved',
  /** After Xero scan confirms this settlement is NOT already in Xero */
  READY_TO_PUSH: 'ready_to_push',
  /** Pushed to Xero, currently DRAFT */
  DRAFT_IN_XERO: 'draft_in_xero',
  /** Xero status promoted to AUTHORISED */
  AUTHORISED_IN_XERO: 'authorised_in_xero',
  /** Xero status = PAID or reconciled */
  RECONCILED_IN_XERO: 'reconciled_in_xero',
  /** Bank deposit matched and confirmed */
  BANK_VERIFIED: 'bank_verified',
  /** Found in Xero via scan — not pushed by Xettle (legacy / LinkMyBooks) */
  SYNCED_EXTERNAL: 'synced_external',
  /** Before accounting boundary; never pushed to Xero */
  ALREADY_RECORDED: 'already_recorded',
  /** Transient push failure; retryable */
  PUSH_FAILED: 'push_failed',
  /** Exhausted retries */
  PUSH_FAILED_PERMANENT: 'push_failed_permanent',
  /** Fingerprint collision; suppressed */
  DUPLICATE: 'duplicate',
} as const;

export type SettlementStatus = typeof SETTLEMENT_STATUS[keyof typeof SETTLEMENT_STATUS];

/**
 * Valid transitions: from → [allowed next statuses]
 *
 * Push failures can retry back to ready_to_push.
 * Rollback (e.g. Xero undo) resets to saved.
 */
export const VALID_TRANSITIONS: Record<SettlementStatus, readonly SettlementStatus[]> = {
  [SETTLEMENT_STATUS.SAVED]: [
    SETTLEMENT_STATUS.READY_TO_PUSH,
    SETTLEMENT_STATUS.SYNCED_EXTERNAL,
    SETTLEMENT_STATUS.ALREADY_RECORDED,
    SETTLEMENT_STATUS.DUPLICATE,
  ],
  [SETTLEMENT_STATUS.READY_TO_PUSH]: [
    SETTLEMENT_STATUS.DRAFT_IN_XERO,
    SETTLEMENT_STATUS.AUTHORISED_IN_XERO, // Some Xero pushes auto-authorise
    SETTLEMENT_STATUS.SYNCED_EXTERNAL,
    SETTLEMENT_STATUS.PUSH_FAILED,
    SETTLEMENT_STATUS.SAVED, // Rollback
  ],
  [SETTLEMENT_STATUS.DRAFT_IN_XERO]: [
    SETTLEMENT_STATUS.AUTHORISED_IN_XERO,
    SETTLEMENT_STATUS.RECONCILED_IN_XERO,
    SETTLEMENT_STATUS.SAVED, // Rollback / undo
  ],
  [SETTLEMENT_STATUS.AUTHORISED_IN_XERO]: [
    SETTLEMENT_STATUS.RECONCILED_IN_XERO,
    SETTLEMENT_STATUS.BANK_VERIFIED,
    SETTLEMENT_STATUS.SAVED, // Rollback
  ],
  [SETTLEMENT_STATUS.RECONCILED_IN_XERO]: [
    SETTLEMENT_STATUS.BANK_VERIFIED,
  ],
  [SETTLEMENT_STATUS.BANK_VERIFIED]: [],
  [SETTLEMENT_STATUS.SYNCED_EXTERNAL]: [
    SETTLEMENT_STATUS.RECONCILED_IN_XERO,
    SETTLEMENT_STATUS.BANK_VERIFIED,
    SETTLEMENT_STATUS.SAVED, // Undo "mark as synced"
  ],
  [SETTLEMENT_STATUS.ALREADY_RECORDED]: [], // Terminal
  [SETTLEMENT_STATUS.PUSH_FAILED]: [
    SETTLEMENT_STATUS.READY_TO_PUSH, // Retry
    SETTLEMENT_STATUS.PUSH_FAILED_PERMANENT,
    SETTLEMENT_STATUS.SAVED, // Rollback
  ],
  [SETTLEMENT_STATUS.PUSH_FAILED_PERMANENT]: [
    SETTLEMENT_STATUS.SAVED, // Manual reset
  ],
  [SETTLEMENT_STATUS.DUPLICATE]: [], // Terminal
};

/**
 * Validate a status transition. Returns true if the transition is allowed.
 * Use this before updating settlement status in any write path.
 */
export function isValidTransition(
  from: string | null | undefined,
  to: string,
): boolean {
  // Allow initial write (null/undefined → saved)
  if (!from && to === SETTLEMENT_STATUS.SAVED) return true;
  if (!from && to === SETTLEMENT_STATUS.READY_TO_PUSH) return true;
  if (!from && to === SETTLEMENT_STATUS.ALREADY_RECORDED) return true;
  if (!from) return false;

  const allowed = VALID_TRANSITIONS[from as SettlementStatus];
  if (!allowed) return false;
  return allowed.includes(to as SettlementStatus);
}

/**
 * Helper: statuses that mean "needs attention / action from user"
 */
export const ATTENTION_STATUSES: readonly SettlementStatus[] = [
  SETTLEMENT_STATUS.SAVED,
  SETTLEMENT_STATUS.PUSH_FAILED,
  SETTLEMENT_STATUS.PUSH_FAILED_PERMANENT,
];

/**
 * Helper: statuses that mean "in Xero" (any form)
 */
export const XERO_LINKED_STATUSES: readonly SettlementStatus[] = [
  SETTLEMENT_STATUS.DRAFT_IN_XERO,
  SETTLEMENT_STATUS.AUTHORISED_IN_XERO,
  SETTLEMENT_STATUS.RECONCILED_IN_XERO,
  SETTLEMENT_STATUS.SYNCED_EXTERNAL,
];

/**
 * Helper: statuses that are syncable (can be pushed to Xero)
 */
export const SYNCABLE_STATUSES: readonly SettlementStatus[] = [
  SETTLEMENT_STATUS.SAVED,
  SETTLEMENT_STATUS.READY_TO_PUSH,
];

/**
 * MIGRATION NOTE — Legacy status mapping
 *
 * The following legacy statuses should be treated as aliases:
 *   'parsed'        → use SAVED (parsed was a UI-upload intermediate state)
 *   'synced'        → use SYNCED_EXTERNAL
 *   'pushed_to_xero'→ use DRAFT_IN_XERO or AUTHORISED_IN_XERO
 *   'deposit_matched'→ use BANK_VERIFIED
 *   'verified_payout'→ use BANK_VERIFIED
 *
 * Until all rows are migrated, readers should normalise via normaliseStatus().
 */
export function normaliseStatus(raw: string | null | undefined): SettlementStatus {
  if (!raw) return SETTLEMENT_STATUS.SAVED;
  const LEGACY_MAP: Record<string, SettlementStatus> = {
    parsed: SETTLEMENT_STATUS.SAVED,
    synced: SETTLEMENT_STATUS.SYNCED_EXTERNAL,
    pushed_to_xero: SETTLEMENT_STATUS.DRAFT_IN_XERO,
    deposit_matched: SETTLEMENT_STATUS.BANK_VERIFIED,
    verified_payout: SETTLEMENT_STATUS.BANK_VERIFIED,
  };
  return LEGACY_MAP[raw] ?? (raw as SettlementStatus);
}
