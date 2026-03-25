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
      "[Read-only] Comprehensive forensic analysis of a settlement's reconciliation gap. Cross-references settlement financials, Xero invoice status, bank deposit matches, line-item breakdown (top 50 by magnitude), fee anomaly detection, and outstanding invoices. Returns structured diagnosis with a constrained recommended_action enum the UI can act on. This is a lookup-only tool that does not modify any data.",
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
  viewerClient?: any,
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

      case "analyzeReconciliationGap": {
        const sid = toolInput.settlementId;
        console.log(`[analyzeReconciliationGap] Invoked for settlement_id=${sid}, viewer_user_id=${userId}`);

        // First resolve the visible validation row using the caller's scoped client.
        // This avoids false "not found" errors when an admin/bookkeeper can see a row
        // in the dashboard that belongs to another workspace user.
        let resolvedOwnerId = userId;
        let validationLookupMethod = "viewer_validation_exact";
        let matchMethod = "exact";

        const logGapAnalysisError = async (
          stage: string,
          error: { message?: string; code?: string } | null | undefined,
          settlementIdForLog = sid,
          marketplaceCode?: string | null,
        ) => {
          const lookupError = error?.message || "Unknown query error";
          const lookupErrorCode = error?.code;

          await serviceClient.from("system_events").insert({
            user_id: resolvedOwnerId,
            event_type: "ai_gap_analysis_complete",
            severity: "error",
            settlement_id: settlementIdForLog,
            marketplace_code: marketplaceCode ?? null,
            details: {
              viewer_user_id: userId,
              resolved_owner_id: resolvedOwnerId,
              settlement_id: settlementIdForLog,
              settlement_found: false,
              failed_stage: stage,
              lookup_error: lookupError,
              lookup_error_code: lookupErrorCode,
              id_match_method: matchMethod,
            },
          });

          return JSON.stringify({
            error: stage.startsWith("settlement_lookup") ? "Settlement query failed" : "Gap analysis query failed",
            lookup_error: lookupError,
            lookup_error_code: lookupErrorCode,
            failed_stage: stage,
            settlement_id: settlementIdForLog,
            id_match_method: matchMethod,
            resolved_owner_id: resolvedOwnerId,
          });
        };

        let validationRow = viewerClient
          ? await viewerClient.from("marketplace_validation")
              .select("settlement_id, user_id, marketplace_code, period_start, period_end, overall_status, reconciliation_status, reconciliation_difference, reconciliation_confidence, reconciliation_confidence_reason")
              .eq("settlement_id", sid)
              .maybeSingle()
          : { data: null };

        if (validationRow?.error) {
          return await logGapAnalysisError("validation_lookup_exact", validationRow.error, sid);
        }

        if (!validationRow?.data && viewerClient) {
          validationLookupMethod = "viewer_validation_ilike";
          validationRow = await viewerClient.from("marketplace_validation")
            .select("settlement_id, user_id, marketplace_code, period_start, period_end, overall_status, reconciliation_status, reconciliation_difference, reconciliation_confidence, reconciliation_confidence_reason")
            .ilike("settlement_id", sid)
            .maybeSingle();

          if (validationRow?.error) {
            return await logGapAnalysisError("validation_lookup_ilike", validationRow.error, sid);
          }
        }

        if (!validationRow?.data && viewerClient) {
          validationLookupMethod = "viewer_validation_partial";
          validationRow = await viewerClient.from("marketplace_validation")
            .select("settlement_id, user_id, marketplace_code, period_start, period_end, overall_status, reconciliation_status, reconciliation_difference, reconciliation_confidence, reconciliation_confidence_reason")
            .ilike("settlement_id", `%${sid}%`)
            .limit(1)
            .maybeSingle();

          if (validationRow?.error) {
            return await logGapAnalysisError("validation_lookup_partial", validationRow.error, sid);
          }
        }

        if (validationRow?.data?.user_id) {
          resolvedOwnerId = validationRow.data.user_id;
        }

        // ── Settlement lookup with fallbacks against the resolved owner ──
        matchMethod = validationRow?.data ? `${validationLookupMethod}_settlement_exact` : "exact";
        let settRes = await serviceClient.from("settlements")
          .select("settlement_id, marketplace, source, period_start, period_end, status, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, reimbursements, bank_deposit, net_ex_gst, gst_on_income, gst_on_expenses, raw_payload")
          .eq("user_id", resolvedOwnerId)
          .eq("settlement_id", validationRow?.data?.settlement_id || sid)
          .maybeSingle();

        if (settRes.error) {
          return await logGapAnalysisError(
            "settlement_lookup_exact",
            settRes.error,
            validationRow?.data?.settlement_id || sid,
            validationRow?.data?.marketplace_code,
          );
        }

        if (!settRes.data) {
          matchMethod = validationRow?.data ? `${validationLookupMethod}_settlement_ilike` : "ilike";
          settRes = await serviceClient.from("settlements")
            .select("settlement_id, marketplace, source, period_start, period_end, status, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, reimbursements, bank_deposit, net_ex_gst, gst_on_income, gst_on_expenses, raw_payload")
            .eq("user_id", resolvedOwnerId)
            .ilike("settlement_id", validationRow?.data?.settlement_id || sid)
            .maybeSingle();

          if (settRes.error) {
            return await logGapAnalysisError(
              "settlement_lookup_ilike",
              settRes.error,
              validationRow?.data?.settlement_id || sid,
              validationRow?.data?.marketplace_code,
            );
          }
        }

        if (!settRes.data) {
          matchMethod = validationRow?.data ? `${validationLookupMethod}_settlement_partial` : "partial";
          settRes = await serviceClient.from("settlements")
            .select("settlement_id, marketplace, source, period_start, period_end, status, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, reimbursements, bank_deposit, net_ex_gst, gst_on_income, gst_on_expenses, raw_payload")
            .eq("user_id", resolvedOwnerId)
            .ilike("settlement_id", `%${validationRow?.data?.settlement_id || sid}%`)
            .limit(1)
            .maybeSingle();

          if (settRes.error) {
            return await logGapAnalysisError(
              "settlement_lookup_partial",
              settRes.error,
              validationRow?.data?.settlement_id || sid,
              validationRow?.data?.marketplace_code,
            );
          }
        }

        // Log invocation to system_events
        await serviceClient.from("system_events").insert({
          user_id: resolvedOwnerId,
          event_type: "ai_gap_analysis_invoked",
          severity: "info",
          settlement_id: validationRow?.data?.settlement_id || sid,
          marketplace_code: validationRow?.data?.marketplace_code,
          details: {
            viewer_user_id: userId,
            resolved_owner_id: resolvedOwnerId,
            settlement_id: sid,
            invoked_at: new Date().toISOString(),
            id_match_method: matchMethod,
            settlement_found: !!settRes.data,
          },
        });

        const s = settRes.data;
        if (!s) {
          console.warn(`[analyzeReconciliationGap] Settlement not found after all fallbacks: ${sid}`);
          await serviceClient.from("system_events").insert({
            user_id: resolvedOwnerId,
            event_type: "ai_gap_analysis_complete",
            severity: "error",
            settlement_id: sid,
            marketplace_code: validationRow?.data?.marketplace_code ?? null,
            details: {
              viewer_user_id: userId,
              resolved_owner_id: resolvedOwnerId,
              settlement_id: sid,
              settlement_found: false,
              failed_stage: "settlement_lookup_not_found",
              id_match_method: matchMethod,
            },
          });
          return JSON.stringify({ error: "Settlement not found", settlement_id: sid, id_match_method: matchMethod, resolved_owner_id: resolvedOwnerId, fallbacks_tried: ["viewer_validation_exact", "viewer_validation_ilike", "viewer_validation_partial", "settlement_exact", "settlement_ilike", "settlement_partial"] });
        }
        console.log(`[analyzeReconciliationGap] Found settlement via ${matchMethod}: ${s.marketplace}, bank_deposit=${s.bank_deposit}`);

        const resolvedSid = s.settlement_id;

        const [valRes, xeroMatchRes, bankTxRes, linesRes, feeObsRes, outstandingRes, mappingRes] = await Promise.all([
          serviceClient.from("marketplace_validation")
            .select("reconciliation_difference, overall_status, reconciliation_status, reconciliation_confidence, reconciliation_confidence_reason")
            .eq("user_id", resolvedOwnerId)
            .eq("settlement_id", resolvedSid)
            .maybeSingle(),
          serviceClient.from("xero_accounting_matches")
            .select("xero_invoice_id, xero_invoice_number, xero_status, xero_type, match_method, matched_amount, matched_contact, matched_date")
            .eq("user_id", resolvedOwnerId)
            .eq("settlement_id", resolvedSid)
            .maybeSingle(),
          serviceClient.from("bank_transactions")
            .select("amount, date, description, contact_name, xero_status, reference")
            .eq("user_id", resolvedOwnerId)
            .order("date", { ascending: false })
            .limit(200),
          serviceClient.from("settlement_lines")
            .select("amount, amount_type, amount_description, transaction_type, accounting_category, order_id")
            .eq("user_id", resolvedOwnerId)
            .eq("settlement_id", resolvedSid)
            .order("amount", { ascending: true })
            .limit(50),
          serviceClient.from("marketplace_fee_observations")
            .select("fee_type, observed_rate, observed_amount, base_amount, fee_category")
            .eq("user_id", resolvedOwnerId)
            .eq("settlement_id", resolvedSid),
          serviceClient.from("outstanding_invoices_cache")
            .select("xero_invoice_id, invoice_number, total, amount_due, status, contact_name, date, due_date")
            .eq("user_id", resolvedOwnerId)
            .limit(50),
          serviceClient.from("app_settings")
            .select("value")
            .eq("user_id", resolvedOwnerId)
            .eq("key", "accounting_xero_account_codes")
            .maybeSingle(),
        ]);

        const queryErrors = [
          ["validation_query", valRes.error],
          ["xero_match_query", xeroMatchRes.error],
          ["bank_transactions_query", bankTxRes.error],
          ["settlement_lines_query", linesRes.error],
          ["fee_observations_query", feeObsRes.error],
          ["outstanding_invoices_query", outstandingRes.error],
          ["account_mapping_query", mappingRes.error],
        ].filter(([, error]) => !!error);

        if (queryErrors.length > 0) {
          const [stage, error] = queryErrors[0] as [string, { message?: string; code?: string }];
          return await logGapAnalysisError(stage, error, resolvedSid, validationRow?.data?.marketplace_code || s.marketplace);
        }

        const sales = (s.sales_principal || 0) + (s.sales_shipping || 0);
        const fees = Math.abs(s.seller_fees || 0) + Math.abs(s.fba_fees || 0) + Math.abs(s.storage_fees || 0) + Math.abs(s.advertising_costs || 0) + Math.abs(s.other_fees || 0);
        const refunds = s.refunds || 0;
        const reimbursements = s.reimbursements || 0;
        const componentNet = sales - fees + refunds + reimbursements;
        const expectedNet = s.net_ex_gst ?? componentNet;
        const bankDeposit = s.bank_deposit || 0;
        const computedGap = bankDeposit - expectedNet;
        const validationGap = valRes.data?.reconciliation_difference ?? computedGap;
        const absGap = Math.abs(validationGap);
        const rawPayload = s.raw_payload && typeof s.raw_payload === "object" ? s.raw_payload : null;

        // ── Xero status ──
        const xeroMatch = xeroMatchRes.data;
        const postedBy = xeroMatch
          ? (xeroMatch.match_method === "xettle_push" ? "xettle"
            : xeroMatch.match_method === "reference_match" ? "external"
            : xeroMatch.match_method === "fuzzy_match" ? "external"
            : "unknown")
          : null;
        const xeroStatus = xeroMatch
          ? {
              pushed: true,
              invoice_id: xeroMatch.xero_invoice_id,
              invoice_number: xeroMatch.xero_invoice_number,
              status: xeroMatch.xero_status,
              type: xeroMatch.xero_type,
              posted_by: postedBy,
              matched_amount: xeroMatch.matched_amount,
              matched_contact: xeroMatch.matched_contact,
              matched_date: xeroMatch.matched_date,
            }
          : { pushed: false };

        // ── Bank match ──
        const bankTxns = bankTxRes.data || [];
        const depositAbs = Math.abs(bankDeposit);
        const netAbs = Math.abs(expectedNet);
        const bankMatch = bankTxns.find((tx: any) => {
          const txAmt = Math.abs(tx.amount || 0);
          return Math.abs(txAmt - depositAbs) < 1.00 || Math.abs(txAmt - netAbs) < 1.00;
        });
        const bankMatchResult = bankMatch
          ? { found: true, amount: bankMatch.amount, date: bankMatch.date, description: bankMatch.description, contact: bankMatch.contact_name }
          : { found: false };

        // ── Top line items (sorted by absolute amount desc) ──
        const rawLines = linesRes.data || [];
        const topLines = rawLines
          .sort((a: any, b: any) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0))
          .slice(0, 50)
          .map((l: any) => ({
            amount: l.amount,
            type: l.amount_type || l.transaction_type,
            description: l.amount_description,
            category: l.accounting_category,
            order_id: l.order_id,
          }));

        // ── Fee analysis ──
        const feeObs = feeObsRes.data || [];
        const feeAnalysis = feeObs.length > 0
          ? feeObs.map((f: any) => ({
              fee_type: f.fee_type,
              observed_rate: f.observed_rate,
              observed_amount: f.observed_amount,
              base_amount: f.base_amount,
              category: f.fee_category,
            }))
          : [];

        // ── Outstanding invoices (matching by amount) ──
        const outstandingInvoices = (outstandingRes.data || [])
          .filter((inv: any) => {
            const invTotal = Math.abs(inv.total || 0);
            return Math.abs(invTotal - depositAbs) < 2.00 || Math.abs(invTotal - netAbs) < 2.00;
          })
          .slice(0, 5)
          .map((inv: any) => ({
            invoice_number: inv.invoice_number,
            total: inv.total,
            amount_due: inv.amount_due,
            status: inv.status,
            contact: inv.contact_name,
            date: inv.date,
            due_date: inv.due_date,
          }));

        // Rule-based diagnosis
        const marketplace = (s.marketplace || "").toLowerCase();
        const source = s.source || "";
        let diagnosis = "";
        let gapType: string = "uncertain";
        let recommendedAction: string = "investigate_gap";
        let recommendedActionReason = "";

        // Priority 0 — Debit period: bank deposit is negative
        if (bankDeposit !== null && bankDeposit < 0 && expectedNet > 0) {
          diagnosis = `Bank deposit is negative ($${bankDeposit.toFixed(2)}), meaning the marketplace debited your account this period. Fees and refunds exceeded sales. This should be recorded as a bill (ACCPAY) in Xero.`;
          gapType = "debit_period";
          recommendedAction = "record_as_bill";
          recommendedActionReason = `Bank deposit is -$${Math.abs(bankDeposit).toFixed(2)} against computed net of $${expectedNet.toFixed(2)}. This is a debit period where marketplace deductions exceeded sales. Record as an ACCPAY bill, not an ACCREC invoice.`;
        } else if (bankDeposit !== null && bankDeposit < 0 && expectedNet <= 0) {
          diagnosis = `Both bank deposit ($${bankDeposit.toFixed(2)}) and computed net ($${expectedNet.toFixed(2)}) are negative. Pure fee debit period with no net sales.`;
          gapType = "debit_period";
          recommendedAction = "record_as_bill";
          recommendedActionReason = `Pure fee debit period. Record as ACCPAY bill in Xero.`;
        // Check if already recorded externally
        } else if (xeroMatch && (xeroMatch.xero_status === "PAID" || xeroMatch.xero_status === "AUTHORISED") && postedBy === "external") {
          diagnosis = `Already posted to Xero by external tool as ${xeroMatch.xero_invoice_number || xeroMatch.xero_invoice_id} (${xeroMatch.xero_status}).`;
          gapType = "already_handled";
          recommendedAction = "mark_already_recorded";
          recommendedActionReason = `External accounting tool has already posted this settlement. Mark as already recorded to prevent duplicate.`;
        } else if (absGap < 1.00) {
          diagnosis = "Gap is within the $1.00 rounding tolerance.";
          gapType = "artifact";
          recommendedAction = "rounding_safe_to_push";
          recommendedActionReason = `Gap of ${validationGap.toFixed(2)} is within rounding tolerance. Safe to push to Xero.`;
        } else if (
          !xeroMatch &&
          valRes.data?.overall_status === "ready_to_push" &&
          !bankMatchResult.concerns
        ) {
          // Priority 3: Validation says ready, no external posting, no bank concerns
          diagnosis = "Settlement is validated and ready to push. Gap is within acceptable range.";
          gapType = "acceptable";
          recommendedAction = "push_to_xero";
          recommendedActionReason = `Validation status is ready_to_push with a gap of $${absGap.toFixed(2)}. No external posting detected and no bank match concerns. Safe to push.`;
        } else if (source === "api" && marketplace.includes("ebay")) {
          const feeTotal = Math.abs(s.seller_fees || 0);
          if (feeTotal > 0 && Math.abs(absGap - feeTotal) < 1.00) {
            diagnosis = "eBay API returned net amounts (fees already deducted) but fees were subtracted again. This is a data artifact — re-sync eBay to fix.";
            gapType = "artifact";
            recommendedAction = "rerun_validation";
            recommendedActionReason = "eBay double-fee artifact detected. Re-syncing should resolve.";
          } else {
            diagnosis = "eBay settlement may have stale data from a previous API sync.";
            gapType = "uncertain";
            recommendedAction = "investigate_gap";
            recommendedActionReason = "eBay data may be stale. Review line items and consider re-syncing.";
          }
        } else if (marketplace.includes("kogan")) {
          const hasPdf = !!(rawPayload?.pdfMerged || rawPayload?.hasPdf);
          if (!hasPdf) {
            diagnosis = "Kogan CSV doesn't include returns, ad fees, or monthly seller fees. Upload the Remittance PDF to capture all deductions.";
            gapType = "real";
            recommendedAction = "upload_settlement_csv";
            recommendedActionReason = "Kogan Remittance PDF is missing. Upload it to capture the full fee breakdown.";
          } else {
            diagnosis = "Kogan PDF adjustments may not have been fully captured.";
            gapType = "uncertain";
            recommendedAction = "investigate_gap";
            recommendedActionReason = "PDF was uploaded but gap persists. Review line items for uncaptured adjustments.";
          }
        } else if (marketplace.includes("bunnings")) {
          diagnosis = bankDeposit < 0
            ? "Bunnings bank deposit is negative — likely a fee-only period."
            : "Bunnings PDF extraction can produce rounding errors.";
          if (absGap < 5) {
            gapType = "artifact";
            recommendedAction = "rounding_safe_to_push";
            recommendedActionReason = "Bunnings rounding variance under $5. Safe to push.";
          } else {
            gapType = "uncertain";
            recommendedAction = "investigate_gap";
            recommendedActionReason = "Bunnings gap exceeds $5. Check PDF extraction quality.";
          }
        } else if (marketplace.includes("mydeal")) {
          if ((s.sales_principal || 0) === 0 && Math.abs(s.seller_fees || 0) > 0) {
            diagnosis = "MyDeal has fees but no sales captured — CSV column mapping may need review.";
            gapType = "real";
            recommendedAction = "upload_settlement_csv";
            recommendedActionReason = "Sales data missing from MyDeal CSV. Re-upload with correct column mapping.";
          }
        } else if (marketplace.includes("shopify")) {
          diagnosis = "Shopify payout may include GST components not broken out in fields.";
          if (absGap < 2) {
            gapType = "artifact";
            recommendedAction = "rounding_safe_to_push";
            recommendedActionReason = "Shopify rounding variance under $2. Safe to push.";
          } else {
            gapType = "uncertain";
            recommendedAction = "investigate_gap";
            recommendedActionReason = "Shopify gap may reflect missing GST breakdown or uncaptured payment adjustments.";
          }
        }

        // Priority 9: Await payout — settlement has data but no bank deposit, recent period
        if (
          recommendedAction === "investigate_gap" &&
          (bankDeposit === 0 || bankDeposit === null) &&
          (s.sales_principal || s.seller_fees) &&
          (valRes.data?.overall_status === "settlement_needed" || valRes.data?.reconciliation_status === "warning")
        ) {
          const periodEndDate = s.period_end ? new Date(s.period_end) : null;
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          if (periodEndDate && periodEndDate >= thirtyDaysAgo) {
            diagnosis = "Settlement has transaction data but no bank deposit recorded yet. The marketplace may not have paid out.";
            gapType = "pending";
            recommendedAction = "await_payout";
            recommendedActionReason = "Bank deposit is zero or missing. The marketplace payout may still be processing. Check back after the expected payment date.";
          }
        }

        if (!diagnosis || recommendedAction === "investigate_gap") {
          if (!diagnosis) {
            diagnosis = validationGap > 0
            ? "Bank deposit exceeds computed net — possible uncaptured income (reimbursements, adjustments)."
            : "Computed net exceeds bank deposit — possible uncaptured deductions (ad spend, returns, fees).";
          }
          // Fallback recommended action based on data availability
          if (!s.sales_principal && !s.seller_fees) {
            recommendedAction = "upload_settlement_csv";
            recommendedActionReason = "No settlement data found. Upload the settlement file to populate financials.";
          } else if (absGap > 50) {
            recommendedAction = "contact_marketplace";
            recommendedActionReason = `Gap of $${absGap.toFixed(2)} is significant. Review line items and contact marketplace if unexplained.`;
          }
          if (!recommendedActionReason) {
            recommendedActionReason = "Gap detected. Review the financial breakdown and line items to identify the source.";
          }
        }

        // ── Account mapping check ──
        // Mappings are stored in app_settings as JSON: { "Category:Marketplace": "code", "Category": "code" }
        const REQUIRED_CATEGORIES = ["Sales", "Seller Fees", "Refunds", "Other Fees", "Shipping"];
        let mappingJson: Record<string, any> = {};
        if (mappingRes.data?.value) {
          if (typeof mappingRes.data.value === "string") {
            try {
              mappingJson = JSON.parse(mappingRes.data.value);
            } catch (error) {
              const lookupError = error instanceof Error ? error.message : "Invalid account mapping JSON";
              return await logGapAnalysisError(
                "account_mapping_parse",
                { message: lookupError },
                resolvedSid,
                validationRow?.data?.marketplace_code || s.marketplace,
              );
            }
          } else if (typeof mappingRes.data.value === "object") {
            mappingJson = mappingRes.data.value;
          }
        }
        const marketplaceName = (s.marketplace || "").charAt(0).toUpperCase() + (s.marketplace || "").slice(1); // e.g. "bunnings" -> "Bunnings"
        const missingMappings = REQUIRED_CATEGORIES.filter(cat => {
          // Check marketplace-specific key first (e.g. "Sales:Bunnings"), then base key (e.g. "Sales")
          const specificKey = `${cat}:${marketplaceName}`;
          return !mappingJson[specificKey] && !mappingJson[cat];
        });
        let accountMappingWarning: string | null = null;
        if (missingMappings.length > 0) {
          accountMappingWarning = `Missing account mappings for ${marketplaceName}: ${missingMappings.join(", ")}. Configure these in Settings > Account Mapping before pushing to Xero.`;
        }

        const result = {
          settlement_id: resolvedSid,
          marketplace: s.marketplace,
          id_match_method: matchMethod,
          financial_breakdown: {
            sales,
            fees,
            refunds,
            reimbursements,
            component_net: componentNet,
            settlement_net: expectedNet,
            expected_net: expectedNet,
            bank_deposit: bankDeposit,
          },
          gap_amount: validationGap,
          gap_direction: validationGap > 0 ? "bank_higher" : validationGap < 0 ? "net_higher" : "balanced",
          gap_type: gapType,
          xero_status: xeroStatus,
          bank_match: bankMatchResult,
          top_line_items: topLines,
          fee_analysis: feeAnalysis,
          outstanding_invoices: outstandingInvoices,
          diagnosis,
          recommended_action: recommendedAction,
          recommended_action_reason: recommendedActionReason,
          validation_status: valRes.data?.overall_status || "unknown",
          reconciliation_confidence: valRes.data?.reconciliation_confidence,
          confidence_reason: valRes.data?.reconciliation_confidence_reason,
          account_mapping_warning: accountMappingWarning,
          missing_account_mappings: missingMappings.length > 0 ? missingMappings : undefined,
        };

        // Log completion to system_events
        await serviceClient.from("system_events").insert({
          user_id: userId,
          event_type: "ai_gap_analysis_complete",
          severity: "info",
          settlement_id: resolvedSid,
          marketplace_code: validationRow?.data?.marketplace_code || s.marketplace,
          details: {
            settlement_id: resolvedSid,
            recommended_action: recommendedAction,
            gap_amount: validationGap,
            id_match_method: matchMethod,
            missing_mappings: missingMappings.length > 0 ? missingMappings : undefined,
          },
        });

        return JSON.stringify(result);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error(`Tool ${toolName} failed:`, e);
    return JSON.stringify({ error: `Tool execution failed: ${e instanceof Error ? e.message : "Unknown error"}` });
  }
}
