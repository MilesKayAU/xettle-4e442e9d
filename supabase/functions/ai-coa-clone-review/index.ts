import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Xero Chart of Accounts specialist for Australian e-commerce businesses.

You are reviewing a set of proposed NEW accounts that will be created via a "clone" operation — copying an existing marketplace's COA structure for a new marketplace.

Review each proposed account and evaluate:

1. **Code grouping** — Revenue accounts should be contiguous in the 200–399 range. Expense/DIRECTCOSTS accounts should be contiguous in 400–599. Codes scattered across distant numbers is a warning.

2. **Account type correctness** — Following Xero best practice for Australian e-commerce:
   - Sales, Shipping Income, Refunds, Promotional Discounts, Reimbursements → REVENUE (200–399)
   - Seller Fees, FBA Fees, Storage Fees, Advertising → DIRECTCOSTS (preferred) or EXPENSE (400–599)
   - Other Income → OTHERINCOME (270–299)

3. **Naming conventions** — Names should follow "{Marketplace} {Category}" pattern (e.g. "Temu Sales", "Temu Seller Fees"). Flag non-standard names.

4. **Orphaned codes** — Any code that is far (>20) from its siblings is suspicious.

5. **Tax type alignment** — For Australian GST businesses, revenue should use GST on Income, expenses GST on Expenses. Flag mismatches.

Return your analysis via the review_coa_clone tool call.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { cloneRows, existingAccounts, targetMarketplace } = await req.json();

    if (!cloneRows || !Array.isArray(cloneRows) || cloneRows.length === 0) {
      return new Response(JSON.stringify({ error: "No clone rows provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = `Target marketplace: ${targetMarketplace}

Proposed new accounts to create:
${JSON.stringify(cloneRows, null, 2)}

Existing COA accounts (for context on what's already in Xero):
${JSON.stringify((existingAccounts || []).slice(0, 80).map((a: any) => ({
  code: a.account_code, name: a.account_name, type: a.account_type
})), null, 2)}

Review each proposed account and provide verdicts.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "review_coa_clone",
              description: "Return per-row verdicts and overall advice for a COA clone operation",
              parameters: {
                type: "object",
                properties: {
                  verdicts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { type: "string", description: "The category name from the clone row" },
                        verdict: { type: "string", enum: ["pass", "warn", "fail"] },
                        reason: { type: "string", description: "Brief explanation if warn/fail" },
                        suggestedCode: { type: "string", description: "Better code if applicable" },
                        suggestedType: { type: "string", description: "Better account type if applicable" },
                      },
                      required: ["category", "verdict"],
                      additionalProperties: false,
                    },
                  },
                  overallAdvice: {
                    type: "array",
                    items: { type: "string" },
                    description: "2-4 Xero best-practice tips relevant to this clone",
                  },
                  overallVerdict: {
                    type: "string",
                    enum: ["pass", "warn", "fail"],
                    description: "Overall quality of the proposed clone",
                  },
                },
                required: ["verdicts", "overallAdvice", "overallVerdict"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "review_coa_clone" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call in AI response");
    }

    const review = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(review), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-coa-clone-review error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
