import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEARCH_QUERIES = [
  // LinkedIn / Social
  '"ecommerce accounting" "xero" australian marketplace',
  '"marketplace seller" "reconciliation" australia linkedin',
  '"shopify seller" "xero integration" australia',
  '"amazon seller" "accounting automation" australia',
  // Facebook Groups
  '"australian ecommerce" group "xero" marketplace fees',
  '"amazon australia sellers" group accounting settlement',
  '"shopify australia" group "bookkeeper" marketplace',
  // HubSpot Community
  '"marketplace accounting" "automation" ecommerce hubspot',
  '"ecommerce integration" "xero" reconciliation hubspot',
  // Xero Community & Groups
  '"marketplace settlement" "xero" community reconciliation',
  '"amazon xero" "GST" community australia',
  '"multi-channel" "xero add-on" ecommerce australia',
  // General social / forums
  '"ebay seller" "xero" accounting australia',
  '"bunnings marketplace" accounting integration',
  '"ecommerce bookkeeper" australia marketplace fees',
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // Fetch existing titles from last 30 days for deduplication
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingOpps } = await supabase
      .from("growth_opportunities")
      .select("thread_title")
      .gte("created_at", thirtyDaysAgo);

    const existingTitles = (existingOpps || []).map((o: any) => o.thread_title);

    // Pick 5 random queries for this run
    const shuffled = [...SEARCH_QUERIES].sort(() => Math.random() - 0.5);
    const selectedQueries = shuffled.slice(0, 5);

    const systemPrompt = `You are an outreach opportunity scout for Xettle — a new Australian SaaS tool that automates Xero accounting for marketplace sellers (Amazon, Shopify, eBay, Bunnings, etc).

Your job: Find places where Australian ecommerce businesses, bookkeepers, or marketplace sellers are discussing accounting pain points — and suggest outreach opportunities where we can invite them to try Xettle for free.

TARGET PLATFORMS (in priority order):
1. LinkedIn — posts, comments, and groups where Australian ecommerce sellers or bookkeepers discuss marketplace accounting
2. Facebook Groups — Australian ecommerce seller groups, Xero user groups, Amazon AU seller groups
3. HubSpot Community — ecommerce integration discussions
4. Xero Community — threads about marketplace integrations, settlement reconciliation
5. Reddit — r/AusFinance, r/ecommerce, r/FulfillmentByAmazon
6. Twitter/X — Australian ecommerce and Xero conversations

MESSAGING APPROACH — the draft response should:
- Lead with genuine help and empathy for their pain point
- Share practical knowledge about the problem (settlement reconciliation, GST, multi-marketplace fees)
- Then naturally mention: "We've just built a tool called Xettle that handles exactly this — automating Xero entries for marketplace settlements. We're inviting Australian sellers to try it free for a few months while we refine it. Happy to set you up with a no-cost account if you're interested."
- Keep it warm, personal, and non-salesy — like a peer offering to help
- Adapt tone to the platform (more professional on LinkedIn, more casual on Reddit/Facebook)

CRITICAL RULES:
- Suggest thread/post TOPICS that are likely to exist — do NOT invent specific URLs
- Each opportunity must have: platform, thread_title, thread_snippet, relevance_score (1-10), and draft_response
- Focus on AUSTRALIAN companies and sellers — this is the target market
- thread_url should be empty string — the dashboard will construct search links
- Vary the platforms — don't put everything on one platform

Return a JSON array of opportunities. Each object:
{
  "platform": "linkedin" | "facebook_group" | "hubspot_community" | "xero_community" | "reddit" | "twitter" | "forum",
  "thread_title": "string",
  "thread_url": "",
  "thread_snippet": "string (what the person asked/posted, 1-2 sentences)",
  "relevance_score": number (1-10),
  "draft_response": "string (the helpful reply with free trial invitation, 2-4 paragraphs)",
  "search_query": "string (which query found this)"
}`;

    let userMessage = `Find outreach opportunities for these search queries. For each query, suggest 2-3 posts/threads where we could provide genuine value and invite them to try Xettle free:\n\n${selectedQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;

    if (existingTitles.length > 0) {
      const titlesList = existingTitles.slice(0, 50).map((t: string) => `- ${t}`).join("\n");
      userMessage += `\n\nALREADY COVERED — do NOT suggest similar topics:\n${titlesList}`;
    }

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
              description: "Return found outreach opportunities",
              parameters: {
                type: "object",
                properties: {
                  opportunities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        platform: { type: "string", enum: ["linkedin", "facebook_group", "hubspot_community", "xero_community", "reddit", "twitter", "forum"] },
                        thread_title: { type: "string" },
                        thread_url: { type: "string" },
                        thread_snippet: { type: "string" },
                        relevance_score: { type: "number" },
                        draft_response: { type: "string" },
                        search_query: { type: "string" },
                      },
                      required: ["platform", "thread_title", "thread_snippet", "relevance_score", "draft_response", "search_query"],
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

    if (opportunities.length > 0) {
      const rows = opportunities.map((opp: any) => ({
        user_id: user.id,
        platform: opp.platform,
        thread_url: opp.thread_url || null,
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
