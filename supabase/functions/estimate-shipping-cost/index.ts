import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { SHOPIFY_API_VERSION, getShopifyHeaders } from '../_shared/shopify-api-policy.ts';

const PAC_BASE = "https://digitalapi.auspost.com.au/postage/parcel/domestic";

interface ShippingSettings {
  enabled: boolean;
  from_postcode: string;
  default_weight_grams: number;
  default_length: number;
  default_width: number;
  default_height: number;
  default_service: string;
  service_overrides: Record<string, string>;
}

// ─── Marketplace detection (server-side, from marketplace_registry) ──────────

interface RegistryEntry {
  marketplace_code: string;
  marketplace_name: string;
  detection_keywords: string[];
  shopify_source_names: string[];
}

function detectMarketplaceServerSide(
  tags: string | null,
  sourceName: string | null,
  registry: RegistryEntry[]
): string | null {
  // Check tags first
  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    for (const tag of tagList) {
      for (const entry of registry) {
        for (const kw of entry.detection_keywords) {
          if (tag.includes(kw.toLowerCase())) {
            return entry.marketplace_code;
          }
        }
      }
    }
  }

  // Check source_name
  if (sourceName) {
    const srcLower = sourceName.toLowerCase().trim();
    for (const entry of registry) {
      for (const sn of entry.shopify_source_names) {
        if (srcLower === sn.toLowerCase()) {
          return entry.marketplace_code;
        }
      }
    }
    if (srcLower === "web") return "shopify_web";
    if (srcLower === "pos") return "shopify_pos";
  }

  return null;
}

// ─── PAC API helpers ─────────────────────────────────────────────────────────

async function pacGetServices(
  apiKey: string,
  fromPostcode: string,
  toPostcode: string,
  weightKg: number,
  length: number,
  width: number,
  height: number
): Promise<any[]> {
  const params = new URLSearchParams({
    from_postcode: fromPostcode,
    to_postcode: toPostcode,
    length: String(length),
    width: String(width),
    height: String(height),
    weight: String(weightKg),
  });
  const url = `${PAC_BASE}/service.json?${params}`;
  const res = await fetch(url, {
    headers: { "AUTH-KEY": apiKey },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.services?.service || [];
}

async function pacCalculate(
  apiKey: string,
  fromPostcode: string,
  toPostcode: string,
  weightKg: number,
  length: number,
  width: number,
  height: number,
  serviceCode: string
): Promise<number | null> {
  const params = new URLSearchParams({
    from_postcode: fromPostcode,
    to_postcode: toPostcode,
    length: String(length),
    width: String(width),
    height: String(height),
    weight: String(weightKg),
    service_code: serviceCode,
  });
  const url = `${PAC_BASE}/calculate.json?${params}`;
  const res = await fetch(url, {
    headers: { "AUTH-KEY": apiKey },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.postage_result?.total_cost
    ? parseFloat(data.postage_result.total_cost)
    : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main handler ────────────────────────────────────────────────────────────

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* empty body OK */
    }
    const requestedBatchSize = Math.min(Math.max(body.batch_size || 20, 1), 50);

    // ─── Guard: check shipping:enabled ──────────────────────────────
    const { data: settingsRows } = await supabase
      .from("app_settings")
      .select("key, value")
      .eq("user_id", user.id)
      .like("key", "shipping:%");

    const settingsMap: Record<string, string> = {};
    for (const row of settingsRows || []) {
      settingsMap[row.key] = row.value || "";
    }

    if (settingsMap["shipping:enabled"] !== "true") {
      return new Response(
        JSON.stringify({ error: "Shipping estimates disabled", estimated: 0 }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const settings: ShippingSettings = {
      enabled: true,
      from_postcode: settingsMap["shipping:from_postcode"] || "",
      default_weight_grams: parseFloat(settingsMap["shipping:default_weight_grams"] || "500"),
      default_length: parseFloat(settingsMap["shipping:default_length"] || "30"),
      default_width: parseFloat(settingsMap["shipping:default_width"] || "20"),
      default_height: parseFloat(settingsMap["shipping:default_height"] || "15"),
      default_service: settingsMap["shipping:default_service"] || "AUS_PARCEL_REGULAR",
      service_overrides: {},
    };

    // Load per-marketplace service overrides
    for (const [key, value] of Object.entries(settingsMap)) {
      const match = key.match(/^shipping:service_override:(.+)$/);
      if (match && value) {
        settings.service_overrides[match[1]] = value;
      }
    }

    if (!settings.from_postcode) {
      return new Response(
        JSON.stringify({ error: "from_postcode not configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const pacApiKey = Deno.env.get("AUSPOST_PAC_API_KEY");
    if (!pacApiKey) {
      return new Response(
        JSON.stringify({ error: "AUSPOST_PAC_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ─── Load marketplace_registry for detection ────────────────────
    const { data: registryRows } = await supabase
      .from("marketplace_registry")
      .select("marketplace_code, marketplace_name, detection_keywords, shopify_source_names")
      .eq("is_active", true);

    const registry: RegistryEntry[] = (registryRows || []).map((r: any) => ({
      marketplace_code: r.marketplace_code,
      marketplace_name: r.marketplace_name,
      detection_keywords: (r.detection_keywords as string[]) || [],
      shopify_source_names: (r.shopify_source_names as string[]) || [],
    }));

    // ─── Get Shopify token ──────────────────────────────────────────
    const { data: tokenRow } = await supabase
      .from("shopify_tokens")
      .select("access_token, shop_domain")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!tokenRow?.access_token || !tokenRow?.shop_domain) {
      return new Response(
        JSON.stringify({ error: "No active Shopify connection" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ─── Find eligible orders (not yet estimated) ───────────────────
    // Query shopify_orders for fulfilled, non-cancelled, non-voided orders
    // LEFT JOIN to exclude already-estimated fulfillments
    const { data: eligibleOrders, error: ordersError } = await supabase
      .from("shopify_orders")
      .select("shopify_order_id, order_name, tags, source_name, total_price, financial_status, created_at_shopify")
      .eq("user_id", user.id)
      .neq("financial_status", "voided")
      .order("created_at_shopify", { ascending: true })
      .limit(requestedBatchSize * 2); // fetch extra since we'll filter

    if (ordersError) {
      return new Response(
        JSON.stringify({ error: "Failed to query orders", detail: ordersError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!eligibleOrders || eligibleOrders.length === 0) {
      return new Response(
        JSON.stringify({ estimated: 0, skipped: 0, errors: 0, skipped_no_service: 0, message: "No eligible orders" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get already-estimated fulfillment IDs to skip
    const orderIds = eligibleOrders.map((o: any) => o.shopify_order_id);
    const { data: existingEstimates } = await supabase
      .from("order_shipping_estimates")
      .select("shopify_order_id, shopify_fulfillment_id")
      .eq("user_id", user.id)
      .in("shopify_order_id", orderIds);

    const estimatedFulfillmentIds = new Set(
      (existingEstimates || []).map((e: any) => e.shopify_fulfillment_id)
    );

    // ─── Fetch fulfillments from Shopify API ────────────────────────
    let estimated = 0;
    let skipped = 0;
    let errors = 0;
    let skippedNoService = 0;
    const affectedMarketplaces = new Set<string>();

    for (const order of eligibleOrders) {
      if (estimated >= requestedBatchSize) break;

      // Fetch fulfillments for this order from Shopify
      const fulfillmentsUrl = `https://${tokenRow.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.shopify_order_id}/fulfillments.json`;
      let fulfillments: any[] = [];
      try {
        const fRes = await fetch(fulfillmentsUrl, {
          headers: getShopifyHeaders(tokenRow.access_token),
        });
        if (fRes.ok) {
          const fData = await fRes.json();
          fulfillments = fData?.fulfillments || [];
        }
      } catch {
        errors++;
        continue;
      }

      if (fulfillments.length === 0) {
        skipped++;
        continue;
      }

      for (const fulfillment of fulfillments) {
        if (estimated >= requestedBatchSize) break;

        // Skip non-successful fulfillments (cancelled, error, failure)
        if (fulfillment.status && fulfillment.status !== "success") {
          skipped++;
          continue;
        }

        const fulfillmentId = String(fulfillment.id);
        if (estimatedFulfillmentIds.has(fulfillmentId)) {
          skipped++;
          continue;
        }

        // Extract shipping postcode
        const destPostcode =
          fulfillment.destination?.zip ||
          fulfillment.destination?.postal_code ||
          "";
        if (!destPostcode || !/^\d{4}$/.test(destPostcode.trim())) {
          skipped++;
          continue;
        }

        // Detect marketplace
        const marketplaceCode = detectMarketplaceServerSide(
          order.tags,
          order.source_name,
          registry
        );

        // Determine weight — check line items for grams
        let totalWeightGrams = 0;
        let usedDefaultWeight = true;
        if (fulfillment.line_items && Array.isArray(fulfillment.line_items)) {
          for (const item of fulfillment.line_items) {
            if (item.grams && item.grams > 0) {
              totalWeightGrams += item.grams * (item.quantity || 1);
              usedDefaultWeight = false;
            }
          }
        }
        if (totalWeightGrams <= 0) {
          totalWeightGrams = settings.default_weight_grams;
          usedDefaultWeight = true;
        }

        // Dimensions — always use defaults (Shopify doesn't store package dims)
        const usedDefaultDimensions = true;
        const length = settings.default_length;
        const width = settings.default_width;
        const height = settings.default_height;

        // Determine estimate quality
        let estimateQuality: string;
        if (!usedDefaultWeight && !usedDefaultDimensions) {
          estimateQuality = "high";
        } else if (!usedDefaultWeight && usedDefaultDimensions) {
          estimateQuality = "medium";
        } else {
          estimateQuality = "low";
        }

        // Convert grams to kg for PAC API
        const weightKg = Math.max(totalWeightGrams / 1000, 0.1);

        // Determine preferred service
        const preferredService =
          (marketplaceCode && settings.service_overrides[marketplaceCode]) ||
          settings.default_service;

        // Step 1: Get available services
        const availableServices = await pacGetServices(
          pacApiKey,
          settings.from_postcode,
          destPostcode.trim(),
          weightKg,
          length,
          width,
          height
        );

        await delay(500); // Rate limit protection

        if (availableServices.length === 0) {
          skippedNoService++;
          continue;
        }

        // Step 2: Find preferred or fallback service
        const serviceCodes = availableServices.map((s: any) => s.code);
        let chosenService = preferredService;
        if (!serviceCodes.includes(preferredService)) {
          // Fall back to first available
          chosenService = serviceCodes[0];
        }

        // Calculate cost
        const cost = await pacCalculate(
          pacApiKey,
          settings.from_postcode,
          destPostcode.trim(),
          weightKg,
          length,
          width,
          height,
          chosenService
        );

        await delay(500); // Rate limit protection

        if (cost === null || cost <= 0) {
          skippedNoService++;
          continue;
        }

        // Build calculation_basis
        const calculationBasis = {
          from_postcode: settings.from_postcode,
          to_postcode: destPostcode.trim(),
          weight_grams: totalWeightGrams,
          weight_kg: weightKg,
          length,
          width,
          height,
          chosen_service_code: chosenService,
          preferred_service_code: preferredService,
          available_services: serviceCodes,
          defaults_used: {
            weight: usedDefaultWeight,
            dimensions: usedDefaultDimensions,
          },
        };

        // Insert estimate
        const { error: insertError } = await supabase
          .from("order_shipping_estimates")
          .insert({
            user_id: user.id,
            shopify_order_id: order.shopify_order_id,
            shopify_fulfillment_id: fulfillmentId,
            marketplace_code: marketplaceCode,
            tracking_number: fulfillment.tracking_number || null,
            estimated_cost: cost,
            estimate_quality: estimateQuality,
            weight_grams: totalWeightGrams,
            from_postcode: settings.from_postcode,
            to_postcode: destPostcode.trim(),
            service_code: chosenService,
            source: "pac_estimate",
            carrier: "auspost",
            fulfilled_at: fulfillment.created_at || null,
            calculation_basis: calculationBasis,
          });

        if (insertError) {
          // Unique constraint violation = already estimated, skip
          if (insertError.code === "23505") {
            skipped++;
          } else {
            errors++;
            console.error("[estimate-shipping-cost] Insert error:", insertError.message);
          }
          continue;
        }

        estimated++;
        estimatedFulfillmentIds.add(fulfillmentId);
        if (marketplaceCode) affectedMarketplaces.add(marketplaceCode);
      }
    }

    // ─── Recalculate marketplace shipping stats ─────────────────────
    // Compute from order_shipping_estimates ONLY
    for (const mp of affectedMarketplaces) {
      // Get last 60 estimates for this marketplace
      const { data: recentEstimates } = await supabase
        .from("order_shipping_estimates")
        .select("estimated_cost")
        .eq("user_id", user.id)
        .eq("marketplace_code", mp)
        .order("fulfilled_at", { ascending: false })
        .limit(60);

      if (!recentEstimates || recentEstimates.length === 0) continue;

      const costs60 = recentEstimates.map((e: any) => Number(e.estimated_cost));
      const avg60 = costs60.reduce((a: number, b: number) => a + b, 0) / costs60.length;

      const costs14 = costs60.slice(0, 14);
      const avg14 = costs14.length >= 5
        ? costs14.reduce((a: number, b: number) => a + b, 0) / costs14.length
        : null;

      // Upsert stats
      const { data: existing } = await supabase
        .from("marketplace_shipping_stats")
        .select("id")
        .eq("user_id", user.id)
        .eq("marketplace_code", mp)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("marketplace_shipping_stats")
          .update({
            avg_shipping_cost_60: Math.round(avg60 * 100) / 100,
            avg_shipping_cost_14: avg14 !== null ? Math.round(avg14 * 100) / 100 : null,
            sample_size: costs60.length,
            last_updated: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("marketplace_shipping_stats").insert({
          user_id: user.id,
          marketplace_code: mp,
          avg_shipping_cost_60: Math.round(avg60 * 100) / 100,
          avg_shipping_cost_14: avg14 !== null ? Math.round(avg14 * 100) / 100 : null,
          sample_size: costs60.length,
          last_updated: new Date().toISOString(),
        });
      }
    }

    return new Response(
      JSON.stringify({ estimated, skipped, errors, skipped_no_service: skippedNoService }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[estimate-shipping-cost] Unhandled error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req.headers.get("Origin") ?? ""), "Content-Type": "application/json" },
      }
    );
  }
});
