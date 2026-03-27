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
    // --- Auth (admin-only) ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { data: isAdmin } = await userClient.rpc("has_role", { _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, serviceKey);

    // =====================================================
    // 1. Guardrail checks
    // =====================================================
    const [g1, g3, g5] = await Promise.all([
      db.from("marketplace_validation").select("settlement_id", { count: "exact", head: true }).eq("overall_status", "ready_to_push"),
      db.from("settlements").select("id", { count: "exact", head: true }).like("settlement_id", "shopify_auto_%").eq("status", "pushed_to_xero"),
      db.from("marketplace_validation").select("id", { count: "exact", head: true }).eq("gap_acknowledged", true).not("overall_status", "in", '("gap_acknowledged","already_recorded")'),
    ]);

    const guardrails = [
      { name: "shopify_auto_ pushed to Xero", violations: g3.count ?? 0 },
      { name: "gap_acknowledged with wrong status", violations: g5.count ?? 0 },
      { name: "ready_to_push count", count: g1.count ?? 0, info: true },
    ];

    // =====================================================
    // 2. Reconciliation formula checks — EXCLUDE non-Xettle settlements
    // =====================================================
    const EXCLUDED_STATUSES = ["already_recorded", "reconciliation_only", "archived", "push_failed_permanent", "duplicate_suppressed"];

    const { data: settlements } = await db
      .from("settlements")
      .select("settlement_id, marketplace, sales_principal, sales_shipping, seller_fees, other_fees, refunds, advertising_costs, reimbursements, gst_on_income, gst_on_expenses, bank_deposit, fba_fees, storage_fees, net_ex_gst, status, source")
      .eq("user_id", userId)
      .not("status", "in", `(${EXCLUDED_STATUSES.join(",")})`)
      .is("duplicate_of_settlement_id", null)
      .eq("is_hidden", false)
      .order("period_end", { ascending: false })
      .limit(500);

    // Also fetch ALL settlements for status distribution
    const { data: allSettlements } = await db
      .from("settlements")
      .select("settlement_id, marketplace, status, source")
      .eq("user_id", userId)
      .is("duplicate_of_settlement_id", null)
      .eq("is_hidden", false)
      .order("period_end", { ascending: false })
      .limit(1000);

    const gstInclusiveMarketplaces = [
      "shopify_payments", "everyday_market", "bigw", "woolworths_marketplus",
      "woolworths_everyday", "woolworths_bigw"
    ];

    const formulaChecks: any[] = [];
    for (const s of (settlements || [])) {
      const sp = Number(s.sales_principal) || 0;
      const ss = Number(s.sales_shipping) || 0;
      const sf = Math.abs(Number(s.seller_fees) || 0);
      const of_ = Math.abs(Number(s.other_fees) || 0);
      const rf = Math.abs(Number(s.refunds) || 0);
      const ac = Math.abs(Number(s.advertising_costs) || 0);
      const rb = Number(s.reimbursements) || 0;
      const gi = Number(s.gst_on_income) || 0;
      const ge = Math.abs(Number(s.gst_on_expenses) || 0);
      const bd = Number(s.bank_deposit) || 0;
      const fba = Math.abs(Number(s.fba_fees) || 0);
      const stg = Math.abs(Number(s.storage_fees) || 0);

      const includeGst = gstInclusiveMarketplaces.includes(s.marketplace || "");
      const calculated = sp + ss + (includeGst ? gi : 0) + rb - sf - of_ - rf - ac - fba - stg - ge;
      const diff = Math.abs(calculated - bd);

      if (diff > 1.00) {
        formulaChecks.push({
          settlement_id: s.settlement_id,
          marketplace: s.marketplace,
          status: s.status,
          calculated: +calculated.toFixed(2),
          bank_deposit: bd,
          difference: +(calculated - bd).toFixed(2),
          include_gst: includeGst,
        });
      }
    }

    // =====================================================
    // 3. GST consistency check (only active settlements)
    // =====================================================
    const gstIssues: any[] = [];
    for (const s of (settlements || [])) {
      const mp = s.marketplace || "";
      const gi = Number(s.gst_on_income) || 0;
      const sp = Number(s.sales_principal) || 0;

      if (gstInclusiveMarketplaces.includes(mp) && sp > 100) {
        const expectedGst = sp / 11;
        const gstDiff = Math.abs(gi - expectedGst);
        if (gstDiff > expectedGst * 0.5 && gi === 0) {
          gstIssues.push({
            settlement_id: s.settlement_id,
            marketplace: mp,
            issue: "GST-inclusive marketplace but gst_on_income is 0",
            sales_principal: sp,
            gst_on_income: gi,
          });
        }
      }
    }

    // =====================================================
    // 4. Account mapping completeness — query app_settings (Fix 76a)
    // =====================================================
    const { data: mappingSettings } = await db
      .from("app_settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "accounting_xero_account_codes")
      .single();

    const { data: activeConnections } = await db
      .from("marketplace_connections")
      .select("marketplace_code")
      .eq("user_id", userId)
      .eq("connection_status", "active");

    // Mapping format is flat: "Category:Marketplace Display Name" → "account_code"
    // e.g. "Sales:Amazon AU" → "200", "Seller Fees:Shopify" → "400"
    // Also has defaults without marketplace suffix: "Sales" → "211"
    const REQUIRED_CATEGORIES_DISPLAY = ["Sales", "Seller Fees", "Refunds"];
    const MARKETPLACE_CODE_TO_DISPLAY: Record<string, string> = {
      amazon_au: "Amazon AU",
      shopify_payments: "Shopify",
      ebay_au: "eBay AU",
      everyday_market: "Everyday Market",
      bigw: "BigW",
      mydeal: "MyDeal",
      kogan: "Kogan",
      bunnings: "Bunnings",
      woolworths_marketplus: "Everyday Market",
      woolworths_everyday: "Everyday Market",
      woolworths_bigw: "BigW",
    };

    const mappingGaps: any[] = [];
    const mappingStatus: any[] = [];

    let flatMappings: Record<string, string> = {};
    try {
      if (mappingSettings?.value) {
        flatMappings = typeof mappingSettings.value === "string"
          ? JSON.parse(mappingSettings.value)
          : mappingSettings.value;
      }
    } catch {
      flatMappings = {};
    }

    for (const conn of (activeConnections || [])) {
      const mpCode = conn.marketplace_code;
      const displayName = MARKETPLACE_CODE_TO_DISPLAY[mpCode] || mpCode;

      // Check for marketplace-specific mappings like "Sales:Amazon AU"
      // or fall back to default mappings like "Sales"
      const mappedCategories: string[] = [];
      const missing: string[] = [];

      for (const cat of REQUIRED_CATEGORIES_DISPLAY) {
        const specificKey = `${cat}:${displayName}`;
        if (flatMappings[specificKey] || flatMappings[cat]) {
          mappedCategories.push(cat);
        } else {
          missing.push(cat);
        }
      }

      if (missing.length > 0) {
        mappingGaps.push({
          marketplace_code: mpCode,
          missing_categories: missing,
          mapped_categories: mappedCategories,
        });
      }

      mappingStatus.push({
        marketplace_code: mpCode,
        mapped_count: mappedCategories.length,
        mapped_categories: mappedCategories,
        complete: missing.length === 0,
      });
    }

    // =====================================================
    // 5. Settlement components vs settlements discrepancies
    // =====================================================
    const { data: components } = await db
      .from("settlement_components")
      .select("settlement_id, marketplace_code, sales_ex_tax, sales_tax, fees_ex_tax, fees_tax, refunds_ex_tax, payout_total")
      .eq("user_id", userId)
      .limit(200);

    const parserDiscrepancies: any[] = [];
    const allSettlementMap = new Map((allSettlements || []).map(s => [s.settlement_id, s]));
    // Also map the detailed settlements for bank_deposit
    const detailedMap = new Map((settlements || []).map(s => [s.settlement_id, s]));

    for (const comp of (components || [])) {
      // Get bank_deposit from detailed settlements first, fall back to allSettlements
      const detailedS = detailedMap.get(comp.settlement_id);
      // We need bank_deposit which is only in the detailed query
      if (!detailedS) continue;

      const compPayout = Number(comp.payout_total) || 0;
      const sBankDeposit = Number(detailedS.bank_deposit) || 0;
      const diff = Math.abs(compPayout - sBankDeposit);

      if (diff > 1.00) {
        parserDiscrepancies.push({
          settlement_id: comp.settlement_id,
          marketplace: detailedS.marketplace,
          component_payout: compPayout,
          settlement_bank_deposit: sBankDeposit,
          difference: +(compPayout - sBankDeposit).toFixed(2),
        });
      }
    }

    // =====================================================
    // 6. Settlement status distribution (from ALL settlements)
    // =====================================================
    const statusDistribution: Record<string, number> = {};
    for (const s of (allSettlements || [])) {
      statusDistribution[s.status] = (statusDistribution[s.status] || 0) + 1;
    }

    // =====================================================
    // 7. Specific investigation items
    // =====================================================
    const investigationItems: any[] = [];
    for (const fc of formulaChecks) {
      investigationItems.push({
        settlement_id: fc.settlement_id,
        marketplace: fc.marketplace,
        gap: fc.difference,
        status: fc.status,
        action: Math.abs(fc.difference) < 10 ? "investigate_small_residual" : "needs_reupload_or_review",
      });
    }

    // =====================================================
    // 8. Send to Claude for analysis
    // =====================================================
    const auditData = {
      guardrails,
      formula_discrepancies: formulaChecks.slice(0, 20),
      formula_total_count: formulaChecks.length,
      settlements_checked_scope: "active only (excludes already_recorded, reconciliation_only, archived)",
      gst_issues: gstIssues.slice(0, 10),
      gst_total_count: gstIssues.length,
      mapping_source: "app_settings.accounting_xero_account_codes (Fix 76a)",
      mapping_gaps: mappingGaps,
      mapping_status: mappingStatus,
      parser_discrepancies: parserDiscrepancies.slice(0, 10),
      parser_total_count: parserDiscrepancies.length,
      status_distribution: statusDistribution,
      total_active_settlements_checked: (settlements || []).length,
      total_all_settlements: (allSettlements || []).length,
      investigation_items: investigationItems.slice(0, 10),
    };

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({
          audit_data: auditData,
          ai_analysis: null,
          error: "ANTHROPIC_API_KEY not configured — returning raw audit data only",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        max_tokens: 2000,
        system: `You are an expert in Australian marketplace seller accounting and Xero integration.
Analyse the audit data from Xettle, a SaaS that reconciles marketplace settlements
(Shopify, Amazon, Bunnings, Kogan, eBay, Woolworths/BigW/Everyday Market) into Xero.

IMPORTANT CONTEXT for accurate scoring:
- The formula check ONLY includes active settlements (excludes already_recorded, reconciliation_only, archived). If there are few or no formula discrepancies, this is GOOD.
- Account mappings are stored in app_settings under 'accounting_xero_account_codes' (Fix 76a). Check mapping_status to see actual completeness — not the old marketplace_account_mapping table.
- MyDeal negative settlements (refund-only periods) with small formula gaps are expected behaviour.
- Small gaps under $10 are often rounding residuals, classify as INFO not CRITICAL.
- Settlements needing re-upload via fixed parser are WARNING not CRITICAL.

For each finding, classify as:
- CRITICAL: Will cause wrong Xero postings or data loss
- WARNING: May cause reconciliation issues or needs user action
- INFO: Improvement opportunity or informational

Return ONLY valid JSON matching this schema:
{
  "findings": [
    {
      "severity": "CRITICAL" | "WARNING" | "INFO",
      "category": "string",
      "description": "string",
      "affected_settlements": ["settlement_id1", ...] or [],
      "recommendation": "string",
      "auto_fixable": boolean
    }
  ],
  "overall_health_score": number (0-100),
  "push_safe": boolean,
  "summary": "One-paragraph executive summary"
}`,
        messages: [
          {
            role: "user",
            content: `Audit data from Xettle system:\n${JSON.stringify(auditData)}`,
          },
        ],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error("Anthropic API error:", anthropicResp.status, errText);
      return new Response(
        JSON.stringify({
          audit_data: auditData,
          ai_analysis: null,
          error: "AI analysis failed — returning raw audit data",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicData = await anthropicResp.json();
    const rawContent = anthropicData.content?.[0]?.text || "{}";

    let aiAnalysis: any;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      aiAnalysis = JSON.parse(jsonMatch?.[0] || rawContent);
    } catch {
      aiAnalysis = {
        findings: [],
        overall_health_score: 0,
        push_safe: false,
        summary: "Failed to parse AI response: " + rawContent.slice(0, 200),
      };
    }

    // Log audit event
    await db.from("system_events").insert({
      user_id: userId,
      event_type: "system_audit_completed",
      severity: "info",
      details: {
        health_score: aiAnalysis.overall_health_score,
        push_safe: aiAnalysis.push_safe,
        findings_count: aiAnalysis.findings?.length ?? 0,
        critical_count: aiAnalysis.findings?.filter((f: any) => f.severity === "CRITICAL").length ?? 0,
        active_settlements_checked: (settlements || []).length,
        formula_discrepancies: formulaChecks.length,
      },
    });

    return new Response(
      JSON.stringify({
        audit_data: auditData,
        ai_analysis: aiAnalysis,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("run-system-audit error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
