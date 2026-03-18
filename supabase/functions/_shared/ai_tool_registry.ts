/**
 * AI Tool Registry — Single source of truth for tool definitions and route availability.
 *
 * Shared between server (ai-assistant edge function) and client (context/capabilities).
 * The backend imports this directly; the client mirrors it for display/filtering only.
 *
 * RULES:
 * - Components MUST NOT call tools directly — they go through the assistant only.
 * - Tools are only offered to the model when the current routeId is in `availableOn`.
 * - An empty `availableOn` array means the tool is available on ALL routes.
 */

export interface AiToolParam {
  type: string;
  description: string;
}

export interface AiToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, AiToolParam>;
    required: string[];
  };
  /** Route IDs where this tool is relevant. Empty = all routes. */
  availableOn: string[];
}

// ─── Canonical Tool Definitions ──────────────────────────────────────────────

export const AI_TOOL_REGISTRY: AiToolDef[] = [
  // ── Summary / Overview Tools ───────────────────────────────────────────────
  {
    name: "getPageReadinessSummary",
    description:
      "Get summary counts: outstanding invoices by state, settlements by status, ready-to-push counts, gap warnings. Use when user asks about overall status or what needs attention.",
    parameters: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "The current page route ID" },
      },
      required: ["routeId"],
    },
    availableOn: ["dashboard", "outstanding", "settlements", "insights", "setup"],
  },
  {
    name: "listRecentSettlements",
    description:
      "List the most recent settlements with their status, marketplace, period, and Xero push state. Use when user asks about recent uploads, what's been processed, or needs an overview of settlement activity.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "string", description: "Number of settlements to return (default 10, max 20)" },
        marketplace: { type: "string", description: "Optional: filter by marketplace code (e.g. amazon_au, shopify_payments)" },
      },
      required: [],
    },
    availableOn: ["dashboard", "settlements", "insights"],
  },

  // ── Entity Lookup Tools ────────────────────────────────────────────────────
  {
    name: "getInvoiceStatusByXeroInvoiceId",
    description:
      "Get match state, payment status, and readiness of a specific Xero invoice. Use when user asks about a specific invoice.",
    parameters: {
      type: "object",
      properties: {
        xeroInvoiceId: { type: "string", description: "The Xero invoice ID" },
      },
      required: ["xeroInvoiceId"],
    },
    availableOn: ["outstanding", "settlements", "settlement_detail", "xero_posting_audit"],
  },
  {
    name: "getSettlementStatus",
    description:
      "Get posting state, readiness blockers, and Xero sync status for a specific settlement. Use when user asks about a settlement's status or readiness.",
    parameters: {
      type: "object",
      properties: {
        settlementId: { type: "string", description: "The settlement ID" },
      },
      required: ["settlementId"],
    },
    availableOn: [
      "settlements",
      "settlement_detail",
      "push_safety_preview",
      "xero_posting_audit",
      "dashboard",
    ],
  },

  // ── Event / History Tools ──────────────────────────────────────────────────
  {
    name: "getRecentSystemEvents",
    description:
      "Get the last N system events (uploads, syncs, pushes, errors) for context on what the user has recently done. Use when the user references a recent action or you need to understand their workflow history.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "string", description: "Number of events to return (default 10, max 25)" },
        eventType: { type: "string", description: "Optional: filter by event_type (e.g. settlement_uploaded, xero_push, sync_complete, error)" },
      },
      required: [],
    },
    availableOn: [], // All routes
  },

  // ── Explainer / Deterministic Logic Tools ──────────────────────────────────
  {
    name: "explainReadinessBlockers",
    description:
      "Explain why a settlement cannot be pushed to Xero. Returns deterministic product logic: missing account mappings, stale COA cache, missing contact, and support tier status. Use when user asks 'why can't I push?' or 'what's blocking this?'.",
    parameters: {
      type: "object",
      properties: {
        settlementId: { type: "string", description: "The settlement ID to check readiness for" },
      },
      required: ["settlementId"],
    },
    availableOn: [
      "settlements",
      "settlement_detail",
      "push_safety_preview",
      "settings",
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return only the tools available for a given route.
 * If routeId is undefined/null, returns all tools.
 */
export function getToolsForRoute(routeId?: string | null): AiToolDef[] {
  if (!routeId) return AI_TOOL_REGISTRY;
  return AI_TOOL_REGISTRY.filter(
    (t) => t.availableOn.length === 0 || t.availableOn.includes(routeId),
  );
}

/**
 * Convert filtered tools to OpenAI function-calling format for the gateway.
 */
export function toOpenAIToolDefs(tools: AiToolDef[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Get tool names available on a route (for client-side capabilities field).
 */
export function getToolNamesForRoute(routeId: string): string[] {
  return getToolsForRoute(routeId).map((t) => t.name);
}
