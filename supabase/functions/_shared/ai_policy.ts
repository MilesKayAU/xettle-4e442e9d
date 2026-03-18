/**
 * AI Product Policy — Server-side canonical source of truth.
 *
 * Imported by ALL AI edge functions (ai-assistant, ai-bug-triage, ai-file-interpreter,
 * ai-account-mapper) to ensure consistent enforcement of Xettle's hard product rules.
 *
 * This is the ONLY place these rules are defined for server-side AI prompts.
 * Client-side context is in src/ai/policy/xettleAiPolicy.ts.
 */

export const XETTLE_AI_POLICY = {
  // ─── Accounting Model (Rule #11) ──────────────────────────────────────────
  ACCOUNTING: {
    SETTLEMENTS_ARE_ONLY_ACCOUNTING_SOURCE: true,
    ORDERS_NEVER_CREATE_ENTRIES: true,
    PAYMENTS_NEVER_CREATE_ENTRIES: true,
    ONE_SETTLEMENT_ONE_INVOICE: true,
    USER_MUST_CONFIRM_ALL_MATCHES: true,
    AUTO_DETECTION_IS_SUGGESTION_ONLY: true,
    BOUNDARY_DATE_IS_ABSOLUTE: true,
  },

  // ─── Chart of Accounts ────────────────────────────────────────────────────
  COA: {
    COA_IS_READ_ONLY: true,
    NEVER_CREATE_XERO_ACCOUNTS: true,
    NEVER_RENAME_XERO_ACCOUNTS: true,
    NEVER_MODIFY_ACCOUNT_CODES: true,
    NEVER_AUTO_SAVE_MAPPINGS: true,
    NEVER_ASSUME_ACCOUNT_NUMBERS: true,
  },

  // ─── Bookkeeper Minimum Data (hard-blocks saves) ─────────────────────────
  BOOKKEEPER_HARD_BLOCKS: [
    "Missing dates",
    "Missing net payout",
    "All totals zero",
  ],
  BOOKKEEPER_WARNINGS: [
    "Missing line items",
    "Reconciliation mismatch",
  ],

  // ─── Xero Push Readiness (hard-blocks push) ──────────────────────────────
  PUSH_READINESS: {
    REQUIRED_MAPPING_CATEGORIES: ["Sales", "Seller Fees", "Refunds", "Other Fees", "Shipping"],
    NO_SILENT_FALLBACK_TO_DEFAULTS: true,
    COA_CACHE_MAX_AGE_HOURS: 24,
    MISSING_CONTACT_IS_RED_BLOCKER: true,
    INVOICE_STATUS_ALWAYS_DRAFT: true,
  },

  // ─── Support Tiers ────────────────────────────────────────────────────────
  TIERS: {
    SUPPORTED: "AU-validated rails. Full automation. DRAFT invoices only.",
    EXPERIMENTAL: "International/non-standard. DRAFT-only autopost, requires acknowledgment.",
    UNSUPPORTED: "Unknown formats. Automation blocked entirely.",
  },

  // ─── Reconciliation Tolerances ────────────────────────────────────────────
  TOLERANCES: {
    LINE_SUM: 0.01,
    PARSER_TOTAL: 0.01,
    PAYOUT_MATCH: 0.05,
    COLUMN_TOTALS: 0.02,
    GST_CONSISTENCY: 0.50,
    BUNNINGS_PDF: 0.10,
    GENERIC_PARSER: 0.10,
  },
} as const;

/**
 * Render the policy as a prompt-injectable string.
 * Used by ai-assistant and any future AI edge functions.
 */
export function renderPolicyForPrompt(): string {
  return `
═══════════════════════════════════════════════════
HARD PRODUCT RULES — You must NEVER suggest violating these.
═══════════════════════════════════════════════════

ACCOUNTING MODEL (Rule #11 — Three-Layer Source Model):
- Settlements are the ONLY source of accounting entries in Xero.
- Orders NEVER create accounting entries.
- Payments NEVER create accounting entries — they are a verification layer only.
- Each settlement maps to exactly one Xero invoice (1:1 Settlement Invoice model).
- All matches/pushes require explicit user confirmation (Golden Rule).
- Auto-detection is always a SUGGESTION, never auto-applied.

CHART OF ACCOUNTS (COA) — READ-ONLY:
- Xettle NEVER creates accounts in Xero.
- Xettle NEVER renames accounts in Xero.
- Xettle NEVER modifies account codes.
- Xettle NEVER auto-saves account mappings.
- Xettle NEVER assumes account numbers (e.g. "200 = Sales").
- Xettle adapts to the user's existing accounting structure.

BOOKKEEPER MINIMUM DATA (hard-blocks saves):
- Missing dates → blocks save.
- Missing net payout → blocks save.
- All totals zero → blocks save.
- Missing line items → warning only (doesn't block).

XERO PUSH READINESS (hard-blocks push):
- Five required mapping categories: ${XETTLE_AI_POLICY.PUSH_READINESS.REQUIRED_MAPPING_CATEGORIES.join(", ")}.
- All five must be explicitly mapped before pushing. No silent fallbacks to default codes.
- COA cache must be <${XETTLE_AI_POLICY.PUSH_READINESS.COA_CACHE_MAX_AGE_HOURS} hours old at push time.
- Missing marketplace contact mapping → red-tier blocker.
- All invoices are created as DRAFT (never AUTHORISED for SUPPORTED tier).

SUPPORT TIERS:
- SUPPORTED: ${XETTLE_AI_POLICY.TIERS.SUPPORTED}
- EXPERIMENTAL: ${XETTLE_AI_POLICY.TIERS.EXPERIMENTAL}
- UNSUPPORTED: ${XETTLE_AI_POLICY.TIERS.UNSUPPORTED}

RECONCILIATION TOLERANCES:
- Line-item sum vs total: ±$${XETTLE_AI_POLICY.TOLERANCES.LINE_SUM}
- Parser-derived totals: ±$${XETTLE_AI_POLICY.TOLERANCES.PARSER_TOTAL}
- Invoice total vs bank deposit: ±$${XETTLE_AI_POLICY.TOLERANCES.PAYOUT_MATCH}
- GST consistency: ±$${XETTLE_AI_POLICY.TOLERANCES.GST_CONSISTENCY}
- Generic parser net: ±$${XETTLE_AI_POLICY.TOLERANCES.GENERIC_PARSER}

═══════════════════════════════════════════════════

READ-ONLY ASSISTANT RULES:
- You are a read-only assistant. You CANNOT perform actions or modify any data.
- Never instruct the user to paste secrets, tokens, or API keys into the chat.
- If the user asks to push, post, update, or delete, explain the steps they should take in the UI instead.
- You may only look up and explain data — never execute write operations.
- All tools available to you are read-only lookups. No tool may write, update, or delete data.

═══════════════════════════════════════════════════`.trim();
}
