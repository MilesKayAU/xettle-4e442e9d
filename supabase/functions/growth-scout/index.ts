import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SEARCH_QUERIES = [
  // Facebook Groups — real groups to find and join
  'facebook groups "xero australia" bookkeepers',
  'facebook groups "amazon sellers australia"',
  'facebook groups "australian ecommerce" sellers',
  'facebook groups "shopify australia" merchants',
  'facebook groups "ebay australia sellers"',
  'facebook groups "australian online sellers" marketplace',
  // Reddit communities
  'reddit "r/AusFinance" ecommerce accounting',
  'reddit subreddit australian ecommerce sellers',
  'reddit "r/ecommerce" marketplace accounting xero',
  'reddit "r/FulfillmentByAmazon" australia accounting',
  // LinkedIn Groups
  'linkedin group "ecommerce australia" sellers',
  'linkedin group "xero users" australia',
  'linkedin group "australian bookkeepers" ecommerce',
  // Xero Community
  'site:community.xero.com marketplace settlement reconciliation',
  'site:community.xero.com amazon shopify integration australia',
  // Whirlpool / forums
  'site:whirlpool.net.au ecommerce accounting xero marketplace',
  // HubSpot Community
  'site:community.hubspot.com ecommerce xero integration australia',
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

    // Pick 6 random queries for this run
    const shuffled = [...SEARCH_QUERIES].sort(() => Math.random() - 0.5);
    const selectedQueries = shuffled.slice(0, 6);

    const systemPrompt = `You are a community & group scout for Xettle — an Australian SaaS that automates Xero accounting for marketplace sellers (Amazon, Shopify, eBay, Bunnings, etc).

Your job: Find REAL, EXISTING communities, groups, and forums where Australian ecommerce businesses gather — places the Xettle team should JOIN to build relationships and find prospects.

TWO TYPES OF RESULTS:

TYPE 1 — JOINABLE COMMUNITIES (priority)
Find real Facebook Groups, Reddit subreddits, LinkedIn Groups, Xero Community forums, and other online communities where Australian marketplace sellers hang out. These must be REAL groups that actually exist.

Examples of what we want:
- "Xero Users Australia" (Facebook Group)
- "r/AusFinance" (Reddit)
- "Australian Amazon Sellers" (Facebook Group)
- "Shopify Entrepreneurs Australia" (Facebook Group)
- "Xero Community — Marketplace Integrations" (forum section)

For each: provide the group/community name, which platform it's on, why it's relevant, and a draft intro message for joining.

TYPE 2 — ACTIVE DISCUSSION THREADS
Find topic patterns that commonly appear in these communities — real problems people post about (GST on marketplace fees, reconciling settlements, multi-channel accounting). Suggest the kind of thread to look for and a helpful draft reply.

CRITICAL RULES:
- Suggest REAL group names that are likely to exist — use common naming patterns for Australian FB groups
- search_query should be the Google search string to find this group/thread (e.g. "facebook.com/groups australian amazon sellers")
- thread_url should be empty string — the dashboard constructs search links
- Focus on AUSTRALIAN communities
- For Facebook Groups: suggest the actual group name as it would appear on Facebook
- For Reddit: use real subreddit names (r/AusFinance, r/ecommerce, etc.)

Return a JSON array. Each object:
{
  "platform": "linkedin" | "facebook_group" | "hubspot_community" | "xero_community" | "reddit" | "twitter" | "forum",
  "thread_title": "string (group name or thread topic)",
  "thread_url": "",
  "thread_snippet": "string (why this group is valuable / what people discuss there)",
  "relevance_score": number (1-10),
  "draft_response": "string (intro message for joining OR helpful reply for a thread)",
  "search_query": "string (Google search to find this group/community)"
}`;

    let userMessage = `Find real communities, groups, and forums for these searches. For each, suggest 2 results — prioritise joinable groups/communities over individual threads:\n\n${selectedQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;

    if (existingTitles.length > 0) {
      const titlesList = existingTitles.slice(0, 50).map((t: string) => `- ${t}`).join("\n");
      userMessage += `\n\nALREADY COVERED — do NOT suggest these again:\n${titlesList}`;
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
