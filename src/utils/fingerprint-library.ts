/**
 * Marketplace Fingerprint Library — Level 2 detection layer
 *
 * Sits between the hardcoded registry (Level 1) and AI fallback (Level 3).
 * Looks up learned patterns from the `marketplace_fingerprints` table.
 * Saves new patterns when AI detects or user confirms a marketplace.
 *
 * Detection order:
 *   1. Registry patterns (instant, hardcoded)
 *   2. Fingerprint library (DB lookup, learned)
 *   3. AI detection (slow, expensive — last resort)
 */

import { supabase } from '@/integrations/supabase/client';

export interface FingerprintMatch {
  marketplace_code: string;
  field: string;
  pattern: string;
  confidence: number;
  source: string;
  match_count: number;
}

// In-memory cache of fingerprints — loaded once per session
let fingerprintCache: FingerprintMatch[] | null = null;
let cacheLoadPromise: Promise<FingerprintMatch[]> | null = null;

/**
 * Load all fingerprints from DB (global + user's own).
 * Cached for the session — call `invalidateFingerprintCache()` after writes.
 */
export async function loadFingerprints(): Promise<FingerprintMatch[]> {
  if (fingerprintCache) return fingerprintCache;
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = (async () => {
    const { data, error } = await supabase
      .from('marketplace_fingerprints')
      .select('marketplace_code, field, pattern, confidence, source, match_count')
      .gte('confidence', 0.8)
      .order('match_count', { ascending: false });

    if (error) {
      console.warn('[fingerprint-library] Failed to load:', error.message);
      return [];
    }

    fingerprintCache = (data || []) as FingerprintMatch[];
    cacheLoadPromise = null;
    return fingerprintCache;
  })();

  return cacheLoadPromise;
}

export function invalidateFingerprintCache() {
  fingerprintCache = null;
  cacheLoadPromise = null;
}

/**
 * Level 2 detection: check fingerprint library for a match.
 * Returns marketplace_code or null if no match.
 */
export async function detectFromFingerprints(
  noteAttributes: string,
  tags: string,
  paymentMethod: string,
): Promise<FingerprintMatch | null> {
  const fps = await loadFingerprints();
  if (!fps.length) return null;

  const noteLower = (noteAttributes || '').toLowerCase();
  const tagsLower = (tags || '').toLowerCase();
  const pmLower = (paymentMethod || '').toLowerCase();

  // Check in priority order: note_attributes → tags → payment_method
  // Within each field, prefer higher match_count (more trusted)
  for (const fp of fps) {
    const patternLower = fp.pattern.toLowerCase();
    if (fp.field === 'note_attributes' && noteLower.includes(patternLower)) return fp;
  }
  for (const fp of fps) {
    const patternLower = fp.pattern.toLowerCase();
    if (fp.field === 'tags' && tagsLower.includes(patternLower)) return fp;
  }
  for (const fp of fps) {
    const patternLower = fp.pattern.toLowerCase();
    if (fp.field === 'payment_method' && pmLower.includes(patternLower)) return fp;
  }

  return null;
}

/**
 * Save a new fingerprint pattern learned from AI detection or user confirmation.
 * Uses upsert on (field, pattern) unique constraint.
 */
export async function saveFingerprint(params: {
  marketplace_code: string;
  field: string;
  pattern: string;
  confidence: number;
  source: 'ai_detected' | 'user_confirmed';
}): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // Try to find existing fingerprint with this field+pattern
  const { data: existing } = await supabase
    .from('marketplace_fingerprints')
    .select('id, match_count')
    .eq('field', params.field)
    .eq('pattern', params.pattern)
    .maybeSingle();

  if (existing) {
    // Update match_count
    await supabase
      .from('marketplace_fingerprints')
      .update({ match_count: (existing.match_count || 0) + 1 })
      .eq('id', existing.id);
  } else {
    // Insert new
    const { error } = await supabase
      .from('marketplace_fingerprints')
      .insert({
        user_id: user.id,
        marketplace_code: params.marketplace_code,
        field: params.field,
        pattern: params.pattern,
        confidence: params.confidence,
        source: params.source,
        match_count: 1,
      });
    if (error) {
      console.warn('[fingerprint-library] Failed to save:', error.message);
      return false;
    }
  }

  invalidateFingerprintCache();
  return true;
}

/**
 * Increment match_count for a fingerprint that was used for detection.
 * Fire-and-forget — doesn't block detection flow.
 */
export function incrementFingerprintMatch(field: string, pattern: string) {
  (async () => {
    const { data } = await supabase
      .from('marketplace_fingerprints')
      .select('id, match_count')
      .eq('field', field)
      .eq('pattern', pattern)
      .maybeSingle();
    if (data) {
      await supabase
        .from('marketplace_fingerprints')
        .update({ match_count: (data.match_count || 0) + 1 })
        .eq('id', data.id);
    }
  })();
}
      .from('marketplace_fingerprints')
      .select('id, match_count')
      .eq('field', field)
      .eq('pattern', pattern)
      .maybeSingle();
    if (data) {
      await supabase
        .from('marketplace_fingerprints')
        .update({ match_count: (data.match_count || 0) + 1 })
        .eq('id', data.id);
    }
  })();
}
