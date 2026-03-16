import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

// Source names that are core Shopify — never alert on these
const IGNORED_SOURCES = new Set([
  "web", "shopify", "pos", "online_store", "iphone", "android",
  "unknown", "", "shopify_draft_order", "draft_orders", "buy_button",
  "checkout", "subscription_contract_checkout_one",
]);

// Tags that are NOT marketplace names — logistics, app, or status tags
const NON_MARKETPLACE_TAGS = new Set([
  "cedcommerce mcf connector", "cedcommerce", "mcf connector",
  "fulfilled", "unfulfilled", "partially_fulfilled",
  "shipping", "shipped", "delivered", "in_transit",
  "wholesale", "subscription", "draft", "pos", "test",
  "refund", "refunded", "cancelled", "archived",
  "manual", "exchange", "return", "priority",
]);

/** Known marketplace label-to-code mappings */
const LABEL_TO_CODE: Record<string, string> = {
  mydeal: "mydeal",
  "my deal": "mydeal",
  bunnings: "bunnings",
  kogan: "kogan",
  "big w": "bigw",
  bigw: "bigw",
  "everyday market": "everyday_market",
  catch: "catch",
  ebay: "ebay",
  "tiktok shop": "tiktok_shop",
  amazon: "amazon_au",
};

function isNonMarketplaceTag(tag: string): boolean {
  const t = tag.toLowerCase().trim();
  if (!t || t.length < 2) return true;
  if (/^\d+$/.test(t)) return true;
  if (NON_MARKETPLACE_TAGS.has(t)) return true;
  return false;
}

function needsTagScan(src: string): boolean {
  const lower = src.toLowerCase().trim();
  if (IGNORED_SOURCES.has(lower)) return false;
  if (/^\d{4,}$/.test(lower)) return true;
  return false;
}

interface SourceData {
  count: number;
  revenue: number;
  tags: string[];
}

interface TagAnalysis {
  detectedLabel: string | null;
  detectionMethod: "tag" | "source_name" | "unknown";
  candidateTags: string[];
  confidence: number;
}

function analyseTagsForSource(allTags: string[], orderCount: number): TagAnalysis {
  const tagCounts: Record<string, number> = {};
  for (const rawTags of allTags) {
    if (!rawTags) continue;
    const parts = rawTags.split(",").map((t: string) => t.trim()).filter(Boolean);
    for (const part of parts) {
      if (isNonMarketplaceTag(part)) continue;
      const key = part.toLowerCase();
      tagCounts[key] = (tagCounts[key] || 0) + 1;
    }
  }

  const candidates = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  const candidateLabels = candidates.map(([tag]) => tag);

  if (candidates.length === 0) {
    return { detectedLabel: null, detectionMethod: "unknown", candidateTags: [], confidence: 0 };
  }

  const [topTag, topCount] = candidates[0];
  const ratio = topCount / orderCount;

  if (ratio >= 0.5) {
    let originalCase = topTag.charAt(0).toUpperCase() + topTag.slice(1);
    for (const rawTags of allTags) {
      if (!rawTags) continue;
      const parts = rawTags.split(",").map((t: string) => t.trim());
      const match = parts.find((p: string) => p.toLowerCase() === topTag);
      if (match) { originalCase = match; break; }
    }

    return {
      detectedLabel: originalCase,
      detectionMethod: "tag",
      candidateTags: candidateLabels,
      confidence: Math.round(ratio * 100),
    };
  }

  return {
    detectedLabel: null,
    detectionMethod: "unknown",
    candidateTags: candidateLabels,
    confidence: Math.round(ratio * 100),
  };
}

/** Resolve a detected label to a marketplace_code */
function resolveMarketplaceCode(label: string | null, sourceName: string): string | null {
  if (label) {
    const code = LABEL_TO_CODE[label.toLowerCase().trim()];
    if (code) return code;
  }
  const code = LABEL_TO_CODE[sourceName.toLowerCase().trim()];
  if (code) return code;
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    let userId = body.userId as string | undefined;

    // Fallback: extract userId from JWT if not provided in body
    if (!userId) {
      const authHeader = req.headers.get("Authorization") || "";
      if (authHeader.startsWith("Bearer ")) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        userId = user?.id;
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Fetch all orders with source_name, tags, total_price ───
    const { data: orderRows, error: queryError } = await adminClient
      .from("shopify_orders")
      .select("source_name, total_price, tags")
      .eq("user_id", userId)
      .not("source_name", "is", null);

    if (queryError) {
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!orderRows || orderRows.length === 0) {
      return new Response(
        JSON.stringify({ success: true, new_channels: 0, scanned_sources: [], needs_initial_sync: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Aggregate by source_name ───
    const sourceData: Record<string, SourceData> = {};

    for (const row of orderRows) {
      const src = (row.source_name || "").toLowerCase().trim();
      if (!src || IGNORED_SOURCES.has(src)) continue;
      if (!sourceData[src]) sourceData[src] = { count: 0, revenue: 0, tags: [] };
      sourceData[src].count++;
      sourceData[src].revenue += parseFloat(row.total_price || "0") || 0;
      if (row.tags) sourceData[src].tags.push(row.tags);
    }

    const sourceNames = Object.keys(sourceData);
    if (sourceNames.length === 0) {
      return new Response(
        JSON.stringify({ success: true, new_channels: 0, scanned_sources: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Cross-reference: existing sub_channels, alerts, and settlements ───
    const { data: knownChannels } = await adminClient
      .from("shopify_sub_channels")
      .select("source_name, ignored, marketplace_code")
      .eq("user_id", userId)
      .in("source_name", sourceNames);

    const knownSet = new Set((knownChannels || []).map((c: any) => c.source_name));

    const { data: existingAlerts } = await adminClient
      .from("channel_alerts")
      .select("source_name, status, alert_type")
      .eq("user_id", userId)
      .in("source_name", sourceNames);

    const alertedSet = new Set((existingAlerts || []).map((a: any) => a.source_name));

    // Fetch user's existing marketplace settlements to detect "unlinked" state
    const { data: userSettlements } = await adminClient
      .from("settlements")
      .select("marketplace")
      .eq("user_id", userId);

    const existingMarketplaceCodes = new Set(
      (userSettlements || []).map((s: any) => (s.marketplace || "").toLowerCase().trim())
    );

    // Also check marketplace_connections
    const { data: userConnections } = await adminClient
      .from("marketplace_connections")
      .select("marketplace_code")
      .eq("user_id", userId);

    for (const conn of userConnections || []) {
      existingMarketplaceCodes.add((conn.marketplace_code || "").toLowerCase().trim());
    }

    // ─── Auto-ignore stale pending alerts for IGNORED_SOURCES ───
    const { data: allPendingAlerts } = await adminClient
      .from("channel_alerts")
      .select("id, source_name")
      .eq("user_id", userId)
      .eq("status", "pending");

    if (allPendingAlerts) {
      for (const alert of allPendingAlerts) {
        const src = (alert.source_name || "").toLowerCase().trim();
        if (IGNORED_SOURCES.has(src)) {
          await adminClient.from("channel_alerts")
            .update({ status: "auto_ignored" })
            .eq("id", alert.id);
        }
      }
    }

    // ─── Create / update alerts with intelligent detection ───
    let newAlerts = 0;
    let unlinkedAlerts = 0;
    let skippedAlreadyLinked = 0;
    const detectionResults: Record<string, TagAnalysis & { alert_type: string }> = {};

    for (const [src, data] of Object.entries(sourceData)) {
      // Determine detection method
      let analysis: TagAnalysis;

      if (needsTagScan(src)) {
        analysis = analyseTagsForSource(data.tags, data.count);
      } else {
        const tagAnalysis = analyseTagsForSource(data.tags, data.count);
        analysis = {
          detectedLabel: src.charAt(0).toUpperCase() + src.slice(1),
          detectionMethod: "source_name",
          candidateTags: tagAnalysis.candidateTags,
          confidence: 100,
        };
      }

      // Resolve marketplace code from the detected label
      const resolvedCode = resolveMarketplaceCode(analysis.detectedLabel, src);

      // Determine alert_type by cross-referencing existing data
      let alertType: "new" | "unlinked" | "already_linked" = "new";

      if (knownSet.has(src)) {
        // Already set up in shopify_sub_channels → already_linked, skip
        alertType = "already_linked";
        skippedAlreadyLinked++;
        detectionResults[src] = { ...analysis, alert_type: alertType };
        continue;
      }

      if (resolvedCode && existingMarketplaceCodes.has(resolvedCode)) {
        // Marketplace exists in settlements/connections but not linked to Shopify orders
        alertType = "unlinked";
        unlinkedAlerts++;
      }

      detectionResults[src] = { ...analysis, alert_type: alertType };

      const alertPayload = {
        user_id: userId,
        source_name: src,
        order_count: data.count,
        total_revenue: Math.round(data.revenue * 100) / 100,
        status: "pending",
        detection_method: analysis.detectionMethod,
        detected_label: analysis.detectedLabel,
        candidate_tags: JSON.stringify(analysis.candidateTags),
        alert_type: alertType,
      };

      if (alertedSet.has(src)) {
        const existing = (existingAlerts || []).find((a: any) => a.source_name === src);
        if (existing && existing.status === "pending") {
          await adminClient.from("channel_alerts")
            .update({
              order_count: data.count,
              total_revenue: Math.round(data.revenue * 100) / 100,
              detection_method: analysis.detectionMethod,
              detected_label: analysis.detectedLabel,
              candidate_tags: JSON.stringify(analysis.candidateTags),
              alert_type: alertType,
            })
            .eq("user_id", userId)
            .eq("source_name", src);
        }
      } else {
        await adminClient.from("channel_alerts").upsert(
          alertPayload,
          { onConflict: "user_id,source_name" }
        );
        newAlerts++;
      }

      // ─── Auto-provision shopify_sub_channels for detected marketplaces ───
      const subChannelPayload = {
        user_id: userId,
        source_name: src,
        marketplace_label: analysis.detectedLabel || src.charAt(0).toUpperCase() + src.slice(1),
        marketplace_code: resolvedCode || null,
        order_count: data.count,
        total_revenue: Math.round(data.revenue * 100) / 100,
        settlement_type: "separate_file",
        ignored: false,
        first_seen_at: new Date().toISOString(),
      };

      await adminClient.from("shopify_sub_channels").upsert(
        subChannelPayload,
        { onConflict: "user_id,source_name" }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        new_channels: newAlerts,
        unlinked_channels: unlinkedAlerts,
        already_linked_skipped: skippedAlreadyLinked,
        scanned_sources: sourceNames,
        total_orders_scanned: Object.values(sourceData).reduce((s, d) => s + d.count, 0),
        detection_results: detectionResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
