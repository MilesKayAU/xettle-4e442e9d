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
        console.log(`[analyzeReconciliationGap] Invoked for settlement_id=${sid}, user_id=${userId}`);
        const [settRes, valRes, xeroMatchRes, bankTxRes, linesRes, feeObsRes, outstandingRes] = await Promise.all([
          serviceClient.from("settlements")
            .select("settlement_id, marketplace, source, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, reimbursements, bank_deposit, net_amount, gst_on_income, gst_on_expenses, metadata")
            .eq("user_id", userId)
            .eq("settlement_id", sid)
            .maybeSingle(),
          serviceClient.from("marketplace_validation")
            .select("reconciliation_difference, overall_status, reconciliation_status, reconciliation_confidence, reconciliation_confidence_reason")
            .eq("user_id", userId)
            .eq("settlement_id", sid)
            .maybeSingle(),
          // Xero accounting match (pushed by Xettle or external tool)
          serviceClient.from("xero_accounting_matches")
            .select("xero_invoice_id, xero_invoice_number, xero_status, xero_type, match_method, matched_amount, matched_contact, matched_date")
            .eq("user_id", userId)
            .eq("settlement_id", sid)
            .maybeSingle(),
          // Bank transactions — find matching deposit by amount
          serviceClient.from("bank_transactions")
            .select("amount, date, description, contact_name, xero_status, reference")
            .eq("user_id", userId)
            .order("date", { ascending: false })
            .limit(200),
          // Settlement line items — top 50 by absolute amount
          serviceClient.from("settlement_lines")
            .select("amount, amount_type, amount_description, transaction_type, accounting_category, order_id")
            .eq("user_id", userId)
            .eq("settlement_id", sid)
            .order("amount", { ascending: true })
            .limit(50),
          // Fee observations for this settlement
          serviceClient.from("marketplace_fee_observations")
            .select("fee_type, observed_rate, observed_amount, base_amount, fee_category")
            .eq("user_id", userId)
            .eq("settlement_id", sid),
          // Outstanding invoices cache
          serviceClient.from("outstanding_invoices_cache")
            .select("xero_invoice_id, invoice_number, total, amount_due, status, contact_name, date, due_date")
            .eq("user_id", userId)
            .limit(50),
        ]);

        const s = settRes.data;
        if (!s) {
          console.warn(`[analyzeReconciliationGap] Settlement not found: ${sid}`);
          return JSON.stringify({ error: "Settlement not found", settlement_id: sid });
        }
        console.log(`[analyzeReconciliationGap] Found settlement: ${s.marketplace}, bank_deposit=${s.bank_deposit}`);

        const sales = (s.sales_principal || 0) + (s.sales_shipping || 0);
        const fees = Math.abs(s.seller_fees || 0) + Math.abs(s.fba_fees || 0) + Math.abs(s.storage_fees || 0) + Math.abs(s.advertising_costs || 0) + Math.abs(s.other_fees || 0);
        const refunds = s.refunds || 0;
        const reimbursements = s.reimbursements || 0;
        const expectedNet = sales - fees + refunds + reimbursements;
        const bankDeposit = s.bank_deposit || 0;
        const computedGap = bankDeposit - expectedNet;
        const validationGap = valRes.data?.reconciliation_difference ?? computedGap;
        const absGap = Math.abs(validationGap);

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

        // Check if already recorded externally first
        if (xeroMatch && (xeroMatch.xero_status === "PAID" || xeroMatch.xero_status === "AUTHORISED") && postedBy === "external") {
          diagnosis = `Already posted to Xero by external tool as ${xeroMatch.xero_invoice_number || xeroMatch.xero_invoice_id} (${xeroMatch.xero_status}).`;
          gapType = "already_handled";
          recommendedAction = "mark_already_recorded";
          recommendedActionReason = `External accounting tool has already posted this settlement. Mark as already recorded to prevent duplicate.`;
        } else if (absGap < 1.00) {
          diagnosis = "Gap is within the $1.00 rounding tolerance.";
          gapType = "artifact";
          recommendedAction = "rounding_safe_to_push";
          recommendedActionReason = `Gap of ${validationGap.toFixed(2)} is within rounding tolerance. Safe to push to Xero.`;
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
          const hasPdf = s.metadata?.pdfMerged || s.metadata?.hasPdf;
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

        return JSON.stringify({
          settlement_id: sid,
          marketplace: s.marketplace,
          financial_breakdown: {
            sales,
            fees,
            refunds,
            reimbursements,
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
