// ══════════════════════════════════════════════════════════════
// ACCOUNTING RULES (hardcoded, never configurable)
// Canonical source: src/constants/accounting-rules.ts
// 
// Rule #11 — Three-Layer Accounting Source Model:
//   Orders     → NEVER create accounting entries
//   Payments   → NEVER create accounting entries
//   Settlements → ONLY source of accounting entries
//
// This function generates settlement RECORDS from Shopify order data.
// These settlements start as status='parsed' — no Xero entries are created.
// The user must explicitly push to Xero via the normal settlement workflow.
// ══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Hardcoded detection registries (ported from shopify-order-detector.ts) ───

const MARKETPLACE_REGISTRY: Record<string, { code: string; name: string }> = {
  'kogan':            { code: 'kogan', name: 'Kogan' },
  'big w':            { code: 'bigw', name: 'Big W' },
  'everyday market':  { code: 'everyday_market', name: 'Everyday Market' },
  'mydeal':           { code: 'mydeal', name: 'MyDeal' },
  'bunnings':         { code: 'bunnings', name: 'Bunnings' },
  'ebay':             { code: 'ebay', name: 'eBay' },
  'catch':            { code: 'catch', name: 'Catch' },
  'amazon':           { code: 'amazon', name: 'Amazon' },
  'tradesquare':      { code: 'tradesquare', name: 'TradeSquare' },
  'tiktok':           { code: 'tiktok', name: 'TikTok Shop' },
  'iconic':           { code: 'iconic', name: 'THE ICONIC' },
};

const GATEWAY_REGISTRY: Record<string, { code: string; name: string }> = {
  'commercium by constacloud': { code: 'kogan', name: 'Kogan' },
};

const AGGREGATOR_KEYWORDS = [
  'cedcommerce', 'omnivore', 'mirakl', 'kite:',
];

// ─── Detection helpers ──────────────────────────────────────────────────────

function matchHardcoded(value: string): { code: string; name: string } | null {
  const lower = value.toLowerCase().trim();
  for (const [key, entry] of Object.entries(MARKETPLACE_REGISTRY)) {
    if (lower === key || lower.includes(key)) return entry;
  }
  return null;
}

function isAggregator(value: string): boolean {
  const lower = value.toLowerCase();
  return AGGREGATOR_KEYWORDS.some(a => lower.includes(a));
}

interface RegistryRow {
  marketplace_code: string;
  marketplace_name: string;
  detection_keywords: string[] | null;
  shopify_source_names: string[] | null;
}

function matchDynamic(value: string, registry: RegistryRow[]): { code: string; name: string } | null {
  const lower = value.toLowerCase().trim();
  for (const row of registry) {
    if (row.detection_keywords) {
      for (const kw of row.detection_keywords) {
        if (lower.includes(kw.toLowerCase())) {
          return { code: row.marketplace_code, name: row.marketplace_name };
        }
      }
    }
  }
  return null;
}

function parseNoteAttributes(
  attrs: Array<{ name: string; value: string }> | string | null | undefined
): Array<{ name: string; value: string }> {
  if (!attrs) return [];
  if (Array.isArray(attrs)) return attrs;
  if (typeof attrs === 'string') {
    try {
      const parsed = JSON.parse(attrs);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return [];
}

interface DetectedOrder {
  marketplace_code: string;
  marketplace_name: string;
  total_price: number;
  total_tax: number;
  total_discounts: number;
  processed_at: string;
  order_name: string;
}

/**
 * Detect marketplace for a single order using 5-priority system:
 * 1. Tags  2. Note Attributes  3. Gateway  4. DB registry  5. Source Name
 */
function detectOrder(
  order: any,
  dbRegistry: RegistryRow[]
): { code: string; name: string } | null {
  const aggregators: string[] = [];

  // Priority 1: Tags
  if (order.tags) {
    const tags = String(order.tags).split(',').map((t: string) => t.trim()).filter(Boolean);
    for (const tag of tags) {
      if (isAggregator(tag)) { aggregators.push(tag); continue; }
      const match = matchHardcoded(tag) || matchDynamic(tag, dbRegistry);
      if (match) return match;
    }
  }

  // Priority 2: Note Attributes
  const noteAttrs = parseNoteAttributes(order.note_attributes);
  for (const attr of noteAttrs) {
    const match = matchHardcoded(attr.value) || matchDynamic(attr.value, dbRegistry);
    if (match) return match;
  }

  // Priority 3: Gateway
  if (order.gateway) {
    const gwLower = String(order.gateway).toLowerCase().trim();
    const gwMatch = GATEWAY_REGISTRY[gwLower];
    if (gwMatch) return gwMatch;
    // Also check DB registry for gateway keyword matches
    const dbGw = matchDynamic(gwLower, dbRegistry);
    if (dbGw) return dbGw;
  }

  // Guard: aggregators present but no marketplace → skip (don't misattribute)
  if (aggregators.length > 0) return null;

  // Priority 4: Source Name (only if no aggregators)
  if (order.source_name) {
    const src = String(order.source_name).toLowerCase().trim();
    // Check DB registry shopify_source_names
    for (const row of dbRegistry) {
      if (row.shopify_source_names) {
        for (const sn of row.shopify_source_names) {
          if (src === sn.toLowerCase()) {
            return { code: row.marketplace_code, name: row.marketplace_name };
          }
        }
      }
    }
    if (src === 'web') return { code: 'shopify_web', name: 'Shopify Store' };
    if (src === 'pos') return { code: 'shopify_pos', name: 'Shopify POS' };
  }

  return null;
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  let userId: string | null = null;
  let days = 60;

  try {
    const body = await req.json().catch(() => ({}));
    userId = body.userId || null;
    if (body.days && Number(body.days) > 0) days = Math.min(Number(body.days), 180);
  } catch { /* ignore */ }

  // If no userId provided, resolve from auth header
  if (!userId) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      // Use service role to verify — works with both anon and service keys
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data } = await userClient.auth.getUser();
      userId = data?.user?.id || null;
    }
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: "No userId" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Fetch marketplace_registry for dynamic detection ─────────────
  const { data: registryRows } = await adminClient
    .from("marketplace_registry")
    .select("marketplace_code, marketplace_name, detection_keywords, shopify_source_names")
    .eq("is_active", true);
  const dbRegistry: RegistryRow[] = (registryRows || []).map(r => ({
    marketplace_code: r.marketplace_code,
    marketplace_name: r.marketplace_name,
    detection_keywords: r.detection_keywords as string[] | null,
    shopify_source_names: r.shopify_source_names as string[] | null,
  }));

  // ─── Fetch cached Shopify orders ──────────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: orders, error: ordersErr } = await adminClient
    .from("shopify_orders")
    .select("shopify_order_id, order_name, tags, note_attributes, gateway, source_name, total_price, total_tax, total_discounts, processed_at")
    .eq("user_id", userId)
    .gte("processed_at", cutoff.toISOString())
    .order("processed_at", { ascending: true });

  if (ordersErr) {
    console.error("[auto-gen-settlements] orders query error:", ordersErr);
    return new Response(JSON.stringify({ error: ordersErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!orders || orders.length === 0) {
    return new Response(JSON.stringify({ success: true, settlements_created: 0, message: "No orders in window" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Detect and group by marketplace + month ──────────────────────
  // Key: `${marketplace_code}__${YYYY-MM}`
  const groups = new Map<string, DetectedOrder[]>();

  for (const order of orders) {
    const detected = detectOrder(order, dbRegistry);
    if (!detected) continue; // unclassifiable — skip

    const processedAt = order.processed_at ? new Date(order.processed_at) : new Date();
    const monthKey = `${processedAt.getFullYear()}-${String(processedAt.getMonth() + 1).padStart(2, '0')}`;
    const groupKey = `${detected.code}__${monthKey}`;

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({
      marketplace_code: detected.code,
      marketplace_name: detected.name,
      total_price: Number(order.total_price) || 0,
      total_tax: Number(order.total_tax) || 0,
      total_discounts: Number(order.total_discounts) || 0,
      processed_at: order.processed_at || new Date().toISOString(),
      order_name: order.order_name || String(order.shopify_order_id),
    });
  }

  // ─── Generate settlement records ──────────────────────────────────
  const userPrefix = userId.substring(0, 8);
  const settlementsToUpsert: any[] = [];
  const connectionsToProvision = new Map<string, string>(); // code → name

  for (const [groupKey, groupOrders] of groups) {
    const [mpCode, monthStr] = groupKey.split('__');
    const mpName = groupOrders[0].marketplace_name;

    // Deterministic settlement_id
    const settlementId = `shopify_auto_${mpCode}_${monthStr}_${userPrefix}`;

    // Calculate period boundaries from actual order dates
    const dates = groupOrders.map(o => new Date(o.processed_at));
    const periodStart = new Date(Math.min(...dates.map(d => d.getTime())));
    const periodEnd = new Date(Math.max(...dates.map(d => d.getTime())));

    // Aggregate financials
    const salesPrincipal = groupOrders.reduce((sum, o) => sum + o.total_price - o.total_tax, 0);
    const gstOnIncome = groupOrders.reduce((sum, o) => sum + o.total_tax, 0);
    const totalDiscounts = groupOrders.reduce((sum, o) => sum + o.total_discounts, 0);
    const bankDeposit = groupOrders.reduce((sum, o) => sum + o.total_price, 0);

    settlementsToUpsert.push({
      settlement_id: settlementId,
      user_id: userId,
      marketplace: mpCode,
      source: 'api_sync',
      status: 'parsed',
      period_start: periodStart.toISOString().split('T')[0],
      period_end: periodEnd.toISOString().split('T')[0],
      sales_principal: Math.round(salesPrincipal * 100) / 100,
      gst_on_income: Math.round(gstOnIncome * 100) / 100,
      promotional_discounts: Math.round(totalDiscounts * 100) / 100,
      bank_deposit: Math.round(bankDeposit * 100) / 100,
      raw_payload: {
        order_count: groupOrders.length,
        sample_orders: groupOrders.slice(0, 5).map(o => o.order_name),
        generated_at: new Date().toISOString(),
        source_version: 'auto-generate-shopify-settlements-v1',
      },
    });

    connectionsToProvision.set(mpCode, mpName);
  }

  // ─── Upsert settlements (never overwrite manual uploads) ──────────
  let settlementsCreated = 0;
  for (const settlement of settlementsToUpsert) {
    // Check if a manual settlement exists for this ID
    const { data: existing } = await adminClient
      .from("settlements")
      .select("id, source")
      .eq("settlement_id", settlement.settlement_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing && existing.source === 'manual') {
      // Never overwrite manual uploads
      continue;
    }

    if (existing) {
      // Update existing api_sync settlement
      const { error } = await adminClient
        .from("settlements")
        .update({
          sales_principal: settlement.sales_principal,
          gst_on_income: settlement.gst_on_income,
          promotional_discounts: settlement.promotional_discounts,
          bank_deposit: settlement.bank_deposit,
          period_start: settlement.period_start,
          period_end: settlement.period_end,
          raw_payload: settlement.raw_payload,
        })
        .eq("id", existing.id);
      if (!error) settlementsCreated++;
    } else {
      // Insert new
      const { error } = await adminClient
        .from("settlements")
        .insert(settlement);
      if (!error) settlementsCreated++;
      else console.error(`[auto-gen-settlements] insert error for ${settlement.settlement_id}:`, error);
    }
  }

  // ─── Provision marketplace connections ─────────────────────────────
  let connectionsProvisioned = 0;
  for (const [code, name] of connectionsToProvision) {
    const { data: existing } = await adminClient
      .from("marketplace_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("marketplace_code", code)
      .maybeSingle();

    if (!existing) {
      const { error } = await adminClient.from("marketplace_connections").insert({
        user_id: userId,
        marketplace_code: code,
        marketplace_name: name,
        connection_type: 'shopify_detected',
        connection_status: 'active',
        country_code: 'AU',
      });
      if (!error) connectionsProvisioned++;
    }
  }

  console.log(`[auto-gen-settlements] user=${userPrefix} orders=${orders.length} groups=${groups.size} settlements=${settlementsCreated} connections=${connectionsProvisioned}`);

  return new Response(
    JSON.stringify({
      success: true,
      orders_processed: orders.length,
      groups_detected: groups.size,
      settlements_created: settlementsCreated,
      connections_provisioned: connectionsProvisioned,
      marketplaces: Array.from(connectionsToProvision.entries()).map(([code, name]) => ({ code, name })),
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
