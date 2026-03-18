import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { renderPolicyForPrompt } from "../_shared/ai_policy.ts";
import { getToolsForRoute, toOpenAIToolDefs, executeTool, READ_ONLY_POLICY } from "../_shared/ai_tool_registry.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM_PROMPT = `You are Xettle's accounting assistant for Australian marketplace sellers.
You help small business owners understand their settlement data, reconciliation gaps, Xero invoices, and marketplace fees.
Speak plainly — no accounting jargon. The user is a seller, not an accountant.
Always refer to specific numbers from the context when answering.
If asked something outside accounting/settlements/Xero, politely redirect.
Never make up numbers — only reference what's in the context or tool results provided.
Australian tax context: GST is 10%, financial year ends June 30.

${READ_ONLY_POLICY}

${renderPolicyForPrompt()}

IMPORTANT BEHAVIOR:
- Always start your first response with a brief "What I'm looking at:" line derived from the page context. Example: "**What I'm looking at:** Dashboard with 3 marketplaces, 5 outstanding invoices, 2 ready to push."
- Use the pageStateSummary from the context as your PRIMARY source for counts shown on the current page. These numbers come directly from what the user sees on screen.
- When the user asks a data question, use the available tools to look up real data. Do NOT guess or hallucinate numbers.
- If a tool call fails, explain what happened and suggest what the user can do next.
- Cite specific numbers from tool results in your answers.
- For the Outstanding page: the "outstanding_xero_invoices_on_page" field is the number of Xero invoices shown on screen that are awaiting processing. These ARE the outstanding invoices. Do NOT say 0 if this field shows a positive number.`;

const MONTHLY_LIMIT = 50;

// Tool definitions and execution are imported from _shared/ai_tool_registry.ts
// Route-filtered at request time based on context.routeId

// ─── Gateway helper ──────────────────────────────────────────────────────────

function buildGatewayPayload(
  systemPrompt: string,
  messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: any[] }>,
  stream: boolean,
  toolDefs: ReturnType<typeof toOpenAIToolDefs>,
) {
  return {
    model: MODEL,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    tools: toolDefs,
    stream,
    ...(stream ? {} : { max_tokens: 1024 }),
  };
}

async function callGateway(
  apiKey: string,
  payload: Record<string, any>,
): Promise<Response> {
  return fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
      { global: { headers: { Authorization: authHeader } } },
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
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check usage limits
    const currentMonth = new Date().toISOString().slice(0, 7);
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = context
      ? `${SYSTEM_PROMPT}\n\nCurrent page context:\n${JSON.stringify(context, null, 2)}`
      : SYSTEM_PROMPT;

    // ─── Route-filtered tools ────────────────────────────────────────
    const routeId = context?.routeId ?? null;
    const routeTools = getToolsForRoute(routeId);
    const toolDefs = toOpenAIToolDefs(routeTools);

    // ─── Tool-calling loop (max 3 rounds, non-streaming) ─────────────
    let gatewayMessages: any[] = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    const MAX_TOOL_ROUNDS = 3;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const payload = buildGatewayPayload(systemPrompt, gatewayMessages, false, toolDefs);
      const response = await callGateway(LOVABLE_API_KEY, payload);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("AI gateway error:", response.status, errorText);

        if (response.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({ error: "Payment required, please add funds to your workspace." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ error: "AI service error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const result = await response.json();
      const choice = result.choices?.[0];
      const message = choice?.message;

      if (!message) {
        break;
      }

      const toolCalls = message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls — break, we'll stream the final round
        break;
      }

      // Append assistant message with tool_calls
      gatewayMessages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: toolCalls,
      });

      // Execute each tool call and append results
      for (const tc of toolCalls) {
        const args = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments || {};

        const toolResult = await executeTool(
          tc.function.name,
          args,
          userId,
          serviceClient,
        );

        gatewayMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      }
    }

    // ─── Final streaming call ────────────────────────────────────────
    const streamPayload = buildGatewayPayload(systemPrompt, gatewayMessages, true, toolDefs);
    const streamResp = await callGateway(LOVABLE_API_KEY, streamPayload);

    if (!streamResp.ok) {
      const errorText = await streamResp.text();
      console.error("AI gateway stream error:", streamResp.status, errorText);

      if (streamResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (streamResp.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add funds to your workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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

    // Pipe the gateway SSE stream directly to the client
    return new Response(streamResp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
