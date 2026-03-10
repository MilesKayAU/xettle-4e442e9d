import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

/** Check if a tag is purely numeric or too short to be a marketplace name */
function isNonMarketplaceTag(tag: string): boolean {
  const t = tag.toLowerCase().trim();
  if (!t || t.length < 2) return true;
  if (/^\d+$/.test(t)) return true; // purely numeric
  if (NON_MARKETPLACE_TAGS.has(t)) return true;
  return false;
}

/** Check if a source_name is numeric (Shopify channel ID) or in ignore list */
function needsTagScan(src: string): boolean {
  const lower = src.toLowerCase().trim();
  if (IGNORED_SOURCES.has(lower)) return false; // shouldn't reach here but guard
  if (/^\d{4,}$/.test(lower)) return true; // numeric channel ID
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

/** Analyse tags for a set of orders sharing a source_name */
function analyseTagsForSource(allTags: string[], orderCount: number): TagAnalysis {
  // Extract and clean individual tags
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

  const candidates = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1]);

  const candidateLabels = candidates.map(([tag]) => tag);

  if (candidates.length === 0) {
    return { detectedLabel: null, detectionMethod: "unknown", candidateTags: [], confidence: 0 };
  }

  const [topTag, topCount] = candidates[0];
  const ratio = topCount / orderCount;

  if (ratio >= 0.5) {
    // Majority tag — use it as the label
    // Capitalise properly: find original casing from first occurrence
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

  // No majority — unknown with candidates listed
  return {
    detectedLabel: null,
    detectionMethod: "unknown",
    candidateTags: candidateLabels,
    confidence: Math.round(ratio * 100),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const { userId } = body;

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

    // ─── Check existing sub_channels and alerts ───
    const { data: knownChannels } = await adminClient
      .from("shopify_sub_channels")
      .select("source_name, ignored")
      .eq("user_id", userId)
      .in("source_name", sourceNames);

    const knownSet = new Set((knownChannels || []).map((c: any) => c.source_name));

    const { data: existingAlerts } = await adminClient
      .from("channel_alerts")
      .select("source_name, status")
      .eq("user_id", userId)
      .in("source_name", sourceNames);

    const alertedSet = new Set((existingAlerts || []).map((a: any) => a.source_name));

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
    const detectionResults: Record<string, TagAnalysis> = {};

    for (const [src, data] of Object.entries(sourceData)) {
      // Determine detection method
      let analysis: TagAnalysis;

      if (needsTagScan(src)) {
        // Numeric channel ID — must use tag scanning
        analysis = analyseTagsForSource(data.tags, data.count);
      } else {
        // Named source — use it directly, but still scan tags for enrichment
        const tagAnalysis = analyseTagsForSource(data.tags, data.count);
        analysis = {
          detectedLabel: src.charAt(0).toUpperCase() + src.slice(1),
          detectionMethod: "source_name",
          candidateTags: tagAnalysis.candidateTags,
          confidence: 100,
        };
      }

      detectionResults[src] = analysis;

      if (knownSet.has(src)) continue; // already set up

      const alertPayload = {
        user_id: userId,
        source_name: src,
        order_count: data.count,
        total_revenue: Math.round(data.revenue * 100) / 100,
        status: "pending",
        detection_method: analysis.detectionMethod,
        detected_label: analysis.detectedLabel,
        candidate_tags: JSON.stringify(analysis.candidateTags),
      };

      if (alertedSet.has(src)) {
        // Update existing pending alert with latest detection
        const existing = (existingAlerts || []).find((a: any) => a.source_name === src);
        if (existing && existing.status === "pending") {
          await adminClient.from("channel_alerts")
            .update({
              order_count: data.count,
              total_revenue: Math.round(data.revenue * 100) / 100,
              detection_method: analysis.detectionMethod,
              detected_label: analysis.detectedLabel,
              candidate_tags: JSON.stringify(analysis.candidateTags),
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
    }

    return new Response(
      JSON.stringify({
        success: true,
        new_channels: newAlerts,
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
