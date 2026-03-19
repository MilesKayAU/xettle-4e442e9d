/**
 * backfill-fulfilment-channel — Infer fulfilment_channel for legacy Amazon
 * settlement_lines using fee-pattern analysis.
 *
 * Logic:
 * - If any row for an order_id has amount_description containing
 *   FBAPerUnitFulfillmentFee, FBAWeightBasedFee, or FBAPerOrderFulfillmentFee
 *   → all rows for that order_id = 'AFN_inferred'
 * - Otherwise → 'MFN_inferred'
 * - Refund-only orders (no fee lines) default to 'AFN_inferred' (conservative)
 *
 * Requires authenticated user. Only processes that user's rows.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const FBA_FEE_PATTERNS = [
  "FBAPerUnitFulfillmentFee",
  "FBAWeightBasedFee",
  "FBAPerOrderFulfillmentFee",
];

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // Parse optional force_reclassify parameter
    let forceReclassify = false;
    try {
      const body = await req.json();
      forceReclassify = body?.force_reclassify === true;
    } catch {
      // No body or invalid JSON — use defaults
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Get all distinct order_ids for Amazon lines needing classification
    // If force_reclassify is true, also re-evaluate *_inferred values (but never parser-confirmed AFN/MFN)
    let query = admin
      .from("settlement_lines")
      .select("order_id, amount_description, transaction_type, fulfilment_channel")
      .eq("user_id", userId)
      .ilike("marketplace_name", "%amazon%");

    if (forceReclassify) {
      // Include null + *_inferred rows, skip parser-confirmed (AFN, MFN without suffix)
      query = query.or("fulfilment_channel.is.null,fulfilment_channel.eq.AFN_inferred,fulfilment_channel.eq.MFN_inferred");
    } else {
      query = query.is("fulfilment_channel", null);
    }

    const { data: nullLines, error: queryErr } = await query;

    if (queryErr) throw queryErr;
    if (!nullLines || nullLines.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          orders_processed: 0,
          classified_fba: 0,
          classified_fbm: 0,
          message: "No Amazon lines need classification",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build order_id → has FBA fee flag + track transaction types
    const orderHasFba = new Map<string, boolean>();
    const orderHasAnyLine = new Set<string>();
    const orderIsRefundOnly = new Map<string, boolean>();

    for (const line of nullLines) {
      const orderId = line.order_id;
      if (!orderId) continue;
      orderHasAnyLine.add(orderId);
      if (!orderHasFba.has(orderId)) orderHasFba.set(orderId, false);
      // Track if order has any non-refund lines
      if (!orderIsRefundOnly.has(orderId)) orderIsRefundOnly.set(orderId, true);
      if (line.transaction_type !== "Refund") {
        orderIsRefundOnly.set(orderId, false);
      }
      if (
        line.amount_description &&
        FBA_FEE_PATTERNS.some((p) => line.amount_description === p)
      ) {
        orderHasFba.set(orderId, true);
      }
    }

    // Also handle lines with null order_id (non-order lines like storage fees)
    // These get classified as AFN_inferred by default
    const nullOrderLineCount = nullLines.filter((l) => !l.order_id).length;

    // Step 2: Batch update by order_id
    let classifiedFba = 0;
    let classifiedFbm = 0;
    const orderIds = [...orderHasAnyLine];

    // Process in batches of 200 order_ids
    for (let i = 0; i < orderIds.length; i += 200) {
      const batch = orderIds.slice(i, i + 200);

      const fbaOrderIds = batch.filter((id) => orderHasFba.get(id) === true);
      // Orders without FBA fees but ALL lines are refunds → AFN_inferred (conservative)
      const refundOnlyOrderIds = batch.filter(
        (id) => orderHasFba.get(id) === false && orderIsRefundOnly.get(id) === true
      );
      const fbmOrderIds = batch.filter(
        (id) => orderHasFba.get(id) === false && orderIsRefundOnly.get(id) !== true
      );

      // AFN_inferred: orders with FBA fee lines
      if (fbaOrderIds.length > 0) {
        const { error: fbaErr } = await admin
          .from("settlement_lines")
          .update({ fulfilment_channel: "AFN_inferred" })
          .eq("user_id", userId)
          .is("fulfilment_channel", null)
          .ilike("marketplace_name", "%amazon%")
          .in("order_id", fbaOrderIds);

        if (fbaErr) console.error("FBA batch error:", fbaErr);
        classifiedFba += fbaOrderIds.length;
      }

      // AFN_inferred: refund-only orders (conservative default — original order was likely FBA)
      if (refundOnlyOrderIds.length > 0) {
        const { error: refundErr } = await admin
          .from("settlement_lines")
          .update({ fulfilment_channel: "AFN_inferred" })
          .eq("user_id", userId)
          .is("fulfilment_channel", null)
          .ilike("marketplace_name", "%amazon%")
          .in("order_id", refundOnlyOrderIds);

        if (refundErr) console.error("Refund-only batch error:", refundErr);
        classifiedFba += refundOnlyOrderIds.length;
      }

      // MFN_inferred: orders without FBA fees and with non-refund lines
      if (fbmOrderIds.length > 0) {
        const { error: fbmErr } = await admin
          .from("settlement_lines")
          .update({ fulfilment_channel: "MFN_inferred" })
          .eq("user_id", userId)
          .is("fulfilment_channel", null)
          .ilike("marketplace_name", "%amazon%")
          .in("order_id", fbmOrderIds);

        if (fbmErr) console.error("FBM batch error:", fbmErr);
        classifiedFbm += fbmOrderIds.length;
      }
    }

    // Handle null order_id lines (storage fees, subscription fees, etc.) → AFN_inferred
    if (nullOrderLineCount > 0) {
      await admin
        .from("settlement_lines")
        .update({ fulfilment_channel: "AFN_inferred" })
        .eq("user_id", userId)
        .is("fulfilment_channel", null)
        .is("order_id", null)
        .ilike("marketplace_name", "%amazon%");
    }

    return new Response(
      JSON.stringify({
        success: true,
        orders_processed: orderIds.length,
        classified_fba: classifiedFba,
        classified_fbm: classifiedFbm,
        null_order_lines_classified: nullOrderLineCount,
        message: `Classified ${classifiedFba} FBA orders, ${classifiedFbm} FBM orders`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("backfill-fulfilment-channel error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
