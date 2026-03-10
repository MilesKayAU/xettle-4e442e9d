import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SHOPIFY_API_VERSION = "2026-01";
const RATE_LIMIT_DELAY_MS = 500;

interface ShopifyPayout {
  id: number;
  date: string;
  currency: string;
  amount: string;
  status: string;
}

interface ShopifyTransaction {
  id: number;
  type: string;
  amount: string;
  fee: string;
  net: string;
  payout_id: number;
  source_order_id?: number;
  source_type?: string;
  processed_at?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─── Auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    // ─── Get Shopify token ────────────────────────────────────────────
    const { data: tokenRow, error: tokenError } = await supabase
      .from("shopify_tokens")
      .select("access_token, shop_domain")
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: "No Shopify connection found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { access_token: accessToken, shop_domain: shopDomain } = tokenRow;

    // ─── Check cooldown (1 hour minimum between syncs) ────────────────
    const { data: cooldownSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "shopify_payout_last_sync")
      .eq("user_id", userId)
      .maybeSingle();

    if (cooldownSetting?.value) {
      const lastSync = new Date(cooldownSetting.value);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      if (lastSync > hourAgo) {
        return new Response(
          JSON.stringify({
            error: "Sync cooldown active",
            message: `Last sync was ${Math.round((Date.now() - lastSync.getTime()) / 60000)} minutes ago. Please wait at least 1 hour between syncs.`,
            last_sync: cooldownSetting.value,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Enforce accounting boundary ──────────────────────────────────
    let dateMin: string | undefined;
    const { data: boundarySetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "accounting_boundary_date")
      .eq("user_id", userId)
      .maybeSingle();

    if (boundarySetting?.value) {
      dateMin = boundarySetting.value;
    }

    // ─── Fetch paid payouts from Shopify ──────────────────────────────
    const allPayouts: ShopifyPayout[] = [];
    let nextPageUrl: string | undefined;
    let page = 0;
    const MAX_PAGES = 10;

    const buildInitialUrl = () => {
      const params = new URLSearchParams({ status: "paid" });
      if (dateMin) params.set("date_min", dateMin);
      return `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/payouts.json?${params.toString()}`;
    };

    let url: string = buildInitialUrl();

    do {
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (res.status === 401) {
        return new Response(
          JSON.stringify({ error: "Shopify token invalid or expired" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: "Shopify rate limit exceeded. Try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!res.ok) {
        const body = await res.text();
        return new Response(
          JSON.stringify({ error: `Shopify API error ${res.status}`, detail: body }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await res.json();
      allPayouts.push(...(data.payouts || []));

      // Parse Link header for pagination
      nextPageUrl = undefined;
      const linkHeader = res.headers.get("Link");
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) nextPageUrl = nextMatch[1];
      }

      if (nextPageUrl) url = nextPageUrl;
      page++;
    } while (nextPageUrl && page < MAX_PAGES);

    // ─── Dedup: filter out already-imported payouts ────────────────────
    const payoutIds = allPayouts.map((p) => String(p.id));
    const { data: existingSettlements } = await supabase
      .from("settlements")
      .select("settlement_id")
      .eq("user_id", userId)
      .eq("marketplace", "shopify_payments")
      .in("settlement_id", payoutIds);

    const existingIds = new Set((existingSettlements || []).map((e: any) => e.settlement_id));
    const newPayouts = allPayouts.filter((p) => !existingIds.has(String(p.id)));

    if (newPayouts.length === 0) {
      // Update cooldown even when nothing new
      await upsertSetting(supabase, userId, "shopify_payout_last_sync", new Date().toISOString());

      return new Response(
        JSON.stringify({ success: true, synced: 0, skipped: allPayouts.length, message: "All payouts already imported" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Fetch transactions for each new payout ───────────────────────
    let synced = 0;
    const errors: string[] = [];

    for (const payout of newPayouts) {
      try {
        await sleep(RATE_LIMIT_DELAY_MS);

        const txUrl = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/balance/transactions.json?payout_id=${payout.id}&limit=250`;
        const txRes = await fetch(txUrl, {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        });

        if (!txRes.ok) {
          errors.push(`Payout ${payout.id}: HTTP ${txRes.status}`);
          continue;
        }

        const txData = await txRes.json();
        const transactions: ShopifyTransaction[] = txData.transactions || [];

        // ─── Aggregate financials ────────────────────────────────
        let grossSales = 0;
        let totalFees = 0;
        let totalRefunds = 0;
        let totalAdjustments = 0;

        for (const tx of transactions) {
          const amount = parseFloat(tx.amount) || 0;
          const fee = parseFloat(tx.fee) || 0;

          switch (tx.type) {
            case "charge":
              grossSales += amount;
              totalFees += fee;
              break;
            case "refund":
              totalRefunds += Math.abs(amount);
              totalFees += fee;
              break;
            case "adjustment":
            case "reserve":
            case "payout":
              totalAdjustments += amount;
              break;
            default:
              totalAdjustments += amount;
              totalFees += fee;
              break;
          }
        }

        const netPayout = parseFloat(payout.amount) || 0;
        const payoutDate = payout.date;

        // Derive GST at 1/11th for Australian compliance
        const gstOnIncome = grossSales / 11;
        const salesExGst = grossSales - gstOnIncome;
        const gstOnExpenses = Math.abs(totalFees) / 11;
        const feesExGst = Math.abs(totalFees) - gstOnExpenses;
        const netExGst = netPayout - gstOnIncome + gstOnExpenses;

        // Determine if this payout falls before the accounting boundary
        const isBeforeBoundary = dateMin && payoutDate < dateMin;
        const settlementStatus = isBeforeBoundary ? "already_recorded" : "ready_to_push";

        // ─── Insert settlement ───────────────────────────────────
        const { error: insertError } = await supabase.from("settlements").insert({
          user_id: userId,
          settlement_id: String(payout.id),
          marketplace: "shopify_payments",
          source: "api",
          status: settlementStatus,
          period_start: payoutDate,
          period_end: payoutDate,
          deposit_date: payoutDate,
          sales_principal: salesExGst,
          sales_shipping: 0,
          seller_fees: feesExGst,
          fba_fees: 0,
          storage_fees: 0,
          refunds: -totalRefunds,
          reimbursements: 0,
          promotional_discounts: 0,
          other_fees: totalAdjustments,
          gst_on_income: gstOnIncome,
          gst_on_expenses: -gstOnExpenses,
          net_ex_gst: netExGst,
          bank_deposit: netPayout,
          raw_payload: {
            payout,
            transactions,
          },
        } as any);

        if (insertError) {
          errors.push(`Payout ${payout.id}: ${insertError.message}`);
          continue;
        }

        // ─── Insert settlement lines for drill-down ──────────────
        if (transactions.length > 0) {
          const lineRows = transactions.map((tx) => ({
            user_id: userId,
            settlement_id: String(payout.id),
            order_id: tx.source_order_id ? String(tx.source_order_id) : null,
            sku: null,
            amount: parseFloat(tx.net) || 0,
            amount_type: tx.type === "refund" ? "refund" : tx.type === "charge" ? "order" : "adjustment",
            amount_description: `${tx.type}${tx.source_order_id ? ` — Order #${tx.source_order_id}` : ""}`,
            transaction_type: tx.type || "charge",
            posted_date: tx.processed_at ? tx.processed_at.substring(0, 10) : payoutDate,
            marketplace_name: "Shopify Payments",
            accounting_category: tx.type === "refund" ? "refunds" : tx.type === "charge" ? "sales" : "fees",
          }));

          for (let i = 0; i < lineRows.length; i += 500) {
            await supabase.from("settlement_lines").insert(lineRows.slice(i, i + 500) as any);
          }
        }

        // ─── Upsert marketplace_validation ───────────────────────
        const periodMonth = payoutDate.substring(0, 7); // YYYY-MM
        const monthStart = `${periodMonth}-01`;
        const monthEnd = new Date(
          parseInt(periodMonth.split("-")[0]),
          parseInt(periodMonth.split("-")[1]),
          0
        )
          .toISOString()
          .split("T")[0];
        const periodLabel = new Date(payoutDate + "T00:00:00").toLocaleDateString("en-AU", {
          month: "short",
          year: "numeric",
        });

        const { data: existingVal } = await supabase
          .from("marketplace_validation")
          .select("id, settlement_net")
          .eq("user_id", userId)
          .eq("marketplace_code", "shopify_payments")
          .eq("period_start", monthStart)
          .maybeSingle();

        if (existingVal) {
          await supabase
            .from("marketplace_validation")
            .update({
              settlement_uploaded: true,
              settlement_uploaded_at: new Date().toISOString(),
              settlement_id: String(payout.id),
              settlement_net: (existingVal.settlement_net || 0) + netPayout,
              overall_status: isBeforeBoundary ? "already_recorded" : "ready_to_push",
            })
            .eq("id", existingVal.id);
        } else {
          await supabase.from("marketplace_validation").insert({
            user_id: userId,
            marketplace_code: "shopify_payments",
            period_label: periodLabel,
            period_start: monthStart,
            period_end: monthEnd,
            settlement_uploaded: true,
            settlement_uploaded_at: new Date().toISOString(),
            settlement_id: String(payout.id),
            settlement_net: netPayout,
            overall_status: "ready_to_push",
          } as any);
        }

        // ─── Log system event ────────────────────────────────────
        await supabase.from("system_events").insert({
          user_id: userId,
          event_type: "shopify_payout_synced",
          marketplace_code: "shopify_payments",
          period_label: periodLabel,
          settlement_id: String(payout.id),
          severity: "info",
          details: { net: netPayout, source: "api", transactions_count: transactions.length },
        } as any);

        synced++;
      } catch (err) {
        errors.push(`Payout ${payout.id}: ${String(err)}`);
      }
    }

    // ─── Update cooldown timestamp ────────────────────────────────────
    await upsertSetting(supabase, userId, "shopify_payout_last_sync", new Date().toISOString());

    return new Response(
      JSON.stringify({
        success: true,
        synced,
        skipped: existingIds.size,
        errors: errors.length > 0 ? errors : undefined,
        total_payouts: allPayouts.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function upsertSetting(supabase: any, userId: string, key: string, value: string) {
  const { data: existing } = await supabase
    .from("app_settings")
    .select("id")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();

  if (existing) {
    await supabase.from("app_settings").update({ value }).eq("id", existing.id);
  } else {
    await supabase.from("app_settings").insert({ user_id: userId, key, value } as any);
  }
}
