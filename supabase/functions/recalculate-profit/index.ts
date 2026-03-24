/**
 * recalculate-profit — One-shot or on-demand edge function to recalculate
 * all settlement_profit rows for the authenticated user using current
 * fulfilment methods and postage costs from app_settings.
 *
 * Phase A: Uses settlement_lines.fulfilment_channel for mixed FBA/FBM split.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getPostageDeductionForOrder } from "../_shared/fulfilment-policy.ts";

/** Paginated fetch helper — avoids the 1000-row default cap */
async function fetchAllRows<T>(
  query: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const headers = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the user via their JWT
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Use service role for data operations
    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const userId = user.id;

    // Load user's fulfilment methods, postage costs, and MCF costs from app_settings
    const { data: settingsRows } = await admin
      .from("app_settings")
      .select("key, value")
      .eq("user_id", userId)
      .or("key.like.fulfilment_method:%,key.like.postage_cost:%,key.like.mcf_cost:%");

    const fulfilmentMethods: Record<string, string> = {};
    const postageCosts: Record<string, number> = {};
    const mcfCosts: Record<string, number> = {};

    for (const row of settingsRows || []) {
      if (row.key.startsWith("fulfilment_method:")) {
        const code = row.key.replace("fulfilment_method:", "");
        if (code && row.value) fulfilmentMethods[code] = row.value;
      } else if (row.key.startsWith("postage_cost:")) {
        const code = row.key.replace("postage_cost:", "");
        const num = parseFloat(row.value || "");
        if (code && !isNaN(num) && num >= 0) postageCosts[code] = num;
      } else if (row.key.startsWith("mcf_cost:")) {
        const code = row.key.replace("mcf_cost:", "");
        const num = parseFloat(row.value || "");
        if (code && !isNaN(num) && num >= 0) mcfCosts[code] = num;
      }
    }

    // Load all settlements for user (paginated)
    const settlements = await fetchAllRows(
      admin
        .from("settlements")
        .select("settlement_id, marketplace, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, other_fees, gst_on_income, gst_on_expenses, period_start, period_end")
        .eq("user_id", userId)
        .eq("is_hidden", false)
        .is("duplicate_of_settlement_id", null)
    );

    // Load settlement lines (paginated) and product costs
    const [allLines, productCosts] = await Promise.all([
      fetchAllRows(
        admin.from("settlement_lines")
          .select("settlement_id, sku, amount, order_id, transaction_type, fulfilment_channel")
          .eq("user_id", userId)
      ),
      fetchAllRows(
        admin.from("product_costs")
          .select("sku, cost, currency, label")
          .eq("user_id", userId)
      ),
    ]);

    // Build cost lookup
    const costMap = new Map<string, number>();
    for (const pc of productCosts) {
      costMap.set(pc.sku.toUpperCase().trim().replace(/-/g, ""), pc.cost);
    }

    // Index lines by settlement_id
    const linesBySettlement = new Map<string, typeof allLines>();
    for (const line of allLines) {
      const sid = line.settlement_id;
      if (!linesBySettlement.has(sid)) linesBySettlement.set(sid, []);
      linesBySettlement.get(sid)!.push(line);
    }

    // Build set of order IDs that belong to sub-channel auto-settlements
    // (e.g. shopify_auto_bunnings, shopify_auto_kogan). These orders also
    // appear in the parent Shopify payout CSV, so we must exclude them from
    // the Shopify payout's shipping count to avoid double-counting.
    const subChannelOrderIds = new Set<string>();
    for (const s of settlements || []) {
      if (s.settlement_id?.startsWith("shopify_auto_")) {
        const lines = linesBySettlement.get(s.settlement_id) || [];
        for (const l of lines) {
          if (l.order_id) subChannelOrderIds.add(l.order_id);
        }
      }
    }

    const AMAZON_PREFIXES = ["amazon"];
    function isAmazonCode(code: string): boolean {
      return AMAZON_PREFIXES.some((p) => code.toLowerCase().startsWith(p));
    }
    function getEffectiveMethod(mp: string, stored?: string | null): string {
      if (stored) return stored;
      return isAmazonCode(mp) ? "marketplace_fulfilled" : "not_sure";
    }

    let updated = 0;
    let skipped = 0;
    const upsertBatch: any[] = [];

    for (const s of settlements || []) {
      const mp = s.marketplace;
      if (!mp) { skipped++; continue; }

      const salesExGst = Math.abs(
        (s.sales_principal || 0) + (s.sales_shipping || 0) - (s.gst_on_income || 0)
      );
      const feesAmount = Math.abs(
        (s.seller_fees || 0) + (s.fba_fees || 0) + (s.storage_fees || 0) + (s.other_fees || 0)
      );

      const lines = linesBySettlement.get(s.settlement_id) || [];
      const revenueLines = lines.filter(
        (l) =>
          l.transaction_type === "Order" ||
          l.transaction_type === "ItemPrice" ||
          l.transaction_type === "ProductCharges" ||
          l.transaction_type === null ||
          (l.amount && l.amount > 0)
      );

      let totalCogs = 0;
      let unitsSold = 0;
      const orderIds = new Set<string>();
      const uncostedSkus = new Set<string>();
      let uncostedRevenue = 0;

      for (const line of revenueLines) {
        const qty = 1;
        unitsSold += qty;
        if (line.order_id) orderIds.add(line.order_id);

        if (line.sku) {
          const normalised = line.sku.toUpperCase().trim().replace(/-/g, "");
          const cost = costMap.get(normalised);
          if (cost !== undefined) {
            totalCogs += cost * qty;
          } else {
            uncostedSkus.add(normalised);
            uncostedRevenue += Math.abs(line.amount || 0);
          }
        } else {
          uncostedRevenue += Math.abs(line.amount || 0);
        }
      }

      const ordersCount = orderIds.size || revenueLines.length || 1;
      const fulfilmentMethod = getEffectiveMethod(mp, fulfilmentMethods[mp]);
      const postageCostPerOrder = postageCosts[mp] || 0;
      const mcfCostPerOrder = mcfCosts[mp] || 0;

      // Calculate postage deduction using canonical shared function
      let postageDeduction = 0;
      let fulfilmentDataIncomplete = false;

      if (fulfilmentMethod === "mixed_fba_fbm") {
        // Line-level split
        const hasLineData = revenueLines.some((l) => l.fulfilment_channel);
        if (hasLineData) {
          // Deduplicate by order_id
          const orderChannels = new Map<string, string | null>();
          for (const line of revenueLines) {
            const key = line.order_id || `line_${revenueLines.indexOf(line)}`;
            if (!orderChannels.has(key)) {
              orderChannels.set(key, line.fulfilment_channel || null);
            }
          }
          for (const [, ch] of orderChannels) {
            postageDeduction += getPostageDeductionForOrder(fulfilmentMethod, ch, postageCostPerOrder, 1, mcfCostPerOrder);
          }
        } else {
          // No line data (legacy) → zero deduction (treat all as FBA)
          fulfilmentDataIncomplete = true;
        }
      } else {
        // Non-mixed: canonical function owns the multiplication via orderCount
        postageDeduction = getPostageDeductionForOrder(fulfilmentMethod, null, postageCostPerOrder, ordersCount, mcfCostPerOrder);
      }

      const grossProfit = salesExGst - totalCogs - feesAmount - postageDeduction;
      const marginPercent = salesExGst > 0 ? (grossProfit / salesExGst) * 100 : 0;
      const round = (n: number) => Math.round(n * 100) / 100;

      upsertBatch.push({
        user_id: userId,
        settlement_id: s.settlement_id,
        marketplace_code: mp,
        period_label: `${s.period_start} → ${s.period_end}`,
        gross_revenue: round(salesExGst),
        total_cogs: round(totalCogs),
        marketplace_fees: round(feesAmount),
        postage_deduction: round(postageDeduction),
        gross_profit: round(grossProfit),
        margin_percent: round(marginPercent),
        orders_count: ordersCount,
        units_sold: unitsSold,
        uncosted_sku_count: uncostedSkus.size,
        uncosted_revenue: round(uncostedRevenue),
        fulfilment_data_incomplete: fulfilmentDataIncomplete,
        calculated_at: new Date().toISOString(),
      });

      updated++;
    }

    // Batch upsert in chunks of 500
    for (let i = 0; i < upsertBatch.length; i += 500) {
      const chunk = upsertBatch.slice(i, i + 500);
      const { error: upsertErr } = await admin
        .from("settlement_profit")
        .upsert(chunk, { onConflict: "user_id,marketplace_code,settlement_id" });
      if (upsertErr) {
        console.error("Upsert error on chunk", i, upsertErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, updated, skipped }),
      {
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("recalculate-profit error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  }
});
