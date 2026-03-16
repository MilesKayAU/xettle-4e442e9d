

# LMB-Style Autoposting Audit — Bugs Found & GitHub Links

## Audit Summary

The LMB-parity features (per-marketplace autopost, Draft/Authorised, date gate, rollback toggle, batch throttling) are structurally in place across all four files. However, the audit found **3 bugs** that need fixing before this is production-grade.

---

## Bug 1: Single-mode retry always uses DRAFT (ignores rail setting)

**File:** `supabase/functions/auto-post-settlement/index.ts`, line 170

```
const result = await processSettlement(supabase, targetSettlementId, targetUserId, 'DRAFT');
```

The comment says "Load rail setting for invoice_status in single mode" but then hardcodes `'DRAFT'` instead of actually loading the rail setting. In batch mode (line 240) this is done correctly via `railConfig?.invoice_status`.

**Fix:** Before calling `processSettlement` in single mode, query `rail_posting_settings` for the target settlement's marketplace to get `invoice_status`, then pass it through.

---

## Bug 2: Auto-post success always records `xero_status: 'DRAFT'`

**File:** `supabase/functions/auto-post-settlement/index.ts`, line 625

```
xero_status: 'DRAFT',
```

Even when `invoiceStatus` is `'AUTHORISED'`, the settlement is updated with `xero_status: 'DRAFT'`. This should use the actual `invoiceStatus` variable (or the status returned by `sync-settlement-to-xero`).

**Fix:** Change to `xero_status: invoiceStatus` (or better, use `pushResult.invoiceStatus` if the sync function returns it).

---

## Bug 3: `RailPostingSettings.tsx` uses `as any` to bypass type safety

**File:** `src/components/settings/RailPostingSettings.tsx`, lines 91-92 and 173

```typescript
invoice_status: (s as any).invoice_status === 'AUTHORISED' ? 'AUTHORISED' : 'DRAFT',
auto_repost_after_rollback: (s as any).auto_repost_after_rollback ?? false,
```

The generated types file hasn't been regenerated since the migration added `invoice_status` and `auto_repost_after_rollback`. The `as any` casts work at runtime but hide any future schema drift. This is a minor issue — the types file auto-regenerates — but the upsert on line 173 also uses `as any` which could mask silent failures.

---

## What's Working Correctly

| Feature | Verified |
|---|---|
| Date gate (Option A: `created_at >= auto_post_enabled_at`) | Lines 227-231 in auto-post |
| `manual_hold` state for repost-without-auto-repost | SafeRepostModal line 198-207 |
| Batch throttle (2s sleep between pushes) | Lines 236-247 in auto-post |
| AUTHORISED mode with all safety gates server-side | sync-settlement-to-xero lines 1202-1212 |
| Account type enforcement (Revenue vs Expense) | sync-settlement-to-xero lines 895-912 |
| Tax type whitelist validation | sync-settlement-to-xero lines 1240-1248 |
| Idempotency mutex (`acquire_sync_lock`) | sync-settlement-to-xero |
| Retry-safe backfill (Option B: detect existing DRAFT in Xero) | sync-settlement-to-xero |
| CAS atomic claim with full eligibility predicates | auto-post lines 446-498 |
| Stale lock recovery (15 min) | auto-post lines 125-165 |
| Auto-repost toggle per marketplace | RailPostingSettings + SafeRepostModal |
| Draft/Authorised selector per marketplace | RailPostingSettings UI |
| Advanced accordion for rollback toggle | RailPostingSettings UI |
| AutomationSettingsPanel deprecated + redirect | Confirmed |

---

## GitHub Links for Copilot Audit

The core files to review:

```text
supabase/functions/auto-post-settlement/index.ts        — Auto-post orchestrator (698 lines)
supabase/functions/sync-settlement-to-xero/index.ts     — Xero push engine (1701 lines)
src/components/settings/RailPostingSettings.tsx          — Per-rail settings UI (472 lines)
src/components/admin/accounting/SafeRepostModal.tsx      — Void & repost workflow (453 lines)
src/components/admin/accounting/PushSafetyPreview.tsx    — Manual push gateway
src/constants/accounting-rules.ts                        — Canonical accounting rules
src/constants/settlement-rails.ts                        — Rail definitions
```

---

## Implementation Plan (3 fixes)

1. **Fix single-mode invoice_status passthrough** in `auto-post-settlement` — load rail setting before calling `processSettlement` in single mode
2. **Fix xero_status on success** in `auto-post-settlement` — use actual `invoiceStatus` variable instead of hardcoded `'DRAFT'`
3. Both are in the same file; can be done in one edit

