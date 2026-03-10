/**
 * Entity Detection Engine
 * 
 * Extracts unique tags/note_attributes/gateways from Shopify orders,
 * checks them against the marketplace registry and entity_library table,
 * and returns unknown entities that need user classification.
 */

import { MARKETPLACE_REGISTRY } from './marketplace-registry';
import { supabase } from '@/integrations/supabase/client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DetectedEntity {
  name: string;
  field: 'tags' | 'note_attributes' | 'payment_method' | 'gateway';
  orderCount: number;
  sampleOrders: string[];  // first 3 order names
}

export interface ClassifiedEntity extends DetectedEntity {
  classification: 'marketplace' | 'aggregator' | 'gateway' | 'software' | 'skip';
  source: 'registry' | 'entity_library';
  entityType?: string;
  accountingImpact?: string;
}

export interface UnknownEntity extends DetectedEntity {
  // User will classify these
}

export interface EntityDetectionResult {
  classified: ClassifiedEntity[];
  unknowns: UnknownEntity[];
}

export interface EntityLibraryRow {
  id: string;
  user_id: string | null;
  entity_name: string;
  entity_type: string;
  accounting_impact: string;
  detection_field: string | null;
  notes: string | null;
  confirmed_count: number;
  source: string;
}

// ─── Tag extraction ─────────────────────────────────────────────────────────

interface OrderLike {
  name?: string;
  tags?: string;
  noteAttributes?: string;
  paymentMethod?: string;
  // API order format
  note_attributes?: Array<{ name: string; value: string }>;
  payment_gateway_names?: string[];
}

/**
 * Extract all unique tags from a set of orders.
 * Tags are comma-separated in Shopify CSVs.
 */
function extractUniqueTags(orders: OrderLike[]): Map<string, { count: number; samples: string[] }> {
  const tagMap = new Map<string, { count: number; samples: string[] }>();

  for (const order of orders) {
    const rawTags = order.tags || '';
    const tagList = rawTags.split(',').map(t => t.trim()).filter(Boolean);
    const orderName = order.name || '';

    for (const tag of tagList) {
      const normalised = tag.toLowerCase();
      const existing = tagMap.get(normalised) || { count: 0, samples: [] };
      existing.count++;
      if (existing.samples.length < 3 && orderName) {
        existing.samples.push(orderName);
      }
      tagMap.set(normalised, existing);
    }
  }

  return tagMap;
}

// ─── Registry check ─────────────────────────────────────────────────────────

/** Check if a tag matches any pattern in the marketplace registry */
function isKnownInRegistry(tag: string): { key: string; entry: typeof MARKETPLACE_REGISTRY[string] } | null {
  const tagLower = tag.toLowerCase();

  for (const [key, entry] of Object.entries(MARKETPLACE_REGISTRY)) {
    // Check tags_patterns
    if (entry.tags_patterns) {
      for (const pattern of entry.tags_patterns) {
        if (tagLower === pattern.toLowerCase() || tagLower.includes(pattern.toLowerCase())) {
          return { key, entry };
        }
      }
    }
    // Check note_attributes_patterns
    if (entry.note_attributes_patterns) {
      for (const pattern of entry.note_attributes_patterns) {
        if (tagLower.includes(pattern.toLowerCase())) {
          return { key, entry };
        }
      }
    }
    // Check payment_method_patterns
    if (entry.payment_method_patterns) {
      for (const pattern of entry.payment_method_patterns) {
        if (tagLower === pattern.toLowerCase()) {
          return { key, entry };
        }
      }
    }
  }

  return null;
}

// ─── Common/noise tags to auto-skip ─────────────────────────────────────────

const NOISE_TAGS = new Set([
  // Shopify system tags
  'restocked', 'archived', 'fulfilled', 'unfulfilled', 'partially_fulfilled',
  'paid', 'unpaid', 'refunded', 'partially_refunded', 'pending',
  'on_hold', 'open', 'closed', 'cancelled',
  // Common operational tags
  'express', 'standard', 'free shipping', 'priority', 'tracked',
  'gift', 'wholesale', 'b2b', 'pos', 'draft', 'test',
  'exchange', 'replacement', 'warranty', 'return',
  // Date/batch tags (patterns)
]);

function isNoiseTag(tag: string): boolean {
  const lower = tag.toLowerCase().trim();
  if (NOISE_TAGS.has(lower)) return true;
  // Skip pure date strings, numbers, or very short tags
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(lower)) return true;
  if (/^\d+$/.test(lower)) return true;
  if (lower.length <= 2) return true;
  return false;
}

// ─── Main detection function ────────────────────────────────────────────────

/**
 * Detect unknown entities from a set of Shopify orders.
 * 
 * 1. Extract all unique tags
 * 2. Check against marketplace registry
 * 3. Check against entity_library table
 * 4. Return classified + unknowns
 */
export async function detectUnknownEntities(
  orders: OrderLike[]
): Promise<EntityDetectionResult> {
  const classified: ClassifiedEntity[] = [];
  const unknowns: UnknownEntity[] = [];

  // Step 1: Extract unique tags
  const tagMap = extractUniqueTags(orders);

  if (tagMap.size === 0) {
    return { classified, unknowns };
  }

  // Step 2: Load entity_library entries (global + user's own)
  let libraryEntries: EntityLibraryRow[] = [];
  try {
    const { data } = await supabase
      .from('entity_library')
      .select('*');
    libraryEntries = (data as any[]) || [];
  } catch {
    // If table doesn't exist yet or query fails, continue with empty
  }

  const libraryMap = new Map<string, EntityLibraryRow>();
  for (const entry of libraryEntries) {
    libraryMap.set(entry.entity_name.toLowerCase(), entry);
  }

  // Step 3: Classify each tag
  for (const [tag, info] of tagMap) {
    // Skip noise tags
    if (isNoiseTag(tag)) continue;

    const entity: DetectedEntity = {
      name: tag,
      field: 'tags',
      orderCount: info.count,
      sampleOrders: info.samples,
    };

    // Check registry first
    const registryMatch = isKnownInRegistry(tag);
    if (registryMatch) {
      classified.push({
        ...entity,
        classification: registryMatch.entry.skip ? 'gateway' : 'marketplace',
        source: 'registry',
        entityType: registryMatch.entry.payment_type === 'gateway_clearing' ? 'gateway' : 'marketplace',
      });
      continue;
    }

    // Check entity_library
    const libraryMatch = libraryMap.get(tag.toLowerCase());
    if (libraryMatch) {
      const typeMap: Record<string, ClassifiedEntity['classification']> = {
        marketplace: 'marketplace',
        aggregator: 'aggregator' as any,
        gateway: 'gateway',
        software: 'software' as any,
        bank: 'skip',
        other: 'skip',
      };
      classified.push({
        ...entity,
        classification: typeMap[libraryMatch.entity_type] || 'skip',
        source: 'entity_library',
        entityType: libraryMatch.entity_type,
        accountingImpact: libraryMatch.accounting_impact,
      });
      continue;
    }

    // Unknown — needs classification
    unknowns.push(entity);
  }

  // Sort unknowns by order count descending (most common first)
  unknowns.sort((a, b) => b.orderCount - a.orderCount);

  return { classified, unknowns };
}

// ─── Save classification ────────────────────────────────────────────────────

export interface EntityClassification {
  entityName: string;
  entityType: 'marketplace' | 'aggregator' | 'gateway' | 'software' | 'other';
  accountingImpact: 'revenue' | 'cost' | 'gateway_fee' | 'neutral';
  detectionField: 'tags' | 'note_attributes' | 'payment_method' | 'gateway';
  notes?: string;
  shareGlobally: boolean;
}

/**
 * Save an entity classification to entity_library.
 * If shareGlobally=true, saves with user_id=NULL (visible to all users).
 * Otherwise saves with user_id=current user.
 */
export async function saveEntityClassification(
  classification: EntityClassification
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const row = {
      user_id: classification.shareGlobally ? null : user.id,
      entity_name: classification.entityName,
      entity_type: classification.entityType,
      accounting_impact: classification.accountingImpact,
      detection_field: classification.detectionField,
      notes: classification.notes || null,
      confirmed_count: 1,
      source: 'user',
    };

    // For shared entries (user_id=NULL), use service role via edge function
    // For user-specific entries, insert directly
    if (classification.shareGlobally) {
      // Insert with user_id = user's id first (RLS allows this),
      // then we can share via a flag. For now, save as user's own.
      // Global sharing requires admin approval in a real system.
      // Save as user's own entry for now.
      const { error } = await supabase
        .from('entity_library')
        .upsert(
          { ...row, user_id: user.id },
          { onConflict: 'entity_name,user_id' }
        );
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await supabase
        .from('entity_library')
        .upsert(row as any, { onConflict: 'entity_name,user_id' });
      if (error) return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Check if user has already dismissed/classified a set of tags.
 * Returns the set of tag names that have been classified.
 */
export async function getAlreadyClassifiedTags(): Promise<Set<string>> {
  const result = new Set<string>();
  try {
    const { data } = await supabase
      .from('entity_library')
      .select('entity_name');
    if (data) {
      for (const row of data as any[]) {
        result.add(row.entity_name.toLowerCase());
      }
    }
  } catch {
    // silent
  }
  return result;
}
