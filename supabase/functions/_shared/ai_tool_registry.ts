/**
 * AI Tool Registry — Single source of truth for tool definitions, execution, and route availability.
 *
 * Shared between server (ai-assistant edge function) and client (context/capabilities).
 * The backend imports this directly; the client mirrors it for display/filtering only.
 *
 * RULES:
 * - Components MUST NOT call tools directly — they go through the assistant only.
 * - Tools are only offered to the model when the current routeId is in `availableOn`.
 * - An empty `availableOn` array means the tool is available on ALL routes.
 * - ALL tools are READ-ONLY lookups. No tool may write, update, or delete data.
 */

// ─── Read-Only Policy ────────────────────────────────────────────────────────

export const READ_ONLY_POLICY =
  "All tools are read-only lookups. No tool may write, update, or delete data. The assistant must never attempt write operations.";

export const EXPECTED_TOOL_COUNT = 7;

// ─── Types ───────────────────────────────────────────────────────────────────

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
      "[Read-only] Get summary counts: outstanding invoices by state, settlements by status, ready-to-push counts, gap warnings. This is a lookup-only tool that does not modify any data.",
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
      "[Read-only] List the most recent settlements with their status, marketplace, period, and Xero push state. This is a lookup-only tool that does not modify any data.",
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
      "[Read-only] Get match state, payment status, and readiness of a specific Xero invoice. This is a lookup-only tool that does not modify any data.",
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
      "[Read-only] Get posting state, readiness blockers, and Xero sync status for a specific settlement. This is a lookup-only tool that does not modify any data.",
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
      "[Read-only] Get the last N system events (uploads, syncs, pushes, errors) for context on what the user has recently done. This is a lookup-only tool that does not modify any data.",
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
      "[Read-only] Explain why a settlement cannot be pushed to Xero. Returns deterministic product logic: missing account mappings, stale COA cache, missing contact, and support tier status. This is a lookup-only tool that does not modify any data.",
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

  // ── Gap Analysis Tool ──────────────────────────────────────────────────────
  {
    name: "analyzeReconciliationGap",
    description:
      "[Read-only] Analyze a settlement's reconciliation gap. Returns financial breakdown, gap amount, rule-based diagnosis, and whether the gap is likely real or a data artifact. This is a lookup-only tool that does not modify any data.",
    parameters: {
      type: "object",
      properties: {
        settlementId: { type: "string", description: "The settlement ID to analyze the gap for" },
      },
      required: ["settlementId"],
    },
    availableOn: ["dashboard", "settlements", "settlement_detail"],
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

// ─── Tool Execution (Single Dispatcher) ──────────────────────────────────────

/**
 * Execute a tool by name. All tools are READ-ONLY lookups.
 * This is the single dispatcher for all AI tool execution.
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: string,
  serviceClient: any,
): Promise<string> {
  try {
    switch (toolName) {
      case "getPageReadinessSummary": {
        const [settlementsRes, outstandingRes, readyRes, pushedRes, gapRes] = await Promise.all([
          serviceClient.from("settlements")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("is_hidden", false),
          serviceClient.from("outstanding_invoices_cache")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId),
          serviceClient.from("settlements")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("status", "ready_to_push")
            .eq("is_hidden", false)
            .eq("is_pre_boundary", false),
          serviceClient.from("settlements")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .not("xero_invoice_id", "is", null),
          serviceClient.from("marketplace_validation")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("overall_status", "gap_detected"),
        ]);

        const { data: statusBreakdown } = await serviceClient
          .from("settlements")
          .select("xero_status, status")
          .eq("user_id", userId)
          .eq("is_hidden", false)
          .not("xero_invoice_id", "is", null)
          .limit(500);

        const xeroStatusCounts: Record<string, number> = {};
        for (const s of (statusBreakdown || [])) {
          const key = s.xero_status || s.status || "unknown";
          xeroStatusCounts[key] = (xeroStatusCounts[key] || 0) + 1;
        }

        return JSON.stringify({
          total_settlements: settlementsRes.count ?? 0,
          outstanding_invoices: outstandingRes.count ?? 0,
          ready_to_push: readyRes.count ?? 0,
          already_pushed_to_xero: pushedRes.count ?? 0,
          gaps_detected: gapRes.count ?? 0,
          xero_status_breakdown: xeroStatusCounts,
        });
      }

      case "getInvoiceStatusByXeroInvoiceId": {
        const xeroInvoiceId = toolInput.xeroInvoiceId;
        const { data: cached } = await serviceClient
          .from("outstanding_invoices_cache")
          .select("*")
          .eq("user_id", userId)
          .eq("xero_invoice_id", xeroInvoiceId)
          .maybeSingle();

        const { data: settlement } = await serviceClient
          .from("settlements")
          .select("settlement_id, marketplace, status, xero_status, xero_invoice_id, xero_invoice_number, bank_verified, posting_state, period_start, period_end, bank_deposit")
          .eq("user_id", userId)
          .eq("xero_invoice_id", xeroInvoiceId)
          .maybeSingle();

        return JSON.stringify({
          xero_invoice: cached ? {
            invoice_number: cached.invoice_number,
            contact: cached.contact_name,
            total: cached.total,
            status: cached.status,
            reference: cached.reference,
            date: cached.date,
            due_date: cached.due_date,
          } : null,
          matched_settlement: settlement ? {
            settlement_id: settlement.settlement_id,
            marketplace: settlement.marketplace,
            status: settlement.status,
            xero_status: settlement.xero_status,
            xero_invoice_number: settlement.xero_invoice_number,
            bank_verified: settlement.bank_verified,
            posting_state: settlement.posting_state,
            period: `${settlement.period_start} to ${settlement.period_end}`,
            bank_deposit: settlement.bank_deposit,
          } : null,
          is_in_xero: !!cached || !!settlement?.xero_invoice_id,
          needs_push: !settlement?.xero_invoice_id && !cached,
        });
      }

      case "getSettlementStatus": {
        const settlementId = toolInput.settlementId;
        const { data: settlement } = await serviceClient
          .from("settlements")
          .select("*")
          .eq("user_id", userId)
          .eq("settlement_id", settlementId)
          .maybeSingle();

        if (!settlement) {
          return JSON.stringify({ error: "Settlement not found", settlement_id: settlementId });
        }

        const { data: mappings } = await serviceClient
          .from("marketplace_account_mapping")
          .select("category, account_code")
          .eq("user_id", userId)
          .eq("marketplace_code", settlement.marketplace || "");

        const requiredCategories = ["Sales", "Seller Fees", "Refunds", "Other Fees", "Shipping"];
        const mappedCategories = new Set((mappings || []).map((m: any) => m.category));
        const missingMappings = requiredCategories.filter(c => !mappedCategories.has(c));

        return JSON.stringify({
          settlement_id: settlement.settlement_id,
          marketplace: settlement.marketplace,
          period: `${settlement.period_start} to ${settlement.period_end}`,
          status: settlement.status,
          xero_status: settlement.xero_status,
          xero_invoice_id: settlement.xero_invoice_id,
          xero_invoice_number: settlement.xero_invoice_number,
          posting_state: settlement.posting_state,
          bank_deposit: settlement.bank_deposit,
          bank_verified: settlement.bank_verified,
          is_pushed: !!settlement.xero_invoice_id,
          is_hidden: settlement.is_hidden,
          is_pre_boundary: settlement.is_pre_boundary,
          missing_account_mappings: missingMappings,
          readiness_blockers: missingMappings.length > 0
            ? [`Missing account mappings: ${missingMappings.join(", ")}`]
            : [],
        });
      }

      case "listRecentSettlements": {
        const limit = Math.min(parseInt(toolInput.limit || "10", 10) || 10, 20);
        const query = serviceClient
          .from("settlements")
          .select("settlement_id, marketplace, period_start, period_end, status, xero_status, xero_invoice_number, bank_deposit, bank_verified, posting_state, is_hidden, is_pre_boundary, created_at")
          .eq("user_id", userId)
          .eq("is_hidden", false)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (toolInput.marketplace) {
          query.eq("marketplace", toolInput.marketplace);
        }

        const { data: settlements, error: settErr } = await query;
        if (settErr) return JSON.stringify({ error: settErr.message });

        return JSON.stringify({
          count: (settlements || []).length,
          settlements: (settlements || []).map((s: any) => ({
            settlement_id: s.settlement_id,
            marketplace: s.marketplace,
            period: `${s.period_start} to ${s.period_end}`,
            status: s.status,
            xero_status: s.xero_status,
            xero_invoice_number: s.xero_invoice_number,
            bank_deposit: s.bank_deposit,
            bank_verified: s.bank_verified,
            posting_state: s.posting_state,
            is_pre_boundary: s.is_pre_boundary,
            created_at: s.created_at,
          })),
        });
      }

      case "getRecentSystemEvents": {
        const limit = Math.min(parseInt(toolInput.limit || "10", 10) || 10, 25);
        const query = serviceClient
          .from("system_events")
          .select("event_type, marketplace_code, settlement_id, period_label, severity, details, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (toolInput.eventType) {
          query.eq("event_type", toolInput.eventType);
        }

        const { data: events, error: evtErr } = await query;
        if (evtErr) return JSON.stringify({ error: evtErr.message });

        return JSON.stringify({
          count: (events || []).length,
          events: (events || []).map((e: any) => ({
            event_type: e.event_type,
            marketplace: e.marketplace_code,
            settlement_id: e.settlement_id,
            period: e.period_label,
            severity: e.severity,
            summary: typeof e.details === "object" && e.details?.message
              ? e.details.message
              : undefined,
            created_at: e.created_at,
          })),
        });
      }

      case "explainReadinessBlockers": {
        const sid = toolInput.settlementId;
        const { data: settlement } = await serviceClient
          .from("settlements")
          .select("settlement_id, marketplace, status, xero_status, xero_invoice_id, posting_state, is_hidden, is_pre_boundary")
          .eq("user_id", userId)
          .eq("settlement_id", sid)
          .maybeSingle();

        if (!settlement) {
          return JSON.stringify({ error: "Settlement not found", settlement_id: sid });
        }

        const blockers: string[] = [];
        const warnings: string[] = [];

        // Already pushed?
        if (settlement.xero_invoice_id) {
          return JSON.stringify({
            settlement_id: sid,
            marketplace: settlement.marketplace,
            can_push: false,
            reason: "already_pushed",
            blockers: [],
            warnings: [],
            message: `This settlement has already been pushed to Xero (invoice: ${settlement.xero_invoice_id}). Use Repost if you need to re-send.`,
          });
        }

        // Hidden or pre-boundary
        if (settlement.is_hidden) blockers.push("Settlement is hidden — unhide it first.");
        if (settlement.is_pre_boundary) blockers.push("Settlement is before the accounting boundary — it was already recorded in your prior system.");

        // Account mappings check (5 required categories)
        const { data: mappings } = await serviceClient
          .from("marketplace_account_mapping")
          .select("category, account_code")
          .eq("user_id", userId)
          .eq("marketplace_code", settlement.marketplace || "");

        const requiredCategories = ["Sales", "Seller Fees", "Refunds", "Other Fees", "Shipping"];
        const mappedCategories = new Set((mappings || []).map((m: any) => m.category));
        const missingMappings = requiredCategories.filter(c => !mappedCategories.has(c));
        if (missingMappings.length > 0) {
          blockers.push(`Missing account mappings: ${missingMappings.join(", ")}. Go to Settings → Account Mapper to configure.`);
        }

        // COA cache freshness
        const { data: coaSetting } = await serviceClient
          .from("app_settings")
          .select("value")
          .eq("user_id", userId)
          .eq("key", "accounting_xero_account_codes")
          .maybeSingle();

        if (!coaSetting?.value) {
          blockers.push("No Xero Chart of Accounts cached. Connect Xero and refresh your COA.");
        } else {
          try {
            const parsed = JSON.parse(coaSetting.value);
            const cachedAt = parsed?._cached_at || parsed?._refreshed_at;
            if (cachedAt) {
              const ageMs = Date.now() - new Date(cachedAt).getTime();
              const ageHours = ageMs / (1000 * 60 * 60);
              if (ageHours > 24) {
                warnings.push(`COA cache is ${Math.round(ageHours)} hours old. Refresh recommended before pushing.`);
              }
            }
          } catch { /* ignore parse errors */ }
        }

        // Xero connection
        const { data: tenantSetting } = await serviceClient
          .from("app_settings")
          .select("value")
          .eq("user_id", userId)
          .eq("key", "xero_tenant_id")
          .maybeSingle();

        if (!tenantSetting?.value) {
          blockers.push("Xero is not connected. Connect Xero in Settings first.");
        }

        // Support tier check
        const marketplace = settlement.marketplace || "";
        const supportedRails = [
          "amazon_au", "shopify_payments", "shopify_orders", "ebay_au",
          "bunnings", "catch", "mydeal", "kogan", "woolworths",
        ];
        if (marketplace && !supportedRails.includes(marketplace)) {
          warnings.push(`Marketplace '${marketplace}' is experimental or unsupported. Invoices will be created as DRAFT only.`);
        }

        return JSON.stringify({
          settlement_id: sid,
          marketplace: settlement.marketplace,
          can_push: blockers.length === 0,
          blockers,
          warnings,
          message: blockers.length === 0
            ? "Settlement is ready to push. Open Push Safety Preview to proceed."
            : `${blockers.length} blocker(s) must be resolved before pushing.`,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error(`Tool ${toolName} failed:`, e);
    return JSON.stringify({ error: `Tool execution failed: ${e instanceof Error ? e.message : "Unknown error"}` });
  }
}
