# Xettle Pre-Launch Checklist

## ✅ DONE — Critical Security

- [x] `system_config` RLS hardened — zero client-side policies, service role + SECURITY DEFINER only
- [x] RLS enabled on all 67 tables
- [x] Financial tables enforce `user_id = auth.uid()` on read and write
- [x] Trial/role mutations server-authoritative via `check_and_expire_trial()` SECURITY DEFINER
- [x] Admin-only tools (RLS audit, System Audit) gated behind `has_role('admin')` — no longer visible to regular users
- [x] Supabase SDK updated to latest stable (`^2.100.1`)

## 🔲 DO NOW — Before Go-Live

### 1. Enable HIBP Password Protection
- **Where**: Lovable Cloud → Users → Auth Settings (gear) → Email → Password HIBP Check
- **Why**: Prevents users from signing up with known-breached passwords. Critical for a finance-adjacent app.
- **Status**: Manual action required — cannot be enabled via API

### 2. Fix `search_path` on remaining SECURITY DEFINER functions
- The following 4 functions are missing `SET search_path TO 'public'`:
  - `enqueue_email`
  - `delete_email`
  - `move_to_dlq`
  - `read_email_batch`
- **Risk**: Low (email queue internals, not user-facing), but should be closed for defense-in-depth
- **Fix**: Migration to add `SET search_path TO 'public'` to each

### 3. Confirm client-side PIN is UX-only
- `PinGate` (site-wide PIN `1984`) — used for pre-launch access gating, must be removed or replaced before public launch
- `SettingsPinDialog` (per-user settings PIN) — acceptable as UX friction layer, but must NOT be treated as a security boundary
- **Real protection**: RLS policies + `has_role()` checks + SECURITY DEFINER functions
- **Action**: Remove `PinGate` wrapper from `App.tsx` at launch, or replace with proper auth gate

## 🔲 DO NEXT — Post-Launch Hardening

### 4. Move high-risk mutations server-side (Tier 1)
Tables where client-side writes should be migrated to edge functions:
- `settlements` — delete / status changes
- `marketplace_validation` — status updates, Xero push flags
- `rail_posting_settings` — Xero-affecting posting mode changes
- `marketplace_registry` — shared/admin table, should not be client-writable by regular users
- `period_locks` — lock/unlock financial periods

### 5. Keep client-side (acceptable with RLS)
- `app_settings` (user preferences, onboarding flags)
- `marketplace_connections` (user-owned connection state)
- `product_costs` (user-owned SKU costs)
- `reconciliation_notes` (user-owned notes)
- `bug_reports` (user submissions)

### 6. Ongoing RLS hygiene
- No `USING (true)` / `WITH CHECK (true)` on user-accessible tables
- INSERT policies must prevent `user_id` spoofing (enforce `auth.uid()`)
- UPDATE policies must prevent ownership field changes
- Admin/global tables not writable by `authenticated` role directly
- Service role usage isolated to edge functions and SECURITY DEFINER functions only

## 📋 Launch-Day Actions (Ordered)

1. ✅ Enable HIBP in Lovable Cloud
2. ✅ Deploy `search_path` migration for 4 email functions
3. ✅ Remove or disable `PinGate` from `App.tsx`
4. ✅ Final smoke test: sign up, upload settlement, push to Xero, verify RLS
5. ✅ Publish

## Notes

- The `has_role()` function uses `SECURITY DEFINER` and bypasses RLS — safe for role checks
- `is_primary_admin()` dynamically looks up admin email from `system_config` — no hardcoded emails
- `assign_trial_role()` trigger on `auth.users` auto-assigns trial role + settings on signup
- All financial RPCs (`get_rolling_12_month_trend`, `get_channel_comparison`, etc.) are `SECURITY DEFINER` with `search_path` set
