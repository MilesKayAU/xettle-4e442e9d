

# Fix: Outstanding Tab Still Shows Slow Skeleton Load

## Problem

The cache-first pattern is implemented correctly, but the `outstanding_invoices_cache` table contains **0 rows**. This means `loadCachedSnapshot()` returns 0 every time, falling back to the slow foreground fetch (Xero API via edge function), which shows the skeleton.

The cache is populated by the `fetch-outstanding` edge function using the **service role key** — but service role bypasses RLS, so the writes should work. Most likely the cache was never populated because the first successful fetch hasn't completed, or a previous delete wiped it without re-insert.

## Root Cause

The edge function does `DELETE all → INSERT fresh` for the cache (lines 278–282). If the Xero API call fails or returns 0 invoices, the cache stays empty. Once empty, every subsequent page load hits the slow path.

Additionally, the **client-side** `loadCachedSnapshot()` reads via the authenticated client (subject to RLS). The RLS policy requires `auth.uid() = user_id`. But the edge function writes rows with the raw `userId` from the JWT — these should match, but if there's any mismatch the client read silently returns 0.

## Fix Plan

### 1. Populate cache from client after successful edge function response

In `OutstandingTab.tsx`, after `fetchOutstanding` receives successful data with rows, write those rows into `outstanding_invoices_cache` **from the client side** (using the authenticated client, which satisfies RLS). This guarantees the cache is populated with rows the client can read back.

**In `fetchOutstanding`**, after setting `data`:
- Extract the rows from the response
- Upsert them into `outstanding_invoices_cache` via `supabase.from('outstanding_invoices_cache')`
- Delete existing rows for this user first, then insert fresh (same pattern as edge function)

### 2. Add a service_role policy for the cache table

The edge function writes with service role which bypasses RLS — this should already work. But as a safety net, ensure the edge function's writes are visible to the client.

**Migration**: Add a trigger or simply verify the existing flow. No migration needed if we do client-side writes.

### 3. Client-side cache write function

Add `persistToCache(rows)` in `OutstandingTab.tsx`:

```typescript
const persistToCache = useCallback(async (rows: OutstandingRow[]) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  const userId = session.user.id;
  
  // Delete stale
  await supabase.from('outstanding_invoices_cache').delete().eq('user_id', userId);
  
  // Map rows back to cache schema
  const cacheRows = rows.map(r => ({
    user_id: userId,
    xero_invoice_id: r.xero_invoice_id,
    invoice_number: r.xero_invoice_number === '—' ? null : r.xero_invoice_number,
    reference: r.xero_reference || null,
    contact_name: r.contact_name,
    date: r.invoice_date,
    due_date: r.due_date,
    amount_due: r.amount,
    currency_code: r.currency_code || 'AUD',
    status: 'AUTHORISED',
    fetched_at: new Date().toISOString(),
  }));
  
  if (cacheRows.length > 0) {
    for (let i = 0; i < cacheRows.length; i += 500) {
      await supabase.from('outstanding_invoices_cache').insert(cacheRows.slice(i, i + 500));
    }
  }
}, []);
```

### 4. Call `persistToCache` after successful fetch

In `fetchOutstanding`, after `setData(summary)` and `setHasLoaded(true)`, call:
```typescript
persistToCache(summary.rows);
```

This ensures the next page load will instantly render from cache.

## Files changed

- `src/components/dashboard/OutstandingTab.tsx` — add `persistToCache`, call it after successful fetch

## What does NOT change

- Edge function logic unchanged
- No new migrations
- No new tables
- Cache-first load logic unchanged — it will now actually have data to serve

