import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logger } from '../_shared/logger.ts';
import {
  SHOPIFY_API_VERSION,
  getShopifyHeaders,
  buildShopifyUrl,
} from '../_shared/shopify-api-policy.ts';

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

// ─── Core sync logic for a single user ──────────────────────────────
async function syncPayoutsForUser(
  supabase: any,
  userId: string,
  accessToken: string,
  shopDomain: string,
  skipCooldown: boolean,
  syncFromParam?: string,
): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];

  // ─── Check cooldown atomically via RPC (1 hour minimum between syncs) ──
  if (!skipCooldown) {
    const { data: cooldownResult } = await supabase.rpc('check_sync_cooldown', {
      p_user_id: userId,
      p_key: 'shopify_payout_last_sync',
      p_window_seconds: 3600,
    });
    if (cooldownResult && !cooldownResult.ok) {
      return { synced: 0, skipped: 0, errors: ["Cooldown active"] };
    }
  }

  // ─── Boundary: accounting_boundary_date gates BOTH fetch window AND push status.
  //     For API-fetched payouts, we only fetch from the boundary date forward
  //     to avoid downloading hundreds of historical payouts already in Xero. ──
  let dateMin: string | null = null;
  const { data: boundarySetting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "accounting_boundary_date")
    .eq("user_id", userId)
    .maybeSingle();
  if (boundarySetting?.value) {
    dateMin = boundarySetting.value;
  }

  // ─── Fetch payouts from Shopify (paid + scheduled + in_transit) ─────
  const allPayouts: ShopifyPayout[] = [];

  const statusesToFetch = ['paid', 'scheduled', 'in_transit'];

  for (const payoutStatus of statusesToFetch) {
    let nextPageUrl: string | undefined;
    let page = 0;
    const MAX_PAGES = 10;

    const buildInitialUrl = () => {
      const params = new URLSearchParams({ status: payoutStatus });
      if (syncFromParam) {
        params.set("date_min", syncFromParam);
        console.log(`[fetch-shopify-payouts] Using sync_from filter: date_min=${syncFromParam} status=${payoutStatus}`);
      } else if (dateMin) {
        params.set("date_min", dateMin);
        console.log(`[fetch-shopify-payouts] Using boundary date filter: date_min=${dateMin} status=${payoutStatus}`);
      }
      return buildShopifyUrl(shopDomain, 'shopify_payments/payouts', params);
    };

    let url: string = buildInitialUrl();

    do {
      const res = await fetch(url, {
        headers: getShopifyHeaders(accessToken),
      });

      if (res.status === 401) {
        return { synced: 0, skipped: 0, errors: ["Shopify token invalid or expired"] };
      }
      if (res.status === 429) {
        return { synced: 0, skipped: 0, errors: ["Shopify rate limit exceeded"] };
      }
      if (!res.ok) {
        const body = await res.text();
        errors.push(`Shopify API error ${res.status} for status=${payoutStatus}: ${body}`);
        break;
      }

      const data = await res.json();
      allPayouts.push(...(data.payouts || []));

      nextPageUrl = undefined;
      const linkHeader = res.headers.get("Link");
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) nextPageUrl = nextMatch[1];
      }

      if (nextPageUrl) url = nextPageUrl;
      page++;
    } while (nextPageUrl && page < MAX_PAGES);

    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // ─── Dedup: filter out already-imported payouts ────────────────────
  // Check by exact settlement_id match (numeric payout ID)
  const payoutIds = allPayouts.map((p) => String(p.id));
  const { data: existingSettlements } = await supabase
    .from("settlements")
    .select("settlement_id, bank_deposit, period_end, payout_status")
    .eq("user_id", userId)
    .eq("marketplace", "shopify_payments")
    .in("settlement_id", payoutIds);

  const existingMap = new Map((existingSettlements || []).map((e: any) => [e.settlement_id, e]));
  const existingIds = new Set(existingMap.keys());

  // ─── Auto-promote: detect scheduled/in_transit → paid transitions ──
  for (const payout of allPayouts) {
    const numericId = String(payout.id);
    const existing = existingMap.get(numericId);
    if (!existing) continue;
    const oldStatus = existing.payout_status || 'paid';
    const newStatus = payout.status;
    if ((oldStatus === 'scheduled' || oldStatus === 'in_transit') && newStatus === 'paid') {
      console.log(`[fetch-shopify-payouts] Auto-promoting payout ${numericId}: ${oldStatus} → paid`);
      const isBeforeBoundary = dateMin && payout.date < dateMin;
      await supabase.from("settlements").update({
        payout_status: 'paid',
        status: isBeforeBoundary ? 'ingested' : 'ready_to_push',
      } as any).eq("settlement_id", numericId).eq("user_id", userId).eq("marketplace", "shopify_payments");
      // Log promotion event
      await supabase.from("system_events").insert({
        user_id: userId,
        event_type: "shopify_payout_arrived",
        marketplace_code: "shopify_payments",
        settlement_id: numericId,
        severity: "info",
        details: { old_status: oldStatus, new_status: 'paid', amount: parseFloat(payout.amount) || 0 },
      } as any);
    } else if (oldStatus !== newStatus && (newStatus === 'failed' || newStatus === 'cancelled')) {
      // Handle failed/cancelled transitions
      await supabase.from("settlements").update({
        payout_status: newStatus,
      } as any).eq("settlement_id", numericId).eq("user_id", userId).eq("marketplace", "shopify_payments");
    }
  }

  // Also check alias registry for cross-format matches (bank_ref → numeric ID)
  const { data: aliasMatches } = await supabase
    .from("settlement_id_aliases")
    .select("alias_id, canonical_settlement_id")
    .eq("user_id", userId)
    .in("alias_id", payoutIds);

  const aliasedIds = new Set((aliasMatches || []).map((a: any) => a.alias_id));

  // Build fingerprint list from ALL existing shopify settlements for ±$0.05 tolerance
  const { data: allExistingShopify } = await supabase
    .from("settlements")
    .select("settlement_id, bank_deposit, period_end")
    .eq("user_id", userId)
    .eq("marketplace", "shopify_payments");

  const existingShopifyList = (allExistingShopify || []).map((e: any) => ({
    settlement_id: e.settlement_id,
    bank_deposit: parseFloat(e.bank_deposit) || 0,
    period_end: e.period_end,
  }));

  const newPayouts = allPayouts.filter((p) => {
    const numericId = String(p.id);
    if (existingIds.has(numericId)) return false;
    if (aliasedIds.has(numericId)) return false;

    // P0: Check if a CSV-uploaded version exists with bank_reference as settlement_id
    // Instead of rewriting settlement_id (race-prone), keep CSV record stable and register aliases
    const bankRef = (p as any).bank_reference;
    if (bankRef) {
      const csvByBankRef = existingShopifyList.find((e: any) => e.settlement_id === bankRef);
      if (csvByBankRef) {
        // Keep CSV settlement_id stable; store numeric payout ID in source_reference only
        console.log(`[fetch-shopify-payouts] Linking CSV settlement ${bankRef} ↔ API payout ${numericId} (no rewrite)`);
        supabase.from("settlements")
          .update({ source_reference: numericId } as any)
          .eq("settlement_id", bankRef)
          .eq("user_id", userId)
          .eq("marketplace", "shopify_payments")
          .then(({ error }: any) => {
            if (error) console.error(`[fetch-shopify-payouts] source_reference update error:`, error);
          });
        // Register bidirectional aliases so both IDs resolve
        supabase.from("settlement_id_aliases")
          .upsert([
            { canonical_settlement_id: bankRef, alias_id: numericId, user_id: userId, source: "api_link" },
            { canonical_settlement_id: bankRef, alias_id: bankRef, user_id: userId, source: "csv_original" },
          ] as any, { onConflict: "alias_id,user_id" })
          .then(({ error }: any) => {
            if (error) console.error(`[fetch-shopify-payouts] Alias error:`, error);
          });
        return false; // skip insert — existing CSV record preserved
      }
    }

    // P3: Fingerprint match with ±$0.05 tolerance (handles CSV rounding vs API precision)
    const payoutAmount = parseFloat(p.amount) || 0;
    const payoutDate = p.date;
    const fingerprintMatch = existingShopifyList.find(
      (e) => e.period_end === payoutDate && Math.abs(e.bank_deposit - payoutAmount) <= 0.05
    );
    if (fingerprintMatch) {
      console.log(`[fetch-shopify-payouts] Skipping payout ${p.id}: fingerprint match with ${fingerprintMatch.settlement_id} (±$0.05 tolerance)`);
      // Register alias for future lookups
      supabase.from("settlement_id_aliases")
        .upsert({ canonical_settlement_id: fingerprintMatch.settlement_id, alias_id: numericId, user_id: userId, source: "fingerprint_match" } as any, { onConflict: "alias_id,user_id" })
        .then(({ error }) => {
          if (error) console.error(`[fetch-shopify-payouts] Alias error:`, error);
        });
      return false;
    }

    return true;
  });

  if (newPayouts.length === 0) {
    await upsertSetting(supabase, userId, "shopify_payout_last_sync", new Date().toISOString());
    return { synced: 0, skipped: allPayouts.length, errors: [] };
  }

  // ─── Fetch transactions for each new payout ───────────────────────
  let synced = 0;

  for (const payout of newPayouts) {
    try {
      await sleep(RATE_LIMIT_DELAY_MS);

      const txUrl = buildShopifyUrl(shopDomain, 'shopify_payments/balance/transactions', new URLSearchParams({ payout_id: String(payout.id), limit: '250' }));
      const txRes = await fetch(txUrl, {
        headers: getShopifyHeaders(accessToken),
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
          case "payout":
            // Payout is the bank transfer itself — NOT an accounting line item.
            // Its amount equals bank_deposit; including it would double-count.
            break;
          case "adjustment":
          case "reserve":
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

      const gstOnIncome = grossSales / 11;
      const salesExGst = grossSales - gstOnIncome;
      const gstOnExpenses = Math.abs(totalFees) / 11;
      const feesExGst = Math.abs(totalFees) - gstOnExpenses;
      const netExGst = netPayout - gstOnIncome + gstOnExpenses;

      // Shopify payouts arrive fully reconciled — promote immediately unless pre-boundary
      const isBeforeBoundary = dateMin && payoutDate < dateMin;
      const settlementStatus = isBeforeBoundary ? "ingested" : "ready_to_push";

      // ─── Insert settlement (ON CONFLICT DO NOTHING) ─────────
      // SIGN CONVENTION: fees/expenses stored NEGATIVE per canonical posting rules
      const { error: insertError } = await supabase.from("settlements").upsert({
        user_id: userId,
        settlement_id: String(payout.id),
        marketplace: "shopify_payments",
        source: "api",
        source_reference: (payout as any).bank_reference || null,
        status: settlementStatus,
        is_pre_boundary: !!isBeforeBoundary,
        period_start: payoutDate,
        period_end: payoutDate,
        deposit_date: payoutDate,
        sales_principal: salesExGst,
        sales_shipping: 0,
        seller_fees: -feesExGst,           // NEGATIVE: expense reduces invoice total
        fba_fees: 0,
        storage_fees: 0,
        refunds: -totalRefunds,
        reimbursements: 0,
        promotional_discounts: 0,
        other_fees: totalAdjustments !== 0 ? totalAdjustments : 0,  // adjustments keep natural sign
        gst_on_income: gstOnIncome,
        gst_on_expenses: -gstOnExpenses,   // NEGATIVE: input tax credit
        net_ex_gst: netExGst,
        bank_deposit: netPayout,
        raw_payload: { payout, transactions },
      } as any, { onConflict: "marketplace,settlement_id,user_id", ignoreDuplicates: true });

      // Register aliases after successful insert
      if (!insertError) {
        const bankRef = (payout as any).bank_reference;
        const aliasRows: any[] = [
          { canonical_settlement_id: String(payout.id), alias_id: String(payout.id), user_id: userId, source: "api" },
        ];
        if (bankRef && bankRef !== String(payout.id)) {
          aliasRows.push({ canonical_settlement_id: String(payout.id), alias_id: bankRef, user_id: userId, source: "api" });
        }
        await supabase.from("settlement_id_aliases").upsert(aliasRows, { onConflict: "alias_id,user_id" });
      }

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
          accounting_category: tx.type === "refund" ? "refund" : tx.type === "charge" ? "revenue" : "marketplace_fee",
        }));

        for (let i = 0; i < lineRows.length; i += 500) {
          await supabase.from("settlement_lines").insert(lineRows.slice(i, i + 500) as any);
        }
      }

      // ─── Upsert marketplace_validation ───────────────────────
      const periodMonth = payoutDate.substring(0, 7);
      const monthStart = `${periodMonth}-01`;
      const monthEnd = new Date(
        parseInt(periodMonth.split("-")[0]),
        parseInt(periodMonth.split("-")[1]),
        0
      ).toISOString().split("T")[0];
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

      // Derive settlement_net from settlements table (never accumulate additively)
      const { data: monthSettlements } = await supabase
        .from("settlements")
        .select("bank_deposit")
        .eq("user_id", userId)
        .eq("marketplace", "shopify_payments")
        .gte("period_end", monthStart)
        .lte("period_end", monthEnd);
      const derivedSettlementNet = Math.round(((monthSettlements || []).reduce((sum: number, s: any) => sum + (s.bank_deposit || 0), 0)) * 100) / 100;

      if (existingVal) {
        await supabase
          .from("marketplace_validation")
          .update({
            settlement_uploaded: true,
            settlement_uploaded_at: new Date().toISOString(),
            settlement_id: String(payout.id),
            settlement_net: derivedSettlementNet,
            overall_status: isBeforeBoundary ? "already_recorded" : "saved",
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
          settlement_net: derivedSettlementNet,
          overall_status: isBeforeBoundary ? "already_recorded" : "saved",
        } as any);
      }

      // ─── Auto-link with pre-seeded Xero matches ────────────
      // If sync-xero-status already discovered this settlement in Xero,
      // immediately link the settlement to its Xero invoice
      const payoutSettlementId = String(payout.id);
      const { data: preSeeded } = await supabase
        .from("xero_accounting_matches")
        .select("xero_invoice_id, xero_invoice_number, xero_status, matched_reference")
        .eq("user_id", userId)
        .eq("settlement_id", payoutSettlementId)
        .maybeSingle();

      if (preSeeded?.xero_invoice_id) {
        // Map Xero status to canonical settlement states
        let derivedStatus = 'pushed_to_xero';
        if (preSeeded.xero_status === 'PAID') derivedStatus = 'reconciled_in_xero';
        const isXettleFormat = (preSeeded.matched_reference || '').startsWith('Xettle-');
        if (!isXettleFormat) derivedStatus = 'pushed_to_xero';

        await supabase.from("settlements").update({
          xero_journal_id: preSeeded.xero_invoice_id,
          xero_invoice_number: preSeeded.xero_invoice_number,
          xero_status: preSeeded.xero_status,
          status: derivedStatus,
          sync_origin: isXettleFormat ? 'xettle' : 'external',
        }).eq("settlement_id", payoutSettlementId).eq("user_id", userId);
        console.log(`[fetch-shopify-payouts] Auto-linked payout ${payoutSettlementId} to Xero invoice ${preSeeded.xero_invoice_number}`);
      }

      // ─── Log system event ────────────────────────────────────
      await supabase.from("system_events").insert({
        user_id: userId,
        event_type: "shopify_payout_synced",
        marketplace_code: "shopify_payments",
        period_label: periodLabel,
        settlement_id: payoutSettlementId,
        severity: "info",
        details: { net: netPayout, source: "api", transactions_count: transactions.length, auto_linked_xero: !!preSeeded?.xero_invoice_id },
      } as any);

      synced++;
    } catch (err) {
      errors.push(`Payout ${payout.id}: ${String(err)}`);
    }
  }

  // ─── Update cooldown timestamp ────────────────────────────────────
  await upsertSetting(supabase, userId, "shopify_payout_last_sync", new Date().toISOString());

  return { synced, skipped: existingIds.size, errors };
}

Deno.serve(async (req) => {
  console.info(`[fetch-shopify-payouts] ${req.method} received`);
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const action = req.headers.get("x-action");
    console.info(`[fetch-shopify-payouts] action=${action}`);


    // ─── Multi-user sync mode (for cron / scheduled-sync) ───────────
    if (action === "sync") {
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceRoleKey) {
        return new Response(JSON.stringify({ error: "Missing service role key" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey
      );

      // Get all active Shopify tokens
      const { data: allTokens, error: tokensError } = await adminClient
        .from("shopify_tokens")
        .select("user_id, access_token, shop_domain")
        .eq("is_active", true);

      if (tokensError || !allTokens || allTokens.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "No Shopify tokens found", users_processed: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results: Array<{ user_id: string; synced: number; skipped: number; errors: string[] }> = [];

      // Parse optional sync_from from request body
      let syncFromParam: string | undefined;
      try {
        const body = await req.json();
        syncFromParam = body?.sync_from;
      } catch { /* no body */ }

      for (const token of allTokens) {
        try {
          const result = await syncPayoutsForUser(
            adminClient,
            token.user_id,
            token.access_token,
            token.shop_domain,
            true, // skip cooldown for cron
            syncFromParam,
          );
          results.push({ user_id: token.user_id, ...result });
        } catch (err) {
          results.push({ user_id: token.user_id, synced: 0, skipped: 0, errors: [String(err)] });
        }
      }

      const totalSynced = results.reduce((s, r) => s + r.synced, 0);

      return new Response(
        JSON.stringify({
          success: true,
          users_processed: results.length,
          total_synced: totalSynced,
          results,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Single-user mode (original behavior) ───────────────────────
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

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.info(`[fetch-shopify-payouts] Auth: user=${user?.id}, error=${authError?.message}`);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // ─── Acquire Shopify sync mutex (manual path) ─────────────────────
    const adminForLock = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: lockResult } = await adminForLock.rpc('acquire_sync_lock', {
      p_user_id: userId,
      p_integration: 'shopify',
      p_lock_key: 'payout_sync',
      p_ttl_seconds: 600, // 10 min
    });

    if (!lockResult?.acquired) {
      return new Response(
        JSON.stringify({ error: "Sync already in progress", message: "A Shopify payout sync is already running. Please wait." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Get Shopify token ────────────────────────────────────────────
    const { data: tokenRow, error: tokenError } = await supabase
      .from("shopify_tokens")
      .select("access_token, shop_domain")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (tokenError || !tokenRow) {
      await adminForLock.rpc('release_sync_lock', { p_user_id: userId, p_integration: 'shopify', p_lock_key: 'payout_sync' });
      console.warn(`[fetch-shopify-payouts] No Shopify token found: ${tokenError?.message}`);
      return new Response(
        JSON.stringify({ error: "No Shopify connection found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result;
    // Parse optional lookback_days from request body
    let parsedLookbackDays: number | undefined;
    let syncFromOverride: string | undefined;
    try {
      const body = await req.json();
      if (body?.lookback_days && typeof body.lookback_days === 'number') {
        parsedLookbackDays = body.lookback_days;
        const lookbackDate = new Date(Date.now() - parsedLookbackDays * 24 * 60 * 60 * 1000);
        syncFromOverride = lookbackDate.toISOString().split('T')[0];
        console.log(`[fetch-shopify-payouts] lookback_days=${parsedLookbackDays} → sync_from=${syncFromOverride}`);
      }
    } catch { /* no body */ }

    try {
      result = await syncPayoutsForUser(
        supabase,
        userId,
        tokenRow.access_token,
        tokenRow.shop_domain,
        false, // enforce cooldown for manual syncs
        syncFromOverride,
      );
    } finally {
      // Always release lock
      await adminForLock.rpc('release_sync_lock', { p_user_id: userId, p_integration: 'shopify', p_lock_key: 'payout_sync' });
    }

    if (result.errors.length === 1 && result.errors[0] === "Cooldown active") {
      return new Response(
        JSON.stringify({
          error: "Sync cooldown active",
          message: "Please wait at least 1 hour between syncs.",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: result.synced,
        skipped: result.skipped,
        errors: result.errors.length > 0 ? result.errors : undefined,
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
