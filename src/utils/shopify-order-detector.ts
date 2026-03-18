/**
 * Shopify Order Marketplace Detector
 * 
 * 6-priority detection algorithm:
 * 1. Tags (split by comma, match against registries)
 * 2. Note Attributes (match values against registries)
 * 3. Entity Library (DB lookup for user/global classifications)
 * 4. Marketplace Registry (DB — single source of truth)
 * 5. Gateway (match against known gateways)
 * 6. Source Name (web → Shopify Store, pos → Shopify POS)
 * 
 * First match wins. Stop after first match.
 * 
 * FALLBACK_REGISTRY is used only if the DB marketplace_registry query fails.
 * The DB marketplace_registry table is the canonical source of truth.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Fallback Registries (seed data — used only if DB unavailable) ──────────

export const DETECTOR_MARKETPLACE_REGISTRY: Record<string, { code: string; name: string }> = {
  'kogan':            { code: 'kogan', name: 'Kogan' },
  'big w':            { code: 'bigw', name: 'Big W' },
  'everyday market':  { code: 'everyday_market', name: 'Everyday Market' },
  'mydeal':           { code: 'mydeal', name: 'MyDeal' },
  'bunnings':         { code: 'bunnings', name: 'Bunnings' },
  'ebay':             { code: 'ebay_au', name: 'eBay Australia' },
  'catch':            { code: 'catch', name: 'Catch' },
  'amazon':           { code: 'amazon', name: 'Amazon' },
  'tradesquare':      { code: 'tradesquare', name: 'TradeSquare' },
};

export const GATEWAY_REGISTRY: Record<string, { code: string; name: string }> = {
  'commercium by constacloud': { code: 'kogan', name: 'Kogan' },
};

export const AGGREGATOR_REGISTRY: string[] = [
  'cedcommerce mcf connector',
  'omnivore',
  'mirakl',
  'kite: shipping discount applied',
];

// ─── Types ──────────────────────────────────────────────────────────────────

export type DetectionMethod = 'tags' | 'note_attributes' | 'entity_library' | 'marketplace_registry' | 'gateway' | 'source_name' | 'unknown';

export interface OrderDetectionResult {
  marketplace_code: string | null;
  marketplace_name: string | null;
  aggregators: string[];
  confidence: number;
  detection_method: DetectionMethod;
  unknown_tags: string[];
  mcf_fulfillment?: boolean;
  needs_classification?: boolean;
}

export interface ShopifyOrderInput {
  tags?: string;
  note_attributes?: Array<{ name: string; value: string }> | string;
  gateway?: string;
  source_name?: string;
}

export interface BatchDetectionResult {
  marketplaces: Array<{
    code: string;
    name: string;
    order_count: number;
    sample_orders: string[];
  }>;
  aggregators_found: string[];
  unknown_tags: string[];
  mcf_order_count: number;
}

// ─── DB Registry Cache ─────────────────────────────────────────────────────

interface CachedRegistry {
  entries: Array<{ marketplace_code: string; marketplace_name: string; detection_keywords: string[]; shopify_source_names: string[] }>;
  loadedAt: number;
}

let _registryCache: CachedRegistry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadRegistryFromDb(): Promise<CachedRegistry['entries']> {
  if (_registryCache && Date.now() - _registryCache.loadedAt < CACHE_TTL_MS) {
    return _registryCache.entries;
  }
  try {
    const { data } = await supabase
      .from('marketplace_registry')
      .select('marketplace_code, marketplace_name, detection_keywords, shopify_source_names')
      .eq('is_active', true);
    if (data && data.length > 0) {
      const entries = data.map(r => ({
        marketplace_code: r.marketplace_code,
        marketplace_name: r.marketplace_name,
        detection_keywords: (r.detection_keywords as string[]) || [],
        shopify_source_names: (r.shopify_source_names as string[]) || [],
      }));
      _registryCache = { entries, loadedAt: Date.now() };
      return entries;
    }
  } catch {
    // DB unavailable — fall through to fallback
  }
  return [];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function matchFallbackRegistry(value: string): { code: string; name: string } | null {
  const lower = value.toLowerCase().trim();
  for (const [key, entry] of Object.entries(DETECTOR_MARKETPLACE_REGISTRY)) {
    if (lower === key || lower.includes(key)) {
      return entry;
    }
  }
  return null;
}

function matchDbRegistry(value: string, registry: CachedRegistry['entries']): { code: string; name: string } | null {
  const lower = value.toLowerCase().trim();
  for (const row of registry) {
    for (const kw of row.detection_keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { code: row.marketplace_code, name: row.marketplace_name };
      }
    }
  }
  return null;
}

function isAggregator(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return AGGREGATOR_REGISTRY.some(a => lower === a || lower.includes(a));
}

// ─── Single Order Detection (Sync — uses fallback only) ─────────────────────

export function detectMarketplaceFromOrder(order: ShopifyOrderInput): OrderDetectionResult {
  const aggregators: string[] = [];
  const unknown_tags: string[] = [];
  let marketplace_code: string | null = null;
  let marketplace_name: string | null = null;
  let confidence = 0;
  let detection_method: DetectionMethod = 'unknown';

  // ── Step 1: Tags
  if (order.tags) {
    const tagList = order.tags.split(',').map(t => t.trim()).filter(Boolean);
    for (const tag of tagList) {
      const tagLower = tag.toLowerCase();
      if (isAggregator(tagLower)) { aggregators.push(tagLower); continue; }
      if (!marketplace_code) {
        const match = matchFallbackRegistry(tagLower);
        if (match) {
          marketplace_code = match.code;
          marketplace_name = match.name;
          confidence = 0.9;
          detection_method = 'tags';
        } else {
          unknown_tags.push(tag);
        }
      }
    }
    if (marketplace_code) {
      return buildResult(marketplace_code, marketplace_name, aggregators, confidence, detection_method, unknown_tags);
    }
  }

  // ── Step 2: Note Attributes
  const noteAttrs = parseNoteAttributes(order.note_attributes);
  for (const attr of noteAttrs) {
    const match = matchFallbackRegistry(attr.value);
    if (match) {
      return buildResult(match.code, match.name, aggregators, 0.85, 'note_attributes', unknown_tags);
    }
  }

  // ── Step 3: Entity Library — skipped in sync version (use async)

  // ── Step 4: Marketplace Registry — skipped in sync version (use async)

  // ── Step 5: Gateway
  if (order.gateway) {
    const gwLower = order.gateway.toLowerCase().trim();
    const gwMatch = GATEWAY_REGISTRY[gwLower];
    if (gwMatch) {
      return buildResult(gwMatch.code, gwMatch.name, aggregators, 0.6, 'gateway', unknown_tags);
    }
  }

  // ── Guard: aggregators present but no marketplace → don't guess
  if (aggregators.length > 0) {
    const result = buildResult(null, null, aggregators, 0, 'unknown', unknown_tags);
    result.needs_classification = true;
    return result;
  }

  // ── Step 6: Source Name
  if (order.source_name) {
    const srcLower = order.source_name.toLowerCase().trim();
    if (srcLower === 'web') return buildResult('shopify_web', 'Shopify Store', aggregators, 0.5, 'source_name', unknown_tags);
    if (srcLower === 'pos') return buildResult('shopify_pos', 'Shopify POS', aggregators, 0.5, 'source_name', unknown_tags);
  }

  return buildResult(null, null, aggregators, 0, 'unknown', unknown_tags);
}

// ─── Async Detection (Full 6-priority pipeline with DB) ─────────────────────

export async function detectMarketplaceFromOrderAsync(
  order: ShopifyOrderInput
): Promise<OrderDetectionResult> {
  const aggregators: string[] = [];
  const unknown_tags: string[] = [];
  const allTags: string[] = [];

  // Load DB registry
  const dbRegistry = await loadRegistryFromDb();

  // ── Step 1: Tags
  if (order.tags) {
    const tagList = order.tags.split(',').map(t => t.trim()).filter(Boolean);
    for (const tag of tagList) {
      const tagLower = tag.toLowerCase();
      if (isAggregator(tagLower)) { aggregators.push(tagLower); continue; }
      const match = matchFallbackRegistry(tagLower);
      if (match) {
        return buildResult(match.code, match.name, aggregators, 0.9, 'tags', unknown_tags);
      }
      unknown_tags.push(tag);
      allTags.push(tagLower);
    }
  }

  // ── Step 2: Note Attributes
  const noteAttrs = parseNoteAttributes(order.note_attributes);
  for (const attr of noteAttrs) {
    const match = matchFallbackRegistry(attr.value);
    if (match) {
      return buildResult(match.code, match.name, aggregators, 0.85, 'note_attributes', unknown_tags);
    }
  }

  // ── Step 3: Entity Library (DB)
  if (allTags.length > 0) {
    try {
      const { data } = await supabase
        .from('entity_library')
        .select('entity_name, entity_type, accounting_impact')
        .in('entity_name', allTags)
        .eq('entity_type', 'marketplace');

      if (data && data.length > 0) {
        const entity = data[0];
        return buildResult(
          entity.entity_name,
          entity.entity_name.charAt(0).toUpperCase() + entity.entity_name.slice(1),
          aggregators, 0.8, 'entity_library',
          unknown_tags.filter(t => t.toLowerCase() !== entity.entity_name.toLowerCase())
        );
      }
    } catch { /* DB lookup failed — continue */ }
  }

  // ── Step 4: Marketplace Registry (DB) — check tags against DB keywords
  if (allTags.length > 0 && dbRegistry.length > 0) {
    for (const tag of allTags) {
      const match = matchDbRegistry(tag, dbRegistry);
      if (match) {
        return buildResult(match.code, match.name, aggregators, 0.75, 'marketplace_registry', unknown_tags);
      }
    }
  }

  // ── Step 5: Gateway
  if (order.gateway) {
    const gwLower = order.gateway.toLowerCase().trim();
    const gwMatch = GATEWAY_REGISTRY[gwLower];
    if (gwMatch) return buildResult(gwMatch.code, gwMatch.name, aggregators, 0.6, 'gateway', unknown_tags);
    const dbGw = matchDbRegistry(gwLower, dbRegistry);
    if (dbGw) return buildResult(dbGw.code, dbGw.name, aggregators, 0.6, 'gateway', unknown_tags);
  }

  // ── Guard: aggregators present but no marketplace → don't guess
  if (aggregators.length > 0) {
    const result = buildResult(null, null, aggregators, 0, 'unknown', unknown_tags);
    result.needs_classification = true;
    return result;
  }

  // ── Step 6: Source Name
  if (order.source_name) {
    const srcLower = order.source_name.toLowerCase().trim();
    // Check DB registry shopify_source_names first
    for (const row of dbRegistry) {
      for (const sn of row.shopify_source_names) {
        if (srcLower === sn.toLowerCase()) {
          return buildResult(row.marketplace_code, row.marketplace_name, aggregators, 0.5, 'source_name', unknown_tags);
        }
      }
    }
    if (srcLower === 'web') return buildResult('shopify_web', 'Shopify Store', aggregators, 0.5, 'source_name', unknown_tags);
    if (srcLower === 'pos') return buildResult('shopify_pos', 'Shopify POS', aggregators, 0.5, 'source_name', unknown_tags);
  }

  return buildResult(null, null, aggregators, 0, 'unknown', unknown_tags);
}

function buildResult(
  code: string | null,
  name: string | null,
  aggregators: string[],
  confidence: number,
  method: DetectionMethod,
  unknown_tags: string[]
): OrderDetectionResult {
  const mcf_fulfillment = aggregators.some(a => a.includes('cedcommerce mcf connector'));
  return {
    marketplace_code: code,
    marketplace_name: name,
    aggregators,
    confidence,
    detection_method: method,
    unknown_tags,
    mcf_fulfillment,
  };
}

function parseNoteAttributes(
  attrs: Array<{ name: string; value: string }> | string | undefined
): Array<{ name: string; value: string }> {
  if (!attrs) return [];
  if (Array.isArray(attrs)) return attrs;
  return attrs.split('\n').map(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return { name: '', value: line.trim() };
    return { name: line.substring(0, colonIdx).trim(), value: line.substring(colonIdx + 1).trim() };
  }).filter(a => a.value);
}

// ─── Batch Detection ────────────────────────────────────────────────────────

export interface OrderWithName extends ShopifyOrderInput {
  name?: string;
  id?: string | number;
}

export async function detectAllMarketplaces(
  orders: OrderWithName[]
): Promise<BatchDetectionResult> {
  const marketplaceMap = new Map<string, { code: string; name: string; orders: string[] }>();
  const allAggregators = new Set<string>();
  const allUnknownTags = new Set<string>();
  let mcf_order_count = 0;

  // Load DB registry + entity_library once for batch
  const dbRegistry = await loadRegistryFromDb();

  const allTags = new Set<string>();
  for (const order of orders) {
    if (order.tags) {
      order.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).forEach(t => allTags.add(t));
    }
  }

  // Batch entity_library lookup
  let entityMap = new Map<string, string>();
  if (allTags.size > 0) {
    try {
      const { data } = await supabase
        .from('entity_library')
        .select('entity_name, entity_type')
        .in('entity_name', Array.from(allTags))
        .eq('entity_type', 'marketplace');
      if (data) {
        for (const row of data) {
          entityMap.set(row.entity_name.toLowerCase(), row.entity_name);
        }
      }
    } catch { /* Non-fatal */ }
  }

  for (const order of orders) {
    // Use sync detection first (steps 1, 2, 5, 6)
    const result = detectMarketplaceFromOrder(order);

    // If sync detection failed, check entity_library cache (step 3)
    if (!result.marketplace_code && result.unknown_tags.length > 0) {
      for (const tag of result.unknown_tags) {
        const entityMatch = entityMap.get(tag.toLowerCase());
        if (entityMatch) {
          result.marketplace_code = entityMatch;
          result.marketplace_name = entityMatch.charAt(0).toUpperCase() + entityMatch.slice(1);
          result.confidence = 0.8;
          result.detection_method = 'entity_library';
          break;
        }
      }
    }

    // If still no match, check DB registry (step 4)
    if (!result.marketplace_code && result.unknown_tags.length > 0 && dbRegistry.length > 0) {
      for (const tag of result.unknown_tags) {
        const match = matchDbRegistry(tag.toLowerCase(), dbRegistry);
        if (match) {
          result.marketplace_code = match.code;
          result.marketplace_name = match.name;
          result.confidence = 0.75;
          result.detection_method = 'marketplace_registry';
          break;
        }
      }
    }

    result.aggregators.forEach(a => allAggregators.add(a));
    result.unknown_tags.forEach(t => allUnknownTags.add(t));
    if (result.mcf_fulfillment) mcf_order_count++;

    if (result.marketplace_code) {
      const existing = marketplaceMap.get(result.marketplace_code);
      const orderName = order.name || String(order.id || '');
      if (existing) {
        existing.orders.push(orderName);
      } else {
        marketplaceMap.set(result.marketplace_code, {
          code: result.marketplace_code,
          name: result.marketplace_name || result.marketplace_code,
          orders: [orderName],
        });
      }
    }
  }

  return {
    marketplaces: Array.from(marketplaceMap.values())
      .map(m => ({
        code: m.code,
        name: m.name,
        order_count: m.orders.length,
        sample_orders: m.orders.slice(0, 5),
      }))
      .sort((a, b) => b.order_count - a.order_count),
    aggregators_found: Array.from(allAggregators),
    unknown_tags: Array.from(allUnknownTags),
    mcf_order_count,
  };
}

// ─── Entity Library Save ────────────────────────────────────────────────────

const ENTITY_TYPE_IMPACT: Record<string, string> = {
  marketplace: 'revenue',
  aggregator: 'cost',
  gateway: 'gateway_fee',
  other: 'neutral',
  ignore: 'neutral',
};

export async function classifyUnknownTag(
  tag: string,
  entityType: string,
  share: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await supabase.from('entity_library').upsert({
      entity_name: tag.toLowerCase().trim(),
      entity_type: entityType,
      accounting_impact: ENTITY_TYPE_IMPACT[entityType] || 'neutral',
      user_id: share ? null : user.id,
      source: 'user',
      detection_field: 'tags',
    } as any, {
      onConflict: 'entity_name,entity_type',
    } as any);

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
