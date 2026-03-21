

## Xero COA Batch Sync Modal — Batch of 2 (Test Mode)

### Overview
Build a modal that lets you preview all new/changed COA accounts and push them to Xero in batches of **2 at a time**. This conservative batch size lets us verify everything works before scaling up later.

### What gets built

**1. New component: `src/components/settings/XeroCoaSyncModal.tsx`**
- Opens from a "Sync to Xero" button on the Account Mapper
- On open: triggers a real-time COA refresh, then computes a diff:
  - **New** (green badge) — code not in Xero
  - **Changed** (amber badge) — code exists but name/type differs
  - **Unchanged** (grey, collapsed) — already matches
- Summary strip: "3 new · 1 changed · 14 unchanged"
- Mode toggle: "Create New Only" (default) vs "Overwrite Existing"
- Overwrite requires PIN confirmation + risk checkbox
- Progress section:
  - "Sending batch 1 of 3 (accounts 1–2)..." with progress bar
  - Auto-continues to next batch after each succeeds
  - If Xero returns 429: pauses, shows "Rate limited — retrying in Xs"
  - Final toast: "4 created, 0 errors"
- COA cache auto-refreshes after all batches complete

**2. New helper in `src/actions/xeroAccounts.ts`**
- `batchCreateXeroAccounts(accounts, { mode, onProgress })` — chunks into groups of 2, calls edge function sequentially, aggregates results

**3. Edge function update: `supabase/functions/create-xero-accounts/index.ts`**
- Change `MAX_BATCH` from 10 → 2
- Add `mode` field: `create_only` (default) | `create_and_update`
- When `mode === 'create_and_update'`: skip duplicate-code rejection, use POST to update existing
- Return `retry_after` if Xero sends 429

**4. Wire into `AccountMapperCard.tsx`**
- Add "Sync to Xero" button (visible when confirmed mapping has New or Changed accounts)
- Opens the modal with the computed diff data

### Batch flow (visual)

```text
[Sync to Xero] clicked
  → Live COA refresh (already built)
  → Modal opens with preview table
  → User confirms (PIN if overwrite)
  → Batch 1: accounts 1-2 → ✓
  → Batch 2: accounts 3-4 → ✓
  → Batch 3: account 5    → ✓
  → "5 created, 0 errors" toast
  → COA cache refreshed
```

### Files changed

| File | Action |
|------|--------|
| `src/components/settings/XeroCoaSyncModal.tsx` | Create |
| `src/actions/xeroAccounts.ts` | Add `batchCreateXeroAccounts` |
| `supabase/functions/create-xero-accounts/index.ts` | MAX_BATCH=2, mode param, 429 handling |
| `src/components/settings/AccountMapperCard.tsx` | Add Sync button + modal |

### Why batch of 2
- Minimal server load per call (2 creates + 1 COA refresh = 3 Xero API calls)
- Easy to verify each pair succeeds before moving on
- Can bump to 5 later once we're confident

