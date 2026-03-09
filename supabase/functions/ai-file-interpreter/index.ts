import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action } = body;

    // ─── MODE: detect_marketplace ───────────────────────────────────
    if (action === "detect_marketplace") {
      return await handleDetectMarketplace(body, LOVABLE_API_KEY);
    }

    // ─── MODE: analyse_file (default) ───────────────────────────────
    return await handleAnalyseFile(body, LOVABLE_API_KEY);
  } catch (err) {
    console.error("ai-file-interpreter error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── detect_marketplace handler ─────────────────────────────────────────────

async function handleDetectMarketplace(
  body: {
    note_attributes_samples?: string[];
    tags_samples?: string[];
    payment_method?: string;
    row_count?: number;
  },
  apiKey: string
): Promise<Response> {
  const { note_attributes_samples, tags_samples, payment_method, row_count } = body;

  const systemPrompt = `You are a marketplace detection engine for Xettle, an Australian multi-channel accounting tool.

Your job is to identify which marketplace or payment gateway a set of Shopify orders belongs to, based on Note Attributes, Tags, and Payment Method fields.

Known Australian marketplaces and gateways:
- MyDeal (note: MyDealOrderID)
- Bunnings Marketplace (note: "Order placed from: Bunnings", "Tenant_id: Bunnings", "Channel_id: 0196"; tags: bunnings, mirakl; payment: mirakl)
- Kogan (note: KoganOrderID; tags: kogan; payment: commercium, constacloud)
- Big W (note: "Order placed from: Big W"; tags: bigw, big w)
- Everyday Market / Woolworths (tags: everyday market, woolworths)
- Catch (note: CatchOrderID; tags: catch)
- eBay (note: eBayOrderID; tags: ebay; payment: ebay)
- PayPal (payment: paypal, paypal express checkout)
- Afterpay (payment: afterpay, afterpay_v2)
- Stripe (payment: stripe)
- Manual Orders (payment: manual)

If you recognise the marketplace, return a high confidence. If unsure, return low confidence.
The marketplace_code should be lowercase, underscore-separated (e.g. "mydeal", "bunnings", "everyday_market").`;

  const userPrompt = `Identify the marketplace for these Shopify orders:

Note Attributes samples (${(note_attributes_samples || []).length}):
${(note_attributes_samples || []).map((s, i) => `${i + 1}. ${s.substring(0, 200)}`).join('\n') || '(none)'}

Tags samples (${(tags_samples || []).length}):
${(tags_samples || []).map((s, i) => `${i + 1}. ${s.substring(0, 100)}`).join('\n') || '(none)'}

Payment Method: ${payment_method || '(none)'}
Row count: ${row_count || 0}`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "detect_marketplace",
            description: "Return structured marketplace detection result",
            parameters: {
              type: "object",
              properties: {
                marketplace_name: {
                  type: "string",
                  description: "Human-readable marketplace name (e.g. 'Bunnings Marketplace', 'Kogan', 'PayPal')",
                },
                marketplace_code: {
                  type: "string",
                  description: "Machine-readable code (e.g. 'bunnings', 'kogan', 'paypal', 'everyday_market')",
                },
                confidence: {
                  type: "number",
                  description: "Confidence level 0-100 in the detection",
                },
                confidence_reason: {
                  type: "string",
                  description: "Human-readable explanation referencing specific column names or values that justify the confidence score",
                },
                detection_field: {
                  type: "string",
                  enum: ["note_attributes", "tags", "payment_method", "combined", "unknown"],
                  description: "Which field was most useful for detection",
                },
                pattern: {
                  type: "string",
                  description: "The specific text pattern that was matched (e.g. 'MyDealOrderID', 'commercium by constacloud', 'kogan'). This is saved as a fingerprint for future instant detection.",
                },
                reasoning: {
                  type: "string",
                  description: "Brief explanation of why this marketplace was detected",
                },
              },
              required: ["marketplace_name", "marketplace_code", "confidence", "detection_field", "pattern", "reasoning"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "detect_marketplace" } },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (status === 402) {
      return new Response(
        JSON.stringify({ error: "AI quota exceeded. Please try again later." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const text = await response.text();
    console.error("AI gateway error:", status, text);
    return new Response(
      JSON.stringify({ error: "AI marketplace detection failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = await response.json();
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    return new Response(
      JSON.stringify({ error: "AI did not return structured detection" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let detection;
  try {
    detection = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;
  } catch {
    return new Response(
      JSON.stringify({ error: "AI returned invalid detection" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify(detection), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── analyse_file handler (original) ────────────────────────────────────────

async function handleAnalyseFile(
  body: { headers?: string[]; sampleRows?: unknown[]; filename?: string },
  apiKey: string
): Promise<Response> {
  const { headers: fileHeaders, sampleRows, filename } = body;

  if (!fileHeaders || !Array.isArray(fileHeaders)) {
    return new Response(
      JSON.stringify({ error: "Missing file headers" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const systemPrompt = `You are a marketplace accounting file analyser for Xettle, an Australian marketplace accounting tool.

Your job is to analyse CSV/TSV file structures and determine:
1. Whether this is a settlement/payout file (suitable for accounting)
2. Which marketplace it belongs to
3. How to map its columns to standard accounting fields

Known marketplaces: amazon_au, shopify_payments, bunnings, kogan, bigw, catch, mydeal, woolworths, ebay_au, etsy, theiconic

Common wrong file types users upload:
- Orders/sales exports (not settlements)
- Inventory reports
- Advertising reports
- Customer lists

For Australian marketplaces, settlement files typically contain: fees/commission, net payout/transfer amounts, and date ranges.`;

  const userPrompt = `Analyse this file:
Filename: ${filename || "unknown"}
Column headers: ${JSON.stringify(fileHeaders)}
Sample rows (first 3, PII stripped): ${JSON.stringify(sampleRows?.slice(0, 3) || [])}`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "analyse_file",
            description: "Return structured analysis of a marketplace file",
            parameters: {
              type: "object",
              properties: {
                is_settlement_file: {
                  type: "boolean",
                  description:
                    "True if this file contains settlement/payout data suitable for accounting. False if it's an orders export, inventory report, or other non-settlement file.",
                },
                marketplace_guess: {
                  type: "string",
                  description:
                    "Best guess for which marketplace this file belongs to. Use codes: amazon_au, shopify_payments, bunnings, kogan, bigw, catch, mydeal, woolworths, ebay_au, etsy, theiconic, unknown",
                },
                confidence: {
                  type: "number",
                  description: "Confidence level 0-100 in the detection",
                },
                confidence_reason: {
                  type: "string",
                  description: "Human-readable explanation referencing specific column names or values that justify the confidence score",
                },
                file_type_detected: {
                  type: "string",
                  enum: ["settlement", "orders", "inventory", "advertising", "customers", "unknown"],
                  description: "What type of file this appears to be",
                },
                column_mapping: {
                  type: "object",
                  description: "Maps standard fields to actual column names in the file",
                  properties: {
                    gross_sales: { type: "string", description: "Column containing gross sales/charges amount" },
                    fees: { type: "string", description: "Column containing fees/commission" },
                    refunds: { type: "string", description: "Column containing refund amounts" },
                    net_payout: { type: "string", description: "Column containing net payout/transfer amount" },
                    settlement_id: { type: "string", description: "Column containing unique settlement/payout ID" },
                    period_start: { type: "string", description: "Column containing start date" },
                    period_end: { type: "string", description: "Column containing end date" },
                    gst: { type: "string", description: "Column containing GST/tax amount" },
                  },
                  additionalProperties: false,
                },
                wrong_file_message: {
                  type: "string",
                  description:
                    "If not a settlement file, explain what this file actually is and why it can't be used for accounting",
                },
                download_instructions: {
                  type: "string",
                  description:
                    "If wrong file type, provide step-by-step path to download the correct settlement/payout report from the marketplace",
                },
              },
              required: ["is_settlement_file", "marketplace_guess", "confidence", "confidence_reason", "file_type_detected"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "analyse_file" } },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (status === 402) {
      return new Response(
        JSON.stringify({ error: "AI quota exceeded. Please try again later." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const text = await response.text();
    console.error("AI gateway error:", status, text);
    return new Response(
      JSON.stringify({ error: "AI analysis failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = await response.json();

  // Extract tool call result
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    return new Response(
      JSON.stringify({ error: "AI did not return structured analysis" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let analysis;
  try {
    analysis =
      typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
  } catch {
    return new Response(
      JSON.stringify({ error: "AI returned invalid analysis" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify(analysis), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
