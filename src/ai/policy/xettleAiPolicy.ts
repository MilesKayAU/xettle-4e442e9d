/**
 * AI Product Policy — Client-side mirror for context/capabilities awareness.
 *
 * This is a lightweight client-side reference of Xettle's hard product rules.
 * The canonical enforcement source is supabase/functions/_shared/ai_policy.ts.
 *
 * Used by:
 * - AiContextProvider (to expose capabilities in page context)
 * - Components that need to check what the AI can/cannot do
 */

export const XETTLE_AI_CAPABILITIES = {
  /** Things the AI assistant CAN help with */
  CAN_DO: [
    "Explain settlement data and what each field means",
    "Summarise outstanding invoices, readiness, and gaps",
    "Look up specific settlement or invoice status via tools",
    "Explain reconciliation mismatches and suggest next steps",
    "Describe fee breakdowns and marketplace comparisons",
    "Help interpret GST obligations from settlement data",
    "Guide users through the upload → map → push workflow",
    "Explain what's blocking a push and how to fix it",
    "Guide users to the COA Clone flow for creating new marketplace accounts in Xero",
  ],

  /** Things the AI assistant must NEVER suggest */
  CANNOT_DO: [
    "Create, rename, or modify Xero accounts directly (the COA Clone feature handles account creation with PIN approval)",
    "Auto-save account mappings without user confirmation",
    "Assume account numbers (e.g. '200 = Sales')",
    "Create accounting entries from orders or payments",
    "Push to Xero without all 5 mapping categories",
    "Skip the PushSafetyPreview confirmation step",
    "Mark bank matches as confirmed without user action",
    "Use AUTHORISED invoice status for SUPPORTED tier",
  ],

  /** Hard product limits to expose in page context */
  LIMITS: {
    monthlyQuestionLimit: 50,
    maxToolRounds: 3,
    requiredMappingCategories: ["Sales", "Seller Fees", "Refunds", "Other Fees", "Shipping"],
    coaCacheMaxAgeHours: 24,
    reconciliationTolerances: {
      lineSum: 0.01,
      parserTotal: 0.01,
      payoutMatch: 0.05,
      gstConsistency: 0.50,
    },
  },
} as const;
