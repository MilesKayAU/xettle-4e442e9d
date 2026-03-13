/**
 * ACCOUNTING RULES — Canonical constant file
 * 
 * These rules are SYSTEM-ENFORCED and apply to all sync/push paths.
 * The user's `accounting_boundary_date` setting determines WHEN the
 * boundary takes effect, but the boundary logic itself is non-negotiable.
 * 
 * Referenced at the entry point of every payment and sync function.
 * 
 * See: ARCHITECTURE.md Rule #11 — Three-Layer Accounting Source Model
 */

export const ACCOUNTING_RULES = {
  SETTLEMENTS_ARE_ONLY_ACCOUNTING_SOURCE: true,
  ORDERS_NEVER_CREATE_ACCOUNTING_ENTRIES: true,
  PAYMENTS_NEVER_CREATE_ACCOUNTING_ENTRIES: true,
  USER_MUST_CONFIRM_ALL_MATCHES: true,
  /** Boundary logic is system-enforced; user boundary date determines behaviour. */
  BOUNDARY_DATE_IS_ABSOLUTE: true,
} as const;

/**
 * Standard comment block to embed at the entry point of edge functions
 * (which cannot import from src/).
 * 
 * Copy this verbatim into every payment matching and sync function:
 * 
 * // ══════════════════════════════════════════════════════════════
 * // ACCOUNTING RULES (hardcoded, never configurable)
 * // Canonical source: src/constants/accounting-rules.ts
 * // 
 * // Rule #11 — Three-Layer Accounting Source Model:
 * //   Orders     → NEVER create accounting entries
 * //   Payments   → NEVER create accounting entries
 * //   Settlements → ONLY source of accounting entries
 * //
 * // PAYMENT VERIFICATION LAYER ONLY
 * // This function never creates accounting entries.
 * // No invoice. No journal. No Xero push.
 * // Settlements are the only accounting source.
 * //
 * // Nothing is marked as matched until user explicitly confirms.
 * // Auto-detection is always a SUGGESTION.
 * // ══════════════════════════════════════════════════════════════
 */
