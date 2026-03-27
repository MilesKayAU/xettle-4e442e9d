import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // --- Parse body ---
    const { settlement_id } = await req.json();
    if (!settlement_id) {
      return new Response(JSON.stringify({ error: "settlement_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Service-role client for data queries ---
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- Gather forensic data in parallel ---
    const [settlementRes, validationRes, bankTxRes, linesRes] = await Promise.all([
      serviceClient
        .from("settlements")
        .select(
          "settlement_id, marketplace, period_start, period_end, sales_principal, sales_shipping, seller_fees, fba_fees, other_fees, refunds, reimbursements, gst_on_income, gst_on_expenses, bank_deposit, net_ex_gst, source, status, storage_fees, advertising_costs, promotional_discounts"
        )
        .eq("settlement_id", settlement_id)
        .eq("user_id", userId)
        .maybeSingle(),

      serviceClient
        .from("marketplace_validation")
        .select(
          "reconciliation_difference, reconciliation_status, overall_status, settlement_net, bank_matched, bank_amount, xero_pushed, gap_acknowledged"
        )
        .eq("settlement_id", settlement_id)
        .eq("user_id", userId)
        .maybeSingle(),

      serviceClient
        .from("bank_transactions")
        .select("amount, date, description, contact_name")
        .eq("user_id", userId)
        .gte("amount", -50000)
        .lte("amount", 50000)
        .limit(5),

      serviceClient
        .from("settlement_lines")
        .select("transaction_type, amount_type, amount, accounting_category")
        .eq("settlement_id", settlement_id)
        .eq("user_id", userId)
        .limit(50),
    ]);

    const settlement = settlementRes.data;
    const validation = validationRes.data;

    if (!settlement) {
      return new Response(
        JSON.stringify({ error: "Settlement not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context for Claude
    const gapData = {
      settlement: {
        id: settlement.settlement_id,
        marketplace: settlement.marketplace,
        period: `${settlement.period_start} to ${settlement.period_end}`,
        sales_principal: settlement.sales_principal,
        sales_shipping: settlement.sales_shipping,
        seller_fees: settlement.seller_fees,
        fba_fees: settlement.fba_fees,
        other_fees: settlement.other_fees,
        refunds: settlement.refunds,
        reimbursements: settlement.reimbursements,
        gst_on_income: settlement.gst_on_income,
        gst_on_expenses: settlement.gst_on_expenses,
        bank_deposit: settlement.bank_deposit,
        net_ex_gst: settlement.net_ex_gst,
        source: settlement.source,
        storage_fees: settlement.storage_fees,
        advertising_costs: settlement.advertising_costs,
      },
      validation: validation
        ? {
            reconciliation_difference: validation.reconciliation_difference,
            reconciliation_status: validation.reconciliation_status,
            overall_status: validation.overall_status,
            settlement_net: validation.settlement_net,
            bank_matched: validation.bank_matched,
            bank_amount: validation.bank_amount,
            xero_pushed: validation.xero_pushed,
          }
        : null,
      line_item_summary: {
        total_lines: linesRes.data?.length ?? 0,
        categories: [
          ...new Set((linesRes.data || []).map((l: any) => l.accounting_category).filter(Boolean)),
        ],
      },
    };

    // --- Call Anthropic ---
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: `You are a financial reconciliation expert. Analyse the gap data and return ONLY valid JSON matching this schema: {"suggested_reason": string, "confidence": "high"|"medium"|"low", "explanation": string}.

Valid suggested_reason values:
- "Rounding difference"
- "Marketplace no longer active"
- "Bank timing difference"
- "Fee not in settlement data"
- "GST calculation difference"
- "Open settlement period"
- "Duplicate transaction"
- "Manual entry in Xero"
- "Other"

Guidelines:
- If |reconciliation_difference| <= $2.00, suggest "Rounding difference" with high confidence
- If marketplace contains "mydeal" or "catch" and gap is large, suggest "Marketplace no longer active"
- If bank_matched is false and gap roughly equals bank_deposit, suggest "Bank timing difference"
- If gst_on_income or gst_on_expenses look incorrect relative to sales, suggest "GST calculation difference"
- Only use "high" confidence when the pattern is unambiguous
- Use "medium" when likely but not certain
- Use "low" when guessing`,
        messages: [
          {
            role: "user",
            content: `Analyse this reconciliation gap and suggest an acknowledgement reason:\n${JSON.stringify(gapData)}`,
          },
        ],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error("Anthropic API error:", anthropicResp.status, errText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed", status: anthropicResp.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicData = await anthropicResp.json();
    const rawContent = anthropicData.content?.[0]?.text || "{}";

    // Parse the JSON response
    let suggestion: { suggested_reason: string; confidence: string; explanation: string };
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      suggestion = JSON.parse(jsonMatch?.[0] || rawContent);
    } catch {
      suggestion = {
        suggested_reason: "Other",
        confidence: "low",
        explanation: "Could not parse AI response: " + rawContent.slice(0, 200),
      };
    }

    // Validate suggested_reason
    const validReasons = [
      "Rounding difference",
      "Marketplace no longer active",
      "Bank timing difference",
      "Fee not in settlement data",
      "GST calculation difference",
      "Open settlement period",
      "Duplicate transaction",
      "Manual entry in Xero",
      "Other",
    ];
    if (!validReasons.includes(suggestion.suggested_reason)) {
      suggestion.suggested_reason = "Other";
      suggestion.confidence = "low";
    }

    return new Response(JSON.stringify(suggestion), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-gap-suggest-reason error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
