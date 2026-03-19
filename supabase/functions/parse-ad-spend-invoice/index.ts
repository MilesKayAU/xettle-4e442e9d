import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

/**
 * parse-ad-spend-invoice
 *
 * Accepts base64-encoded PDF or spreadsheet content and uses AI to extract:
 *   - marketplace_code (e.g. "kogan", "amazon_au")
 *   - billing period (start + end dates)
 *   - ad spend amount (ex-GST)
 *   - currency
 *
 * Returns structured JSON for the frontend to confirm and save.
 */

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
    const { file_content, file_name, file_type } = body;

    if (!file_content) {
      return new Response(
        JSON.stringify({ error: "No file content provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are an ad-spend invoice parser for Xettle, an Australian marketplace accounting tool.

You will receive the text content of an advertising invoice or report (PDF or spreadsheet).
Your job is to extract structured data from it.

Known Australian marketplaces:
- Kogan (kogan) — "Kogan Ads", "Kogan Australia"
- Amazon AU (amazon_au) — "Amazon Advertising", "Amazon.com.au"
- eBay AU (ebay_au) — "eBay Ads", "eBay Australia"
- Catch (catch) — "Catch.com.au"
- MyDeal (mydeal)
- BigW / Big W (bigw)
- Bunnings (bunnings)
- Everyday Market (everyday_market) — Woolworths Everyday Market
- Iconic (iconic)
- TikTok (tiktok) — "TikTok Shop", "TikTok Ads"
- Shopify (shopify) — "Shopify", "Facebook Ads via Shopify"
- TradeSquare (tradesquare)

Extract ALL billing periods found in the document. For each period, return:
- marketplace_code: lowercase snake_case from the list above
- marketplace_label: human-readable name
- period_start: YYYY-MM-DD
- period_end: YYYY-MM-DD  
- spend_amount: number (ex-GST if possible, otherwise note it includes GST)
- currency: ISO 4217 code (default AUD for Australian invoices)
- includes_gst: boolean — true if the amount includes GST
- gst_amount: number or null
- invoice_number: string or null
- confidence: number 0-1

If the document contains multiple billing periods (e.g. a yearly summary), return each as a separate entry.

IMPORTANT: Return the spend amount EXCLUDING GST when possible. If only the GST-inclusive total is available, set includes_gst to true.

Respond ONLY with valid JSON in this format:
{
  "entries": [
    {
      "marketplace_code": "kogan",
      "marketplace_label": "Kogan",
      "period_start": "2026-02-01",
      "period_end": "2026-02-28",
      "spend_amount": 91.00,
      "currency": "AUD",
      "includes_gst": false,
      "gst_amount": 9.10,
      "invoice_number": "106384-2603i",
      "confidence": 0.95
    }
  ],
  "raw_summary": "Brief one-line description of the document"
}

If you cannot parse the document, return:
{ "entries": [], "error": "reason", "raw_summary": "..." }`;

    const userMessage = `Parse this advertising invoice/report.
File name: ${file_name || 'unknown'}
File type: ${file_type || 'unknown'}

Document content:
${file_content}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI API error:", errText);
      return new Response(
        JSON.stringify({ error: "AI parsing failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
    const jsonStr = (jsonMatch[1] || rawContent).trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response as JSON:", rawContent);
      return new Response(
        JSON.stringify({ error: "Could not parse AI response", raw: rawContent }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-ad-spend-invoice error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
