

## Plan: Inventory Caching Layer + Background Sync

### Problem

Every time the inventory page loads, it fires 5 live API calls to external platforms (Shopify, Amazon, eBay, Kogan, Mirakl). Individual tabs also re-fetch on mount. This means:
- Page load = 5 API calls (dashboard-level for Universal)
- Switching to Shopify tab = 6th API call (tab-level)
- Every page revisit = another 5 calls

No data is cached. No background sync exists.

### Solution: Two-Layer Fix

**Layer 1 — Database cache with staleness check (immediate UX fix)**

Store fetched inventory in a `cached_inventory` table. When the page loads, serve from cache instantly. Only call live APIs if cache is older than 24 hours or user explicitly requests a refresh.

**Layer 2 — Daily background sync via scheduled-sync**

Add inventory fetching to the existing `scheduled-sync` orchestrator so inventory is refreshed automatically every 24 hours alongside settlement syncs.

### Database Change

New table: `cached_inventory`

```sql
CREATE TABLE public.cached_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,  -- 'shopify', 'amazon', 'ebay', 'kogan', 'mirakl'
  items jsonb NOT NULL DEFAULT '[]',
  has_more boolean DEFAULT false,
  partial boolean DEFAULT false,
  error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, platform)
);

ALTER TABLE public.cached_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own inventory cache"
  ON public.cached_inventory FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role manages inventory cache"
  ON public.cached_inventory FOR ALL
  TO service_role USING (true);
```

### Edge Function Changes

**Each inventory edge function** (`fetch-shopify-inventory`, `fetch-ebay-inventory`, etc.) — add a write-through step: after fetching from the external API, upsert results into `cached_inventory`. This happens server-side so the cache is always fresh after any fetch.

**New edge function: `read-cached-inventory`** — reads all 5 platform caches for a user in one call. Returns cached data + `fetched_at` timestamps so the UI knows how stale each platform's data is.

### Frontend Changes

**`src/components/inventory/useInventoryFetch.ts`**
- Add a `fetchCached()` method that reads from `cached_inventory` first
- The existing `fetch()` remains as the "force refresh" path
- New `isCacheStale(threshold: number)` helper — default 24 hours

**`src/components/inventory/InventoryDashboard.tsx`**
- On mount: call `read-cached-inventory` (single fast DB read, no external API calls)
- Show cached data immediately with a "Last synced: X hours ago" indicator
- If any platform cache is older than 24h, show a subtle "Data may be outdated" badge
- Add a "Refresh All" button on the Universal tab that triggers live fetches for all platforms
- Individual tabs: show cached data on mount, refresh button triggers live fetch

**Individual tabs** (`ShopifyInventoryTab`, `EbayInventoryTab`, etc.)
- Remove `useEffect(() => { fetch(); }, [])` — no auto-fetch on mount
- Accept `initialData` and `lastFetched` props from dashboard
- Only call live API when user clicks Refresh

**`supabase/functions/scheduled-sync/index.ts`**
- Add inventory cache refresh as an optional step in the daily sync pipeline
- Respects existing `auto_sync_enabled` toggles per platform

### UX Flow

```text
User opens Inventory page
  → Single DB query returns all 5 platform caches (instant)
  → Data renders immediately
  → "Last synced: 3 hours ago" shown per platform
  → User clicks "Refresh All" → live API calls fire → cache updated
  
Next day at 2am AEST
  → scheduled-sync refreshes inventory caches automatically
  → User opens page → sees fresh data instantly
```

### Files

| File | Action |
|------|--------|
| Migration | New `cached_inventory` table |
| `supabase/functions/read-cached-inventory/index.ts` | **New** — reads all cached platforms |
| `supabase/functions/fetch-shopify-inventory/index.ts` | Add cache upsert after fetch |
| `supabase/functions/fetch-ebay-inventory/index.ts` | Add cache upsert after fetch |
| `supabase/functions/fetch-amazon-inventory/index.ts` | Add cache upsert after fetch |
| `supabase/functions/fetch-kogan-inventory/index.ts` | Add cache upsert after fetch |
| `supabase/functions/fetch-mirakl-inventory/index.ts` | Add cache upsert after fetch |
| `src/components/inventory/useInventoryFetch.ts` | Add cached read path |
| `src/components/inventory/InventoryDashboard.tsx` | Load from cache on mount, add Refresh All |
| `src/components/inventory/ShopifyInventoryTab.tsx` | Remove auto-fetch, accept cached data |
| `src/components/inventory/EbayInventoryTab.tsx` | Remove auto-fetch, accept cached data |
| `src/components/inventory/AmazonInventoryTab.tsx` | Remove auto-fetch, accept cached data |
| `src/components/inventory/KoganInventoryTab.tsx` | Remove auto-fetch, accept cached data |
| `src/components/inventory/MiraklInventoryTab.tsx` | Remove auto-fetch, accept cached data |
| `supabase/functions/scheduled-sync/index.ts` | Add inventory refresh step |

