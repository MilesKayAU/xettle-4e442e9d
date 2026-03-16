import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SYSTEM_PROMPT = `You are a QA analyst for Xettle, an Australian marketplace accounting automation tool that connects Amazon, Shopify and other marketplaces to Xero. A user has submitted a bug report. Analyse it and respond in JSON only — no markdown, no preamble:
{
  "summary": "2-3 sentence plain English summary of the issue",
  "classification": "UI bug | Data bug | API bug | Logic bug | Performance",
  "complexity": "Quick fix | Medium | Complex",
  "affected_system": "e.g. Xero push, Settlement parsing, Dashboard display",
  "lovable_prompt": "A precise ready-to-paste Lovable prompt describing exactly what to fix, which file/component is likely affected, and what correct behaviour should be",
  "owner_question": "If Complex — one specific question to ask the owner before fixing. null if Quick fix or Medium."
}`;

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bug_report_id, description, page_url, console_errors } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      // Fallback: return a basic triage without AI
      const fallback = {
        summary: description?.substring(0, 200) || "No description provided",
        classification: "UI bug",
        complexity: "Medium",
        affected_system: "Unknown",
        lovable_prompt: `Fix the following bug on page ${page_url || "unknown"}: ${description}`,
        owner_question: null,
      };

      // Update the bug report with fallback
      if (bug_report_id) {
        const serviceClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await serviceClient.from("bug_reports").update({
          ai_summary: fallback.summary,
          ai_classification: fallback.classification,
          ai_lovable_prompt: fallback.lovable_prompt,
          ai_complexity: fallback.complexity,
        }).eq("id", bug_report_id);
      }

      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = `Bug Report:
- Page URL: ${page_url || "Not provided"}
- Description: ${description}
- Console Errors: ${JSON.stringify(console_errors || [])}`;

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errText);
      throw new Error(`Anthropic API error: ${anthropicResponse.status}`);
    }

    const anthropicData = await anthropicResponse.json();
    const rawText = anthropicData.content?.[0]?.text || "{}";
    
    let triage: any;
    try {
      triage = JSON.parse(rawText);
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

    // Update the bug report row
    if (bug_report_id) {
      const serviceClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await serviceClient.from("bug_reports").update({
        ai_summary: triage.summary,
        ai_classification: triage.classification,
        ai_lovable_prompt: triage.lovable_prompt,
        ai_complexity: triage.complexity,
      }).eq("id", bug_report_id);
    }

    return new Response(JSON.stringify(triage), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-bug-triage error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
