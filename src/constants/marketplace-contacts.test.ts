/**
 * Drift-detection test: ensures MARKETPLACE_CONTACTS in the client canonical module
 * matches the SERVER_MARKETPLACE_CONTACTS snapshot (which mirrors the edge function).
 * 
 * If this test fails, you added a marketplace to one place but not the other.
 * Fix: update src/constants/marketplace-contacts.ts AND 
 *      supabase/functions/sync-settlement-to-xero/index.ts SERVER_MARKETPLACE_CONTACTS
 */
import { describe, it, expect } from 'vitest';
import { MARKETPLACE_CONTACTS, SERVER_CONTACT_KEYS_SNAPSHOT } from '@/constants/marketplace-contacts';

describe('marketplace-contacts drift detection', () => {
  it('client MARKETPLACE_CONTACTS keys match SERVER_CONTACT_KEYS_SNAPSHOT', () => {
    const clientKeys = Object.keys(MARKETPLACE_CONTACTS).sort();
    expect(clientKeys).toEqual(SERVER_CONTACT_KEYS_SNAPSHOT);
  });

  it('every contact value is a non-empty string', () => {
    for (const [key, value] of Object.entries(MARKETPLACE_CONTACTS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('no duplicate contact names across different marketplace codes', () => {
    const values = Object.values(MARKETPLACE_CONTACTS);
    const unique = new Set(values);
    // Allow Shopify to share names if needed, but flag duplicates for review
    expect(values.length).toBe(unique.size);
  });
});
