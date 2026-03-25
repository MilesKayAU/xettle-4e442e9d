/**
 * AI Tool Registry — Client-side mirror of the canonical server registry.
 *
 * This file re-exports types and a static copy of the tool metadata so that
 * client components (e.g., AiChatPanel, AskAiButton) can display tool
 * capabilities and filter by route WITHOUT importing from supabase/functions.
 *
 * IMPORTANT: If you add/remove tools, update supabase/functions/_shared/ai_tool_registry.ts
 * (the server source of truth) and then sync this file.
 *
 * DRIFT DETECTION: The server exports EXPECTED_TOOL_COUNT = 6.
 * If you change tool count on the server, update the assertion below.
 */

// ─── Types (mirrored from server) ────────────────────────────────────────────

export interface AiToolDef {
  name: string;
  description: string;
  availableOn: string[];
}

// ─── Drift Detection ─────────────────────────────────────────────────────────

/** Must match EXPECTED_TOOL_COUNT in supabase/functions/_shared/ai_tool_registry.ts */
export const EXPECTED_TOOL_COUNT = 7;

// ─── Static registry (synced from server canonical) ──────────────────────────

export const AI_TOOL_REGISTRY: AiToolDef[] = [
  {
    name: "getPageReadinessSummary",
    description: "[Read-only] Get summary counts: outstanding invoices, settlements by status, ready-to-push counts, gap warnings.",
    availableOn: ["dashboard", "outstanding", "settlements", "insights", "setup"],
  },
  {
    name: "listRecentSettlements",
    description: "[Read-only] List recent settlements with status, marketplace, period, and Xero push state.",
    availableOn: ["dashboard", "settlements", "insights"],
  },
  {
    name: "getInvoiceStatusByXeroInvoiceId",
    description: "[Read-only] Get match state, payment status, and readiness of a specific Xero invoice.",
    availableOn: ["outstanding", "settlements", "settlement_detail", "xero_posting_audit"],
  },
  {
    name: "getSettlementStatus",
    description: "[Read-only] Get posting state, readiness blockers, and Xero sync status for a specific settlement.",
    availableOn: ["settlements", "settlement_detail", "push_safety_preview", "xero_posting_audit", "dashboard"],
  },
  {
    name: "getRecentSystemEvents",
    description: "[Read-only] Get recent system events (uploads, syncs, pushes, errors) to understand workflow history.",
    availableOn: [], // All routes
  },
  {
    name: "explainReadinessBlockers",
    description: "[Read-only] Explain why a settlement can't be pushed: missing mappings, stale COA, missing contact, support tier.",
    availableOn: ["settlements", "settlement_detail", "push_safety_preview", "settings"],
  },
  {
    name: "analyzeReconciliationGap",
    description: "[Read-only] Analyze a settlement's reconciliation gap: financial breakdown, diagnosis, and whether the gap is real or an artifact.",
    availableOn: ["dashboard", "settlements", "settlement_detail"],
  },
];

// Runtime drift check (development aid — logs warning if count mismatches)
if (AI_TOOL_REGISTRY.length !== EXPECTED_TOOL_COUNT) {
  console.warn(
    `[aiToolRegistry] DRIFT DETECTED: Client has ${AI_TOOL_REGISTRY.length} tools but EXPECTED_TOOL_COUNT is ${EXPECTED_TOOL_COUNT}. Sync with server registry.`,
  );
}

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
