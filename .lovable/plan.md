

## Scope Stale Lock Recovery + Confirm Audit Completeness

### Issue
Stale lock recovery (lines 113-140) runs globally even in single-settlement mode. In batch mode this is correct (service-role worker processing all users). In single-settlement mode (UI retry), it should be scoped to the calling user to avoid unnecessary cross-user scanning.

### Fix

**`supabase/functions/auto-post-settlement/index.ts`**:

Move stale lock recovery **after** mode detection (line 144), and scope it:

- **Single mode** (`targetUserId` set): add `.eq('user_id', targetUserId)` to the stale lock query
- **Batch mode** (no body): keep the global scan as-is — this is the scheduled worker and needs to recover all stale locks

Add a comment block confirming the design intent: batch mode is global by design, invoked only via `scheduled-sync` with service-role auth.

### Verification Summary (no code changes needed)

**All 7 `system_events` inserts** include the full required fields:
| Event | user_id | settlement_id | marketplace_code | severity |
|-------|---------|---------------|-----------------|----------|
| `auto_post_skipped_not_validated` (L269) | ✓ | ✓ | ✓ | `info` |
| `auto_post_failed_missing_mapping` (L371) | ✓ | ✓ | ✓ | `warning` |
| `auto_post_claimed` (L438) | ✓ | ✓ | ✓ | `info` |
| `auto_post_failed` (L538) | ✓ | ✓ | ✓ | `warning` |
| `auto_post_success` (L600) | ✓ | ✓ | ✓ | `info` |
| `auto_post_failed` catch (L621) | ✓ | ✓ | ✓ | `error` |
| `auto_post_stale_lock_recovered` (L130) | ✓ | ✓ | ✓ | `warning` |

**RLS policies confirmed**:
- `system_events`: `FOR ALL` → `auth.uid() = user_id` (USING + WITH CHECK)
- `rail_posting_settings`: `FOR ALL` → `auth.uid() = user_id` (USING + WITH CHECK)

Both prevent cross-user reads/writes from client-side. Edge function bypasses RLS via service-role (correct for backend worker).

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/auto-post-settlement/index.ts` | Move stale lock recovery after mode detection; scope to `targetUserId` in single mode |

No database changes. Redeploy edge function.

