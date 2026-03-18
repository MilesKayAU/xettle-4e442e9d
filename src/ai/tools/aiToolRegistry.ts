/**
 * AI Tool Registry — Client-side mirror of the canonical server registry.
 *
 * This file re-exports types and a static copy of the tool metadata so that
 * client components (e.g., AiChatPanel, AskAiButton) can display tool
 * capabilities and filter by route WITHOUT importing from supabase/functions.
 *
 * IMPORTANT: If you add/remove tools, update supabase/functions/_shared/ai_tool_registry.ts
 * (the server source of truth) and then sync this file.
 */

// ─── Types (mirrored from server) ────────────────────────────────────────────

export interface AiToolDef {
  name: string;
  description: string;
  availableOn: string[];
}

// ─── Static registry (synced from server canonical) ──────────────────────────

export const AI_TOOL_REGISTRY: AiToolDef[] = [
  {
    name: "getPageReadinessSummary",
    description: "Get summary counts: outstanding invoices, settlements by status, ready-to-push counts, gap warnings.",
    availableOn: ["dashboard", "outstanding", "settlements", "insights", "setup"],
  },
  {
    name: "getInvoiceStatusByXeroInvoiceId",
    description: "Get match state, payment status, and readiness of a specific Xero invoice.",
    availableOn: ["outstanding", "settlements", "settlement_detail", "xero_posting_audit"],
  },
  {
    name: "getSettlementStatus",
    description: "Get posting state, readiness blockers, and Xero sync status for a specific settlement.",
    availableOn: ["settlements", "settlement_detail", "push_safety_preview", "xero_posting_audit", "dashboard"],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return tool names available for the given routeId */
export function getToolNamesForRoute(routeId: string): string[] {
  return AI_TOOL_REGISTRY
    .filter(t => t.availableOn.length === 0 || t.availableOn.includes(routeId))
    .map(t => t.name);
}

/** Return tool metadata available for the given routeId */
export function getToolsForRoute(routeId: string): AiToolDef[] {
  return AI_TOOL_REGISTRY.filter(
    t => t.availableOn.length === 0 || t.availableOn.includes(routeId),
  );
}
