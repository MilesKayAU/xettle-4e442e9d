

# Universal Duplicate Prevention System — Implementation Plan

## Overview
Fix four audit findings (P0-P3) and build a future-proof universal dedup layer. Includes both user additions: parser version drift detection and the comment safeguard.

## Database Migration

Create `settlement_id_aliases` table and add `source_reference` column to `settlements`:

```sql
CREATE TABLE settlement_id_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_settlement_id text NOT NULL,
  alias_id text NOT NULL,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  source text, -- 'csv', 'api', 'manual'
  created_at timestamptz DEFAULT now(),
  UNIQUE(alias_id, user_id)
);
ALTER TABLE settlement_id_aliases ENABLE ROW LEVEL SECURITY;
-- RLS: users manage own aliases
CREATE POLICY "Users can manage own aliases" ON settlement_id_aliases
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS source_reference text;
```

## File Changes

### 1. `src/utils/settlement-engine.ts` — Universal dedup layer

Add `checkForDuplicate()` before `saveSettlement()` (around line 170):

```typescript
/**
 * UNIVERSAL DEDUP — ALL settlement inserts must go through this function.
 * This applies to: CSV upload, API sync, manual entry, auto-sync, any future source.
 * When adding a new marketplace API integration, do NOT bypass this check.
 * The alias registry handles ID format differences between CSV and API paths.
 */
export async function checkForDuplicate(params: {
  settlementId: string;
  marketplace: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  bankDeposit: number;
}): Promise<{ isDuplicate: boolean; canonicalId?: string; matchMethod?: string }> {
  // 1. Exact settlement_id match
  // 2. Alias registry match
  // 3. Fingerprint match (marketplace + dates + amount ±$0.05)
  // Returns match info and logs to system_events
}
```

Update `saveSettlement()` (line 182) to call `checkForDuplicate()` before insert, and register aliases after successful insert.

### 2. `supabase/functions/fetch-shopify-payouts/index.ts` — P0 + P3 fixes

**P0** (lines 124-157): After checking `existingIds`, also query for settlements where `settlement_id` matches `payout.bank_reference`. If found by bank_ref but not numeric ID, UPDATE the existing record's `settlement_id` to the numeric payout ID and insert an alias record.

**P3** (lines 144-156): Replace exact fingerprint set matching with a loop using `Math.abs(existingAmount - payoutAmount) <= 0.05` tolerance.

### 3. `supabase/functions/fetch-amazon-settlements/index.ts` — P1 fix

Line 19: Bump `PARSER_VERSION` from `'v1.7.0'` to `'v1.7.1'`. Add comment: `// MUST match src/utils/settlement-parser.ts PARSER_VERSION`.

### 4. `supabase/functions/run-validation-sweep/index.ts` — P2 + Addition 1

**P2**: After processing settlements, add a dedup pass that groups by `(marketplace, period_start, period_end)` and checks `bank_deposit` within ±$0.05. Keep numeric ID record, mark other as `status='duplicate_suppressed'`. Log to `system_events`.

**Addition 1**: Add parser version drift check at the start of the sweep:
```typescript
const CLIENT_PARSER_VERSION = '1.7.1';
const EDGE_PARSER_VERSION = '1.7.1';
if (CLIENT_PARSER_VERSION !== EDGE_PARSER_VERSION) {
  // Log to system_events with event_type 'parser_version_drift'
}
```

### 5. `src/components/admin/DataIntegrityDashboard.tsx` — New component

Admin tab showing:
- Settlements with `status = 'duplicate_suppressed'`
- Alias conflicts (same alias → different canonical IDs)
- Source breakdown (CSV vs API vs auto_sync counts)
- Parser version drift events from `system_events`

### 6. `src/pages/Admin.tsx`

Add "Data Integrity" tab (after Bug Reports) importing `DataIntegrityDashboard`.

## Verification

After implementation, run a query to check for existing Shopify duplicates with matching amounts and dates but different settlement_ids.

