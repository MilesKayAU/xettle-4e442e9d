// ══════════════════════════════════════════════════════════════
// ACCOUNTING RULES (hardcoded, never configurable)
// Canonical source: src/constants/accounting-rules.ts
// 
// Rule #11 — Three-Layer Accounting Source Model:
//   Orders     → NEVER create accounting entries
//   Payments   → NEVER create accounting entries
//   Settlements → ONLY source of accounting entries
//
// This function generates settlement RECORDS + settlement_lines from Shopify order data.
// These settlements start as status='parsed' — no Xero entries are created.
// The user must explicitly push to Xero via the normal settlement workflow.
// ══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Hardcoded fallback registries (used only if DB query fails) ────────────

const FALLBACK_MARKETPLACE_REGISTRY: Record<string, { code: string; name: string }> = {
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

function matchFallback(value: string): { code: string; name: string } | null {
  const lower = value.toLowerCase().trim();
  for (const [key, entry] of Object.entries(FALLBACK_MARKETPLACE_REGISTRY)) {
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

interface EntityRow {
  entity_name: string;
  entity_type: string;
}

function matchRegistry(value: string, registry: RegistryRow[]): { code: string; name: string } | null {
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

/**
 * 6-priority detection pipeline:
 * 1. Tags
 * 2. Note Attributes
 * 3. Entity Library (DB)
 * 4. Marketplace Registry (DB)
 * 5. Gateway
 * 6. Source Name
 */
function detectOrder(
  order: any,
  dbRegistry: RegistryRow[],
  entityLibrary: EntityRow[]
): { code: string; name: string; method: string } | null {
  const aggregators: string[] = [];

  // Priority 1: Tags — check fallback first, then DB registry
  if (order.tags) {
    const tags = String(order.tags).split(',').map((t: string) => t.trim()).filter(Boolean);
    for (const tag of tags) {
      if (isAggregator(tag)) { aggregators.push(tag); continue; }
      const match = matchFallback(tag) || matchRegistry(tag, dbRegistry);
      if (match) return { ...match, method: 'tags' };
    }
  }

  // Priority 2: Note Attributes
  const noteAttrs = parseNoteAttributes(order.note_attributes);
  for (const attr of noteAttrs) {
    const match = matchFallback(attr.value) || matchRegistry(attr.value, dbRegistry);
    if (match) return { ...match, method: 'note_attributes' };
  }

  // Priority 3: Entity Library (DB)
  if (order.tags) {
    const tags = String(order.tags).split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
    for (const tag of tags) {
      const entity = entityLibrary.find(e => e.entity_name === tag);
      if (entity) {
        return {
          code: entity.entity_name,
          name: entity.entity_name.charAt(0).toUpperCase() + entity.entity_name.slice(1),
          method: 'entity_library',
        };
      }
    }
  }

  // Priority 4: Marketplace Registry (DB) — broader keyword scan on gateway/source
  // (tag/note-attribute matches already handled above)

  // Priority 5: Gateway
  if (order.gateway) {
    const gwLower = String(order.gateway).toLowerCase().trim();
    const gwMatch = GATEWAY_REGISTRY[gwLower];
    if (gwMatch) return { ...gwMatch, method: 'gateway' };
    const dbGw = matchRegistry(gwLower, dbRegistry);
    if (dbGw) return { ...dbGw, method: 'gateway' };
  }

  // Guard: aggregators present but no marketplace → skip
  if (aggregators.length > 0) return null;

  // Priority 6: Source Name
  if (order.source_name) {
    const src = String(order.source_name).toLowerCase().trim();
    // Check DB registry shopify_source_names
    for (const row of dbRegistry) {
      if (row.shopify_source_names) {
        for (const sn of row.shopify_source_names) {
          if (src === sn.toLowerCase()) {
            return { code: row.marketplace_code, name: row.marketplace_name, method: 'source_name' };
          }
        }
      }
    }
    if (src === 'web') return { code: 'shopify_web', name: 'Shopify Store', method: 'source_name' };
    if (src === 'pos') return { code: 'shopify_pos', name: 'Shopify POS', method: 'source_name' };
  }

  return null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface DetectedOrder {
  marketplace_code: string;
  marketplace_name: string;
  total_price: number;
  total_tax: number;
  total_discounts: number;
  processed_at: string;
  order_name: string;
  shopify_order_id: number;
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

  // ─── Fetch marketplace_registry + entity_library for detection ────
  const [registryResult, entityResult, shopifyTokenResult] = await Promise.all([
    adminClient
      .from("marketplace_registry")
      .select("marketplace_code, marketplace_name, detection_keywords, shopify_source_names")
      .eq("is_active", true),
    adminClient
      .from("entity_library")
      .select("entity_name, entity_type")
      .eq("entity_type", "marketplace"),
    adminClient
      .from("shopify_tokens")
      .select("id, shop_domain")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  const dbRegistry: RegistryRow[] = (registryResult.data || []).map(r => ({
    marketplace_code: r.marketplace_code,
    marketplace_name: r.marketplace_name,
    detection_keywords: r.detection_keywords as string[] | null,
    shopify_source_names: r.shopify_source_names as string[] | null,
  }));

  const entityLibrary: EntityRow[] = (entityResult.data || []).map(r => ({
    entity_name: r.entity_name.toLowerCase(),
    entity_type: r.entity_type,
  }));

  const connectionId = shopifyTokenResult.data?.id || null;

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
    return new Response(JSON.stringify({ success: true, settlements_created: 0, lines_created: 0, message: "No orders in window" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Detect and group by marketplace + month ──────────────────────
  const groups = new Map<string, DetectedOrder[]>();
  const unknownValues: Array<{ value: string; field: string }> = [];

  for (const order of orders) {
    const detected = detectOrder(order, dbRegistry, entityLibrary);
    if (!detected) {
      // Log unknown tags for discovery
      if (order.tags) {
        const tags = String(order.tags).split(',').map((t: string) => t.trim()).filter(Boolean);
        for (const tag of tags) {
          if (!isAggregator(tag)) {
            unknownValues.push({ value: tag, field: 'tag' });
          }
        }
      }
      continue;
    }

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
      shopify_order_id: order.shopify_order_id,
    });
  }

  // ─── Log unknown values to marketplace_discovery_log ──────────────
  if (unknownValues.length > 0) {
    const uniqueUnknowns = [...new Map(unknownValues.map(v => [v.value.toLowerCase(), v])).values()];
    for (const unk of uniqueUnknowns.slice(0, 20)) {
      await adminClient.from("marketplace_discovery_log").upsert({
        user_id: userId,
        detected_value: unk.value,
        detection_field: unk.field,
        status: 'pending',
      }, {
        onConflict: 'user_id,detected_value,detection_field',
        ignoreDuplicates: true,
      }).catch(() => {});
    }
  }

  // ─── Generate settlement records + lines ──────────────────────────
  const userPrefix = userId.substring(0, 8);
  let settlementsCreated = 0;
  let linesCreated = 0;
  const connectionsToProvision = new Map<string, string>();

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

    const settlementRecord = {
      settlement_id: settlementId,
      user_id: userId,
      marketplace: mpCode,
      source: 'api_sync',
      status: 'parsed',
      connection_id: connectionId,
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
        source_version: 'auto-generate-shopify-settlements-v2',
      },
    };

    // Check if a manual settlement exists for this ID
    const { data: existing } = await adminClient
      .from("settlements")
      .select("id, source")
      .eq("settlement_id", settlementId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing && existing.source === 'manual') {
      continue; // Never overwrite manual uploads
    }

    if (existing) {
      // Update existing api_sync settlement
      const { error } = await adminClient
        .from("settlements")
        .update({
          sales_principal: settlementRecord.sales_principal,
          gst_on_income: settlementRecord.gst_on_income,
          promotional_discounts: settlementRecord.promotional_discounts,
          bank_deposit: settlementRecord.bank_deposit,
          period_start: settlementRecord.period_start,
          period_end: settlementRecord.period_end,
          connection_id: connectionId,
          raw_payload: settlementRecord.raw_payload,
        })
        .eq("id", existing.id);
      if (!error) settlementsCreated++;
    } else {
      // Insert new
      const { error } = await adminClient
        .from("settlements")
        .insert(settlementRecord);
      if (!error) settlementsCreated++;
      else console.error(`[auto-gen-settlements] insert error for ${settlementId}:`, error);
    }

    // ══════════════════════════════════════════════════════════════
    // INTERNAL FINANCIAL CATEGORIES (canonical)
    // Source: src/constants/financial-categories.ts
    //
    //   revenue          — item sale (ex GST)
    //   marketplace_fee  — commission / referral fee
    //   payment_fee      — gateway fee (Stripe, PayPal)
    //   refund           — refunded sale
    //   gst_income       — GST collected on sales
    //   gst_expense      — GST on fees
    //   promotion        — discount / promotional rebate
    //   adjustment       — reserve, correction, reimbursement
    // ══════════════════════════════════════════════════════════════

    // ─── Write settlement_lines (individual order rows) ─────────────
    // Delete existing lines for this settlement_id (idempotent rebuild)
    await adminClient
      .from("settlement_lines")
      .delete()
      .eq("settlement_id", settlementId)
      .eq("user_id", userId);

    // Build line items from individual orders
    const lineItems = groupOrders.map(order => ({
      settlement_id: settlementId,
      user_id: userId,
      order_id: order.order_name,
      marketplace_name: mpName,
      connection_id: connectionId,
      posted_date: new Date(order.processed_at).toISOString().split('T')[0],
      transaction_type: 'Order',
      amount_type: 'ItemPrice',
      amount_description: 'Shopify Order Revenue',
      amount: Math.round((order.total_price - order.total_tax) * 100) / 100,
      accounting_category: 'revenue',
    }));

    // Add tax lines
    const taxLines = groupOrders
      .filter(o => o.total_tax > 0)
      .map(order => ({
        settlement_id: settlementId,
        user_id: userId,
        order_id: order.order_name,
        marketplace_name: mpName,
        connection_id: connectionId,
        posted_date: new Date(order.processed_at).toISOString().split('T')[0],
        transaction_type: 'Order',
        amount_type: 'Tax',
        amount_description: 'GST on Income',
        amount: Math.round(order.total_tax * 100) / 100,
        accounting_category: 'gst_income',
      }));

    // Add discount lines
    const discountLines = groupOrders
      .filter(o => o.total_discounts > 0)
      .map(order => ({
        settlement_id: settlementId,
        user_id: userId,
        order_id: order.order_name,
        marketplace_name: mpName,
        connection_id: connectionId,
        posted_date: new Date(order.processed_at).toISOString().split('T')[0],
        transaction_type: 'Order',
        amount_type: 'Promotion',
        amount_description: 'Discount',
        amount: -Math.round(order.total_discounts * 100) / 100,
        accounting_category: 'promotion',
      }));

    const allLines = [...lineItems, ...taxLines, ...discountLines];

    if (allLines.length > 0) {
      // Batch insert in chunks of 100
      for (let i = 0; i < allLines.length; i += 100) {
        const chunk = allLines.slice(i, i + 100);
        const { error: lineErr } = await adminClient
          .from("settlement_lines")
          .insert(chunk);
        if (lineErr) {
          console.error(`[auto-gen-settlements] lines insert error for ${settlementId}:`, lineErr);
        } else {
          linesCreated += chunk.length;
        }
      }
    }

    connectionsToProvision.set(mpCode, mpName);
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

  console.log(`[auto-gen-settlements] user=${userPrefix} orders=${orders.length} groups=${groups.size} settlements=${settlementsCreated} lines=${linesCreated} connections=${connectionsProvisioned}`);

  return new Response(
    JSON.stringify({
      success: true,
      orders_processed: orders.length,
      groups_detected: groups.size,
      settlements_created: settlementsCreated,
      lines_created: linesCreated,
      connections_provisioned: connectionsProvisioned,
      marketplaces: Array.from(connectionsToProvision.entries()).map(([code, name]) => ({ code, name })),
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
