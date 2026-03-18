import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM_PROMPT = `You are a QA analyst for Xettle, an Australian marketplace accounting automation tool that connects Amazon, Shopify and other marketplaces to Xero. A user has submitted a bug report. Analyse it and respond in JSON only — no markdown, no preamble:
{
  "summary": "2-3 sentence plain English summary of the issue",
  "classification": "UI bug | Data bug | API bug | Logic bug | Performance",
  "complexity": "Quick fix | Medium | Complex",
  "affected_system": "e.g. Xero push, Settlement parsing, Dashboard display",
  "lovable_prompt": "A precise ready-to-paste Lovable prompt describing exactly what to fix, which file/component is likely affected, and what correct behaviour should be",
  "owner_question": "If Complex — one specific question to ask the owner before fixing. null if Quick fix or Medium."
}`;

function buildFallback(description: string, page_url: string | null) {
  return {
    summary: description?.substring(0, 200) || "No description provided",
    classification: "UI bug",
    complexity: "Medium",
    affected_system: "Unknown",
    lovable_prompt: `Fix the following bug on page ${page_url || "unknown"}: ${description}`,
    owner_question: null,
  };
}

async function saveTriage(bug_report_id: string, triage: any) {
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  await serviceClient.from("bug_reports").update({
    ai_summary: triage.summary,
    ai_classification: triage.classification,
    ai_lovable_prompt: triage.lovable_prompt,
    ai_complexity: triage.complexity,
  }).eq("id", bug_report_id);
}

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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bug_report_id, description, page_url, console_errors } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // Fallback: return a basic triage without AI
      const fallback = buildFallback(description, page_url);
      if (bug_report_id) await saveTriage(bug_report_id, fallback);
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = `Bug Report:
- Page URL: ${page_url || "Not provided"}
- Description: ${description}
- Console Errors: ${JSON.stringify(console_errors || [])}`;

    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429 || response.status === 402) {
        // Fallback on rate limit / payment issues
        const fallback = buildFallback(description, page_url);
        if (bug_report_id) await saveTriage(bug_report_id, fallback);
        return new Response(JSON.stringify(fallback), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || "{}";

    let triage: any;
    try {
      // Strip markdown code fences if present
      const cleaned = rawText.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
      triage = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawText);
      triage = {
        summary: rawText.substring(0, 200),
        classification: "UI bug",
        complexity: "Medium",
        affected_system: "Unknown",
        lovable_prompt: `Fix: ${description}`,
        owner_question: null,
      };
    }

    if (bug_report_id) await saveTriage(bug_report_id, triage);

    return new Response(JSON.stringify(triage), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-bug-triage error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
