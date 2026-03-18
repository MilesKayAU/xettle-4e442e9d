import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SYSTEM_PROMPT = `You are a specialist Xero Chart of Accounts (COA) auditor for Australian marketplace sellers.

Your expertise covers:
- Xero COA best practices for e-commerce businesses selling on Amazon, Shopify, eBay, Catch, Kogan, MyDeal, Bunnings, Woolworths Everyday Market, The Iconic, Etsy, BigW
- Australian GST requirements (10% GST on domestic sales, GST-free for exports)
- Proper account numbering, naming conventions, and account type assignments

## Audit Framework

Analyse the COA and provide a structured report covering:

### 1. ✅ What's Good
Highlight accounts that follow best practice (correct type, naming, tax treatment).

### 2. ⚠️ Naming Conventions
Best practice: "{Code} {Marketplace} {Category}" e.g. "201 Amazon Sales AU", "410 Shopify Seller Fees"
Flag accounts that don't follow this pattern or mix marketplace names.

### 3. 🏷️ Account Type Correctness
- Sales, Shipping, Refunds, Reimbursements → REVENUE (or OTHERINCOME for reimbursements)
- Seller Fees, FBA Fees, Storage, Advertising, Other Fees → EXPENSE or DIRECTCOSTS
- Clearing/Suspense accounts → CURRLIAB or CURRENT
Flag any accounts with incorrect types.

### 4. 💰 Tax Type Correctness (Australian GST)
- Domestic sales → "GST on Income" or "OUTPUT2"
- International/export sales → "GST Free Income" or "EXEMPTOUTPUT"
- Domestic expenses/fees → "GST on Expenses" or "INPUT2"
- International fees → "GST Free Expenses" or "EXEMPTEXPENSES"
Flag mismatched tax types.

### 5. 🔍 Missing Accounts per Marketplace
For each active marketplace, check for these categories:
- Sales, Shipping, Refunds (minimum required)
- Seller Fees, FBA Fees (if applicable)
- Storage Fees, Advertising Costs, Other Fees (recommended)
- Clearing/Suspense account (recommended for bank reconciliation)

### 6. 🔢 Numbering Consistency
- Revenue accounts: typically 200-299
- Expense accounts: typically 400-499 or 500-599
- Flag gaps, duplicates, or inconsistent numbering ranges.

### 7. 🚫 Common Anti-Patterns
- Generic "Marketplace Sales" instead of per-channel accounts
- Mixing multiple marketplaces in one account
- Using EXPENSE type for revenue items or vice versa
- Missing clearing accounts for bank deposits

### 8. 💡 Recommended Actions
Provide a prioritised list of specific changes (rename, retype, create, archive).

Keep the report concise but actionable. Use markdown formatting with clear sections.
If the COA is well-structured, say so — don't invent problems.`;

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const headers = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    // Fetch COA and marketplace connections in parallel
    const [coaResult, connectionsResult] = await Promise.all([
      supabase
        .from("xero_chart_of_accounts")
        .select("account_code, account_name, account_type, tax_type, is_active")
        .eq("user_id", userId)
        .order("account_code"),
      supabase
        .from("marketplace_connections")
        .select("marketplace_code, marketplace_name, connection_status")
        .eq("user_id", userId)
        .in("connection_status", ["active", "connected"]),
    ]);

    const coaAccounts = coaResult.data || [];
    const connections = connectionsResult.data || [];

    if (coaAccounts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No Xero COA found. Please sync your Chart of Accounts first." }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Build user message with COA and marketplace context
    const coaTable = coaAccounts
      .map((a: any) => `${a.account_code} | ${a.account_name} | ${a.account_type} | ${a.tax_type || "not set"} | ${a.is_active ? "active" : "inactive"}`)
      .join("\n");

    const marketplaceList = connections.length > 0
      ? connections.map((c: any) => `- ${c.marketplace_name} (${c.marketplace_code})`).join("\n")
      : "No marketplace connections detected.";

    const userMessage = `Please audit my Xero Chart of Accounts for my Australian e-commerce business.

## Active Marketplaces
${marketplaceList}

## Current Chart of Accounts
Code | Name | Type | Tax Type | Status
${coaTable}

Provide your best-practice audit report.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        stream: true,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please top up your workspace." }), {
          status: 402,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(aiResponse.body, {
      headers: { ...headers, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-coa-audit error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req.headers.get("Origin") ?? ""), "Content-Type": "application/json" },
    });
  }
});
