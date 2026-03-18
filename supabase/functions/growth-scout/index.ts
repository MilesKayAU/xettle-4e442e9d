import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEARCH_QUERIES = [
  '"connect xero to amazon" site:reddit.com',
  '"shopify xero integration" site:reddit.com',
  '"marketplace accounting software australia"',
  '"amazon seller fees xero reconciliation"',
  '"best xero add on for ecommerce"',
  '"shopify settlement accounting"',
  '"xero amazon australia" site:reddit.com',
  '"reconcile marketplace settlements" xero',
  '"xero multichannel ecommerce"',
  '"best way to sync shopify to xero"',
  '"amazon fba accounting xero australia"',
  '"marketplace seller bookkeeping" xero',
  '"xero integration marketplace" site:community.xero.com',
  '"shopify payments reconciliation" xero',
  '"ebay xero integration australia"',
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin check
    const { data: isAdmin } = await supabase.rpc("has_role", { _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI gateway not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick 5 random queries for this run
    const shuffled = [...SEARCH_QUERIES].sort(() => Math.random() - 0.5);
    const selectedQueries = shuffled.slice(0, 5);

    const systemPrompt = `You are an SEO opportunity scout for Xettle — a SaaS tool that automates Xero accounting for Australian marketplace sellers (Amazon, Shopify, eBay, Bunnings, etc).

Your job: For each search query provided, identify 2-3 realistic forum threads/posts where someone is asking about the exact problem Xettle solves. Then draft a genuinely helpful reply.

CRITICAL RULES:
- Return REAL-LOOKING thread examples from Reddit, Xero Community, Shopify Community, Quora, or Australian business forums
- Each opportunity must have: platform, thread_title, thread_url (realistic URL pattern), thread_snippet (what the person asked), relevance_score (1-10), and draft_response
- Draft responses MUST be genuinely helpful — answer the question first, share knowledge, THEN softly mention Xettle as one option
- NEVER be spammy. The response should read like a knowledgeable accountant/seller helping out
- Focus on Australian marketplace sellers using Xero
- Include specific pain points: settlement reconciliation, GST handling, multi-marketplace fee tracking, FBA fee accounting

Return a JSON array of opportunities. Each object:
{
  "platform": "reddit" | "xero_community" | "shopify_community" | "quora" | "forum",
  "thread_title": "string",
  "thread_url": "string (realistic URL)",
  "thread_snippet": "string (what the person asked, 1-2 sentences)",
  "relevance_score": number (1-10),
  "draft_response": "string (the helpful reply, 2-4 paragraphs)",
  "search_query": "string (which query found this)"
}`;

    const userMessage = `Find organic marketing opportunities for these search queries. For each query, suggest 2-3 forum threads where we could provide genuine value:\n\n${selectedQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_opportunities",
              description: "Return found SEO opportunities",
              parameters: {
                type: "object",
                properties: {
                  opportunities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        platform: { type: "string", enum: ["reddit", "xero_community", "shopify_community", "quora", "forum"] },
                        thread_title: { type: "string" },
                        thread_url: { type: "string" },
                        thread_snippet: { type: "string" },
                        relevance_score: { type: "number" },
                        draft_response: { type: "string" },
                        search_query: { type: "string" },
                      },
                      required: ["platform", "thread_title", "thread_url", "thread_snippet", "relevance_score", "draft_response", "search_query"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["opportunities"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_opportunities" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a minute." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits depleted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", status, errText);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    let opportunities: any[] = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        opportunities = parsed.opportunities || [];
      } catch {
        console.error("Failed to parse tool call arguments");
      }
    }

    // Save to DB
    if (opportunities.length > 0) {
      const rows = opportunities.map((opp: any) => ({
        user_id: user.id,
        platform: opp.platform,
        thread_url: opp.thread_url,
        thread_title: opp.thread_title,
        thread_snippet: opp.thread_snippet,
        relevance_score: opp.relevance_score,
        draft_response: opp.draft_response,
        search_query: opp.search_query,
        status: "new",
      }));

      const { error: insertError } = await supabase
        .from("growth_opportunities")
        .insert(rows);

      if (insertError) {
        console.error("Insert error:", insertError);
      }
    }

    return new Response(JSON.stringify({ opportunities, count: opportunities.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("growth-scout error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
