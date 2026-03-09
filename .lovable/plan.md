

## Three Targeted Improvements

All three suggestions are valid gaps in the current code. Here's what needs to change:

### 1. AI Detection Cache (Session-level)
**File:** `src/components/admin/accounting/ShopifyOrdersDashboard.tsx`

Currently, the `useEffect` on line 307-314 fires AI detection for every unknown group on parse — but if the user re-renders or switches tabs, `aiSuggestions` state resets and triggers duplicate calls.

**Fix:** Add a module-level cache (`Map<string, AiDetectionResult>`) keyed by a hash of `note_attributes + tags + payment_method`. Before calling the edge function, check the cache. After receiving a result, store it. This persists for the browser session without needing localStorage.

### 2. AI Call Timeout (5 seconds)
**File:** `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` line 274

The `supabase.functions.invoke` call has no timeout. If the AI model is slow, the UI stalls with a spinner indefinitely.

**Fix:** Wrap the invoke call in `Promise.race` with a 5-second timeout. On timeout, set the suggestion to `{ reasoning: 'AI detection timed out', loading: false }` and let the user choose manually.

### 3. Order Deduplication — Already Implemented ✓
The parser already has robust deduplication:
- Line 314-316: Comment explains the dedup strategy
- Line 339-346: Skips orders already seen by `Name`
- Line 406-408: Belt-and-braces `Set` count for `uniqueOrderNames`

**No changes needed** — this is already correctly handled.

---

### Files Modified
1. `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` — AI cache + timeout

