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
    AI_NEVER_CREATES_ACCOUNTS: true,
    AI_NEVER_RENAMES_ACCOUNTS: true,
    AI_NEVER_MODIFIES_ACCOUNT_CODES: true,
    AI_NEVER_AUTO_SAVES_MAPPINGS: true,
    AI_NEVER_ASSUMES_ACCOUNT_NUMBERS: true,
    APP_CAN_CLONE_COA_WITH_APPROVAL: true,
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

CHART OF ACCOUNTS (COA):
- The AI assistant NEVER creates, renames, or modifies Xero accounts directly.
- The AI assistant NEVER auto-saves account mappings or assumes account numbers (e.g. "200 = Sales").
- However, Xettle DOES have a COA Cloning feature that can create new accounts in Xero.
  This requires PIN verification and explicit user confirmation via the Clone COA dialog in Settings.
- If a user needs new accounts for a marketplace, guide them to the COA Clone flow
  in Settings, or they can create accounts manually in Xero and refresh the cache.
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

/**
 * Page-specific explainer blocks injected into the AI system prompt
 * based on the routeId from AiPageContext.
 */
export function renderPageExplainers(routeId?: string | null): string {
  if (!routeId) return '';

  const explainers: Record<string, string> = {
    settlements: `
PAGE-SPECIFIC KNOWLEDGE — Marketplace Settlements:
- "File Reconciliation" is an internal consistency check on each settlement file. Green tick = the file's numbers add up correctly (Sales − Fees + Refunds ≈ Net Payout). Orange warning = the internal figures don't balance and the settlement needs review.
- "check required" means the settlement failed this maths check. The user should review it before pushing to Xero. Settlements with failed reconciliation are BLOCKED from being pushed — the Push button is replaced with a "Fix recon first" warning.
- To investigate a flagged settlement: click the settlement row in the File Reconciliation card OR click the eye icon (👁) on the settlement table row. This opens a detail panel showing the full line-item breakdown, reconciliation gap, and audit trail.
- If the data looks wrong, the user can delete the settlement and re-upload the corrected file.
- Settlement ID formats: BUN-2301-YYYY-MM-DD = Bunnings PDF upload. shopify_auto_X = auto-generated from Shopify orders. AMZ-xxx = Amazon API sync. EBAY-xxx = eBay API sync.
- Columns: Sales = gross revenue inc GST. Fees = marketplace commission deducted. Refunds = returned order amounts. Net = what lands in the bank account.
- A negative Net means fees and refunds exceeded sales for that period — this is normal for low-volume or refund-heavy periods.
- "Pushed to Xero" means a DRAFT invoice was created. "Bank Verified" means the bank deposit has been matched.
- The user can click any settlement row to see the line-item breakdown, or use the eye icon to open the full detail panel.`,

    outstanding: `
PAGE-SPECIFIC KNOWLEDGE — Outstanding Invoices:
- This page shows Xero invoices that have been pushed but are still awaiting bank payment confirmation.
- "Amount Due" is the remaining balance on the invoice in Xero.
- Users can match bank deposits to invoices using the "Verify Payment" flow.
- Outstanding invoices will move to "Complete" once a matching bank transaction is confirmed.`,

    dashboard: `
PAGE-SPECIFIC KNOWLEDGE — Dashboard:
- The dashboard shows three key areas: Sync Status (API connection health), Recent Activity (latest uploads and pushes), and Action Items (settlements needing attention).
- Settlement counts shown here are across ALL marketplaces combined.
- The "Ready for Xero" count shows settlements that have passed all checks and can be pushed.`,

    insights: `
PAGE-SPECIFIC KNOWLEDGE — Insights:
- This page shows financial trends, fee analysis, and marketplace comparisons over time.
- All figures are derived from saved settlement data — not live API queries.
- Fee percentages show what percentage of gross sales each marketplace takes in fees.
- Margin % shows net payout as a percentage of gross sales.`,
  };

  return explainers[routeId] ?? '';
}
