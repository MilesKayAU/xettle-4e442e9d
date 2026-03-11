import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are Xettle's accounting assistant for Australian marketplace sellers.
You help small business owners understand their settlement data, reconciliation gaps, Xero invoices, and marketplace fees.
Speak plainly — no accounting jargon. The user is a seller, not an accountant.
Always refer to specific numbers from the context when answering.
If asked something outside accounting/settlements/Xero, politely redirect.
Never make up numbers — only reference what's in the context provided.
Australian tax context: GST is 10%, financial year ends June 30.`;

const MONTHLY_LIMIT = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    // Check role — pro, admin, or starter allowed
    const { data: isPro } = await supabase.rpc("has_role", { _role: "pro" });
    const { data: isAdmin } = await supabase.rpc("has_role", { _role: "admin" });
    const { data: isStarter } = await supabase.rpc("has_role", { _role: "starter" });

    if (!isPro && !isAdmin && !isStarter) {
      return new Response(
        JSON.stringify({ error: "AI Assistant is a Pro feature. Upgrade to unlock." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check usage limits (admin bypasses)
    const currentMonth = new Date().toISOString().slice(0, 7); // '2026-03'
    
    if (!isAdmin) {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

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

    // Call Anthropic API with streaming
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
        messages: messages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
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

    // Increment usage counter (using service role to bypass RLS for upsert)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Stream the Anthropic SSE response through to the client
    // Transform Anthropic's SSE format to OpenAI-compatible format for the client
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);

            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6);
            if (jsonStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                // Re-emit as OpenAI-compatible SSE
                const chunk = {
                  choices: [{ delta: { content: parsed.delta.text } }],
                };
                await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              } else if (parsed.type === "message_stop") {
                await writer.write(encoder.encode("data: [DONE]\n\n"));
              }
            } catch {
              // skip malformed JSON
            }
          }
        }
        // Ensure DONE is sent
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        console.error("Stream error:", e);
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
