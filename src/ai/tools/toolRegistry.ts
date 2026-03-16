/**
 * AI Tool Registry — Client-side tool definitions for the AI assistant.
 *
 * These are sent to the ai-assistant edge function which executes them server-side.
 * Components MUST NOT call these tools directly — they go through the assistant only.
 *
 * V1 tools:
 * 1. getPageReadinessSummary — summary counts for a given route
 * 2. getInvoiceStatusByXeroInvoiceId — match state for a specific invoice
 * 3. getSettlementStatus — readiness/posting state for a settlement
 */

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const AI_TOOLS: AiToolDefinition[] = [
  {
    name: 'getPageReadinessSummary',
    description: 'Get summary counts for the current page: outstanding invoices by state, settlements by status, ready-to-push counts, and gap warnings.',
    parameters: {
      type: 'object',
      properties: {
        routeId: { type: 'string', description: 'The current page route ID (e.g., outstanding, dashboard, settlements)' },
      },
      required: ['routeId'],
    },
  },
  {
    name: 'getInvoiceStatusByXeroInvoiceId',
    description: 'Get the match state, payment status, and readiness of a specific Xero invoice. Returns whether it is matched to a settlement, if it is already paid/voided, and any readiness blockers.',
    parameters: {
      type: 'object',
      properties: {
        xeroInvoiceId: { type: 'string', description: 'The Xero invoice ID to look up' },
      },
      required: ['xeroInvoiceId'],
    },
  },
  {
    name: 'getSettlementStatus',
    description: 'Get the posting state, readiness blockers, and Xero sync status for a specific settlement. Returns whether it has been pushed to Xero, its tier, and any issues preventing posting.',
    parameters: {
      type: 'object',
      properties: {
        settlementId: { type: 'string', description: 'The settlement ID to look up' },
      },
      required: ['settlementId'],
    },
  },
];

/** Convert tool definitions to Anthropic format for the API call */
export function getAnthropicToolDefs() {
  return AI_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}
