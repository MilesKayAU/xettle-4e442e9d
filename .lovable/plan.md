## ✅ Completed: Account Mapper Suggestion Accuracy

Pattern-aware, revenue/expense-partitioned gap-fill is now live. Uses `detectCodePattern()` and `generateCodeFromPattern()` to extend category neighbourhoods.

---

## ✅ Completed: Xero COA Sync — Batch-of-2 Modal

### What was built

1. **`src/components/settings/XeroCoaSyncModal.tsx`** — Full preview + toggle + consent modal
   - Line-by-line table: New (green) / Changed (amber) / Unchanged (grey)
   - Summary strip: "3 new · 1 changed · 14 unchanged"
   - Mode toggle: "Create New Only" (default) vs "Overwrite Existing"
   - Overwrite requires PIN + checkbox consent
   - Progress bar with batch status
   - 429 rate-limit handling with auto-retry

2. **`src/actions/xeroAccounts.ts`** — `batchCreateXeroAccounts()` helper
   - Chunks into sequential groups of 2
   - Calls edge function per batch, aggregates results
   - `onProgress` callback for UI updates
   - Handles 429 with pause & retry

3. **`supabase/functions/create-xero-accounts/index.ts`** — Updated
   - MAX_BATCH: 10 → 2
   - `mode` param: `create_only` | `create_and_update`
   - 429 handling: returns `retry_after` seconds
   - Audit logging with mode + action (created/updated)

4. **`src/components/settings/AccountMapperCard.tsx`** — Wired
   - "Sync to Xero" button in confirmed state (admin only)
   - Triggers live COA refresh before opening modal
   - `computeSyncPreviewRows()` computes diff against cached COA

### Safety invariants
- Default mode is ALWAYS "Create New Only"
- Overwrite requires PIN + checkbox per session
- All operations logged to `system_events`
- Batch of 2 for conservative testing (bump to 5 later)
