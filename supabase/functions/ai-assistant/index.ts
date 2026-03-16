import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightResponse } from "../_shared/cors.ts";

const SYSTEM_PROMPT = `You are Xettle's accounting assistant for Australian marketplace sellers.
You help small business owners understand their settlement data, reconciliation gaps, Xero invoices, and marketplace fees.
Speak plainly — no accounting jargon. The user is a seller, not an accountant.
Always refer to specific numbers from the context when answering.
If asked something outside accounting/settlements/Xero, politely redirect.
Never make up numbers — only reference what's in the context or tool results provided.
Australian tax context: GST is 10%, financial year ends June 30.

IMPORTANT BEHAVIOR:
- Always start your first response with a brief "What I'm looking at:" line derived from the page context. Example: "**What I'm looking at:** Dashboard with 3 marketplaces, 5 outstanding invoices, 2 ready to push."
- Use the pageStateSummary from the context as your PRIMARY source for counts shown on the current page. These numbers come directly from what the user sees on screen.
- When the user asks a data question, use the available tools to look up real data. Do NOT guess or hallucinate numbers.
- If a tool call fails, explain what happened and suggest what the user can do next.
- Cite specific numbers from tool results in your answers.
- For the Outstanding page: the "outstanding_xero_invoices_on_page" field is the number of Xero invoices shown on screen that are awaiting processing. These ARE the outstanding invoices. Do NOT say 0 if this field shows a positive number.`;

const MONTHLY_LIMIT = 50;

// ─── Tool definitions for Anthropic ──────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: "getPageReadinessSummary",
    description: "Get summary counts: outstanding invoices by state, settlements by status, ready-to-push counts, gap warnings. Use when user asks about overall status or what needs attention.",
    input_schema: {
      type: "object" as const,
      properties: {
        routeId: { type: "string", description: "The current page route ID" },
      },
      required: ["routeId"],
    },
  },
  {
    name: "getInvoiceStatusByXeroInvoiceId",
    description: "Get match state, payment status, and readiness of a specific Xero invoice. Use when user asks about a specific invoice.",
    input_schema: {
      type: "object" as const,
      properties: {
        xeroInvoiceId: { type: "string", description: "The Xero invoice ID" },
      },
      required: ["xeroInvoiceId"],
    },
  },
  {
    name: "getSettlementStatus",
    description: "Get posting state, readiness blockers, and Xero sync status for a specific settlement. Use when user asks about a settlement's status or readiness.",
    input_schema: {
      type: "object" as const,
      properties: {
        settlementId: { type: "string", description: "The settlement ID" },
      },
      required: ["settlementId"],
    },
  },
];

// ─── Tool execution ──────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: string,
  serviceClient: any,
): Promise<string> {
  try {
    switch (toolName) {
      case "getPageReadinessSummary": {
        // Fetch counts from settlements + outstanding_invoices_cache
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

        // Also get breakdown by xero_status
        const { data: statusBreakdown } = await serviceClient
          .from("settlements")
          .select("xero_status, status")
          .eq("user_id", userId)
          .eq("is_hidden", false)
          .not("xero_invoice_id", "is", null)
          .limit(500);

        const xeroStatusCounts: Record<string, number> = {};
        for (const s of (statusBreakdown || [])) {
          const key = s.xero_status || s.status || 'unknown';
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
        // Look in outstanding_invoices_cache
        const { data: cached } = await serviceClient
          .from("outstanding_invoices_cache")
          .select("*")
          .eq("user_id", userId)
          .eq("xero_invoice_id", xeroInvoiceId)
          .maybeSingle();

        // Look for matched settlement
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

        // Check account mappings for readiness
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

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error(`Tool ${toolName} failed:`, e);
    return JSON.stringify({ error: `Tool execution failed: ${e instanceof Error ? e.message : "Unknown error"}` });
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflightResponse = handleCorsPreflightResponse(req);
  if (preflightResponse) return preflightResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Check role
    const { data: isPro } = await supabase.rpc("has_role", { _role: "pro" });
    const { data: isAdmin } = await supabase.rpc("has_role", { _role: "admin" });
    const { data: isStarter } = await supabase.rpc("has_role", { _role: "starter" });

    if (!isPro && !isAdmin && !isStarter) {
      return new Response(
        JSON.stringify({ error: "AI Assistant is a Pro feature. Upgrade to unlock." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check usage limits
    const currentMonth = new Date().toISOString().slice(0, 7);
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (!isAdmin) {
      const { data: usage } = await serviceClient
        .from("ai_usage")
        .select("question_count")
        .eq("user_id", userId)
        .eq("month", currentMonth)
        .maybeSingle();

      if (usage && usage.question_count >= MONTHLY_LIMIT) {
        return new Response(
          JSON.stringify({
            error: "Monthly AI question limit reached (50/50). Resets next month.",
            usage: { used: usage.question_count, limit: MONTHLY_LIMIT },
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { messages, context } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const systemPrompt = context
      ? `${SYSTEM_PROMPT}\n\nCurrent page context:\n${JSON.stringify(context, null, 2)}`
      : SYSTEM_PROMPT;

    // ─── Tool-calling loop (max 3 rounds) ────────────────────────────
    let anthropicMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    let finalTextContent = "";
    const MAX_TOOL_ROUNDS = 3;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: TOOL_DEFINITIONS,
          // Only stream the final round (when no tool_use)
          ...(round === MAX_TOOL_ROUNDS - 1 ? {} : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Anthropic API error:", response.status, errorText);
        return new Response(
          JSON.stringify({ error: "AI service error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();

      // Check if the response contains tool_use blocks
      const toolUseBlocks = (result.content || []).filter((b: any) => b.type === "tool_use");
      const textBlocks = (result.content || []).filter((b: any) => b.type === "text");

      if (toolUseBlocks.length === 0) {
        // No tool calls — collect text and break
        finalTextContent = textBlocks.map((b: any) => b.text).join("");
        break;
      }

      // Execute tool calls
      const toolResults: any[] = [];
      for (const toolBlock of toolUseBlocks) {
        const toolResult = await executeTool(
          toolBlock.name,
          toolBlock.input || {},
          userId,
          serviceClient
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: toolResult,
        });
      }

      // Append assistant response + tool results to conversation
      anthropicMessages = [
        ...anthropicMessages,
        { role: "assistant", content: result.content },
        { role: "user", content: toolResults },
      ];
    }

    // ─── Increment usage counter ─────────────────────────────────────
    const { data: existingUsage } = await serviceClient
      .from("ai_usage")
      .select("id, question_count")
      .eq("user_id", userId)
      .eq("month", currentMonth)
      .maybeSingle();

    if (existingUsage) {
      await serviceClient
        .from("ai_usage")
        .update({
          question_count: existingUsage.question_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingUsage.id);
    } else {
      await serviceClient.from("ai_usage").insert({
        user_id: userId,
        month: currentMonth,
        question_count: 1,
      });
    }

    // ─── Return final text as SSE stream (compatibility with client) ──
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        // Emit the final text as a single SSE chunk
        const chunk = {
          choices: [{ delta: { content: finalTextContent } }],
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } finally {
        writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
