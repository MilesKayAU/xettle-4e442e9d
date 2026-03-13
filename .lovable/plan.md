

# Security & Reliability Fixes — Copilot Audit Response

This plan addresses the 10 findings from the GitHub Copilot audit, prioritized by risk.

---

## Priority 1: Security Fixes (Critical)

### 1. userId Spoofing in `fetch-shopify-orders`
**Confirmed.** Line 72: `const resolvedUserId = userId || authenticatedUserId;` — any authenticated user can pass another user's ID and query their Shopify tokens (RLS protects the DB query since the client is scoped to the caller's JWT, but this is still a design flaw that could bite if service-role clients are ever used).

**Fix:** Force `resolvedUserId = authenticatedUserId` always. Remove `userId` from the destructured body. The `scheduled-sync` function already calls with service-role headers, so it can pass `userId` — but we should branch: if service-role, accept body userId; otherwise, ignore it.

### 2. Shopify OAuth `state` = userId (CSRF risk)
**Confirmed.** Line 60: `state=${userId}`. The state parameter should be an unpredictable nonce.

**Fix:** Generate a `crypto.randomUUID()` nonce, store it in `app_settings` (key: `shopify_oauth_state`, value: `{nonce}:{userId}`), and validate on callback. Reject if state doesn't match a stored nonce.

### 3. CORS wildcard on auth endpoints
**Confirmed** across `xero-auth`, `shopify-auth`, `amazon-auth`, etc. These endpoints handle OAuth tokens.

**Fix:** Replace `*` with `https://xettle.app, https://xettle.lovable.app` on auth-sensitive functions. Keep `*` for non-sensitive functions (ai-assistant, ai-file-interpreter).

---

## Priority 2: API Correctness (High)

### 4. Xero Payment uses PUT instead of POST
**Confirmed.** Line 181 of `apply-xero-payment`: `method: 'PUT'`. Xero's API documentation specifies PUT for Payments creation (unlike most REST APIs), so this is actually **correct for Xero**. No change needed — but we should add a comment explaining this.

### 5. Amazon SP-API missing SigV4 signing
**Confirmed.** No SigV4 signing code exists anywhere in the codebase. Amazon SP-API with LWA (Login with Amazon) tokens does **not** require SigV4 for most endpoints when using `x-amz-access-token` — SigV4 is only required for grantless operations. The 429 rate-limit errors in logs confirm the API is responding (just throttled), so the auth method is working. **No change needed** but should document this.

### 6. Token refresh inconsistency
**Confirmed.** `fetch-xero-bank-transactions` returns `null` on failure; `apply-xero-payment` throws. Other functions have their own patterns.

**Fix:** Create a shared `refreshXeroToken()` helper pattern that always throws a structured error with the response body. Apply across all Xero-consuming functions.

---

## Priority 3: Reliability (Medium)

### 7. `xero_journal_id` storing invoice IDs
**Confirmed** in `fetch-shopify-payouts`: `xero_journal_id: preSeeded.xero_invoice_id`. This field naming confusion can cause downstream status-sync mismatches.

**Fix:** Add a DB migration to create `xero_invoice_id` column on settlements (nullable, text). Backfill from `xero_journal_id` where the value is actually an invoice ID. Update all consumers to use the correct field. Keep `xero_journal_id` for backward compat.

### 8. `scheduled-sync` timeout pattern
**Confirmed.** 45s per step with sequential fan-out per user. For multiple users or slow API days, this frequently aborts.

**Fix:** Increase `STEP_TIMEOUT_MS` to 90s (matching Xero cooldown pattern already in use). Add per-user early-exit if total elapsed > 4 minutes (edge function max ~5min). Log partial completions more clearly.

### 9. Shopify order dedup by `order.name`
**Confirmed** in `shopify-api-adapter.ts`. Order names can collide across shops or be edited.

**Fix:** Change dedup key to `order.id` (numeric, stable, unique per shop).

### 10. Fire-and-forget writes in `settlement-engine.ts`
**Confirmed.** Background writes use `.then(console.error)` without surfacing failures.

**Fix:** Collect errors into a `system_events` log entry. For critical writes (validation rows, profit calculations), await them and surface failures to the UI toast.

---

## Implementation Order

1. **Security fixes** (#1 userId spoofing, #2 OAuth state, #3 CORS) — these are the most critical
2. **Token refresh standardization** (#6) — prevents cascading auth failures
3. **Field naming + dedup fixes** (#7, #9) — data correctness
4. **Timeout + error surfacing** (#8, #10) — reliability
5. **Comments/docs** (#4 Xero PUT, #5 SigV4) — no code change needed

Total: ~8 edge function edits, 1 migration, 2 utility file edits.

