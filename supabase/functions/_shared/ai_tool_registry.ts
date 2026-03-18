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
