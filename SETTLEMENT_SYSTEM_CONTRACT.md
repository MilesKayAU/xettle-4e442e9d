# Settlement System Contract — Verified from Source Code

**Generated**: 2026-03-13  
**Verified against**: Live codebase (not external audit)

---

## 1. Canonical State Machine

Source of truth: `src/constants/settlement-status.ts`

```
ingested → ready_to_push → pushed_to_xero → reconciled_in_xero → bank_verified
                 ↓
           push_failed → push_failed_permanent
```

**Non-status columns** (never stored in `status`):
- `is_hidden` (boolean) — UI visibility
- `is_pre_boundary` (boolean) — before accounting boundary
- `duplicate_of_settlement_id` (text) — duplicate link
- `sync_origin` (text) — `'xettle'` or `'external'`

---

## 2. Function → Table Contract

### `fetch-amazon-settlements`

| Direction | Table | Fields | User-scoped |
|-----------|-------|--------|-------------|
| READ | `amazon_tokens` | `*` | ✅ `.eq('user_id', userId)` |
| READ | `app_settings` | `key, value` | ✅ `.eq('user_id', userId)` |
| READ | `settlements` | `settlement_id, period_start, period_end, bank_deposit` | ✅ `.eq('user_id', userId)` (line 463 cron, line 801 smart) |
| READ | `xero_accounting_matches` | `xero_invoice_id, xero_invoice_number, xero_status, matched_reference` | ✅ `.eq('user_id', userId)` |
| READ | `marketplace_validation` | `id, settlement_net` | ✅ `.eq('user_id', userId)` (line 960) |
| WRITE | `settlements` | upsert full row | ✅ `user_id` in payload + `onConflict: 'marketplace,settlement_id,user_id'` |
| WRITE | `settlement_lines` | delete + insert (idempotent) | ✅ `.eq('user_id', userId)` |
| WRITE | `settlement_unmapped` | delete + insert (idempotent) | ✅ `.eq('user_id', userId)` |
| WRITE | `marketplace_validation` | upsert by id or insert | ✅ `user_id` in payload |
| WRITE | `system_events` | insert | ✅ `user_id` in payload |
| WRITE | `sync_locks` | via RPC | ✅ `p_user_id` param |

**External APIs**: Amazon SP-API (settlement reports)  
**Status writes**: `ingested` only (auto-link may write `pushed_to_xero` or `reconciled_in_xero`)

### `sync-xero-status`

| Direction | Table | Fields | User-scoped |
|-----------|-------|--------|-------------|
| READ | `xero_tokens` | `*` | ✅ `.eq('user_id', userId)` |
| READ | `xero_accounting_matches` | `*` | ✅ `.eq('user_id', userId)` |
| READ | `settlements` | `settlement_id, marketplace, period_*, bank_deposit, status, ...` | ✅ `.eq('user_id', userId)` |
| READ | `app_settings` | cursor, cooldown | ✅ `.eq('user_id', userId)` |
| WRITE | `settlements` | `status, xero_journal_id, xero_invoice_id, xero_invoice_number, xero_status, bank_verified, bank_verified_at, sync_origin` | ✅ `.eq('user_id', userId)` |
| WRITE | `xero_accounting_matches` | upsert cache | ✅ `onConflict: 'user_id,settlement_id'` |
| WRITE | `app_settings` | cursor, cooldown, oldest_outstanding_date | ✅ `user_id` in payload |
| WRITE | `system_events` | insert | ✅ `user_id` in payload |

**External APIs**: Xero Invoices API (paginated queries + batch status check)  
**Status writes**: `pushed_to_xero`, `reconciled_in_xero` (+ `bank_verified=true` when PAID)

### `sync-settlement-to-xero`

| Direction | Table | Fields | User-scoped |
|-----------|-------|--------|-------------|
| READ | `xero_tokens` | `*` | ✅ `.eq('user_id', userId)` |
| READ | `app_settings` | account codes, tracking | ✅ `.eq('user_id', userId)` |
| READ | `xero_chart_of_accounts` | `account_code, account_name, account_type, is_active` | ✅ `.eq('user_id', userId)` |
| READ | `xero_accounting_matches` | duplicate guard | ✅ `.eq('user_id', userId)` |
| WRITE | `settlements` | `status` (rollback → `ready_to_push`) | ✅ `.eq('user_id', userId)` |
| WRITE | `xero_accounting_matches` | upsert on push | ✅ `onConflict: 'user_id,settlement_id'` |
| WRITE | `system_events` | balance check, attachment log | ✅ `user_id` in payload |

**External APIs**: Xero Invoices API (create/void), Xero Attachments API  
**Status writes**: `ready_to_push` (rollback only), ~~`mapping_error`~~ (⚠️ non-canonical — should be removed)

### `match-bank-deposits`

| Direction | Table | Fields | User-scoped |
|-----------|-------|--------|-------------|
| READ | `settlements` | `*` | ✅ `.eq('user_id', userId)` |
| READ | `bank_transactions` | `*` | ✅ `.eq('user_id', userId)` |
| WRITE | `payment_verifications` | upsert | ✅ `user_id` in payload, `onConflict: 'settlement_id,gateway_code'` |
| WRITE | `settlements` | `status, bank_verified, bank_verified_at, bank_verified_by` | ✅ `.eq('user_id', userId)` + `.in('status', ['pushed_to_xero', 'reconciled_in_xero'])` |
| WRITE | `system_events` | insert | ✅ `user_id` in payload |

**External APIs**: None (uses local `bank_transactions` cache)  
**Status writes**: `bank_verified` (score ≥ 90 individual or batch)

### `verify-payment-matches`

| Direction | Table | Fields | User-scoped |
|-----------|-------|--------|-------------|
| READ | `app_settings` | gateway settings | ✅ via authenticated client (RLS) |
| READ | `shopify_orders` | `total_price, gateway, processed_at` | ✅ via authenticated client (RLS) |

**External APIs**: Xero Bank Transactions API  
**Status writes**: **NONE** (read-only suggestions)  
**Tables written**: **NONE**

---

## 3. Ownership Rules — Who Writes What

| Field | Authorised Writers | Method |
|-------|-------------------|--------|
| `settlements.status = 'ingested'` | `fetch-amazon-settlements`, `fetch-shopify-payouts`, `auto-generate-shopify-settlements`, CSV upload (frontend) | upsert on create |
| `settlements.status = 'ready_to_push'` | `sync-xero-status` (step 6), `sync-settlement-to-xero` (rollback) | update where uncached |
| `settlements.status = 'pushed_to_xero'` | `sync-xero-status` (cache verify + reference match + fuzzy), `fetch-amazon-settlements` (auto-link), `fetch-shopify-payouts` (auto-link) | update |
| `settlements.status = 'reconciled_in_xero'` | `sync-xero-status` (PAID detection), `apply-xero-payment`, `fetch-amazon-settlements` (auto-link if PAID) | update |
| `settlements.status = 'bank_verified'` | `match-bank-deposits` (score ≥ 90) | update where status in ['pushed_to_xero','reconciled_in_xero'] |
| `settlements.status = 'push_failed'` | `auto-push-xero` | update on Xero API error |
| `settlements.status = 'push_failed_permanent'` | `auto-push-xero` (retry_count ≥ 3) | update |
| `settlements.xero_invoice_id` | `sync-xero-status`, `sync-settlement-to-xero`, `fetch-amazon-settlements` (auto-link) | update |
| `settlements.bank_verified` | `sync-xero-status` (PAID), `match-bank-deposits` (score ≥ 90) | update |
| `xero_accounting_matches.*` | `sync-xero-status` (all steps), `sync-settlement-to-xero` (on push) | upsert |
| `marketplace_validation.*` | `fetch-amazon-settlements`, `fetch-shopify-payouts`, `run-validation-sweep` | upsert/insert |
| `payment_verifications.*` | `match-bank-deposits` | upsert |

---

## 4. Idempotency Guarantees

| Table | Operation | Constraint | Retry Safe |
|-------|-----------|-----------|------------|
| `settlements` | upsert | `UNIQUE(user_id, marketplace, settlement_id)` | ✅ `ignoreDuplicates: true` |
| `settlement_lines` | delete + insert | delete by `(user_id, settlement_id)` first | ✅ |
| `settlement_unmapped` | delete + insert | delete by `(user_id, settlement_id)` first | ✅ |
| `settlement_id_aliases` | upsert | `UNIQUE(user_id, alias_id)` | ✅ |
| `xero_accounting_matches` | upsert | `UNIQUE(user_id, settlement_id)` | ✅ |
| `payment_verifications` | upsert | `onConflict: 'settlement_id,gateway_code'` | ✅ |
| `marketplace_validation` | read-then-update/insert | by `id` (update) or insert new | ⚠️ No hard constraint — relies on `.maybeSingle()` |
| `sync_locks` | atomic RPC | `UNIQUE(user_id, integration, lock_key)` | ✅ |

---

## 5. Deterministic vs Heuristic Matching

| Function | Match Type | Method | Can Overwrite Deterministic? |
|----------|-----------|--------|------------------------------|
| `sync-xero-status` Step 2 | **Deterministic** | Batch verify by `InvoiceID` from cache | N/A (already linked) |
| `sync-xero-status` Step 4 | **Deterministic** | Xero Reference → `Xettle-{id}` / `AMZN-{id}` / `LMB-*` | No — only writes if uncached |
| `sync-xero-status` Step 5 | **Heuristic** | Fuzzy: amount ±$5/5% + date ±7d + contact + fingerprint | **No** — only runs on settlements with no cache entry AND no reference hit. Confidence ≥ 0.6 required. |
| `match-bank-deposits` Pass 1 | **Heuristic** | Amount ±$0.50 + narration + date proximity. Score ≥ 90 = auto-apply | **No** — guarded by `.in('status', ['pushed_to_xero', 'reconciled_in_xero'])` |
| `match-bank-deposits` Pass 2 | **Heuristic** | Batch sum ±$1.00 + narration. Score ≥ 90 = auto-apply | Same guard as Pass 1 |
| `verify-payment-matches` | **Heuristic** | PayPal/Shopify order sums ±3% | **Never writes** — suggestions only |
| `fetch-amazon/shopify` auto-link | **Deterministic** | `xero_accounting_matches` pre-seeded reference | Yes — but only on first ingestion |

**Key safety**: Heuristic matches in `sync-xero-status` are guarded by `!cacheBySettlement.has(sid) && !seen.has(sid)`, preventing them from overwriting deterministic reference matches.

---

## 6. Known Issues (Fixed in This Session)

| Issue | Status | Fix |
|-------|--------|-----|
| `deriveStatus()` returns `{status, syncOrigin}` but was assigned directly to `status` field as an object | **FIXED** | Destructured to `.status` and `.syncOrigin` |
| `settlement_lines` / `settlement_unmapped` not idempotent on retry | **FIXED** | Delete before insert |
| `handleSync` auto-link block had broken variable scoping (`isXettleFormat` used outside its declaring block) | **FIXED** | Corrected brace placement |
| `match-bank-deposits` writes `bank_verified` status but not `bank_verified=true` column | **FIXED** | Added `bank_verified`, `bank_verified_at`, `bank_verified_by` |
| `sync-settlement-to-xero` writes non-canonical `mapping_error` status | **KNOWN** | Should log to system_events only |

---

## 7. Parser Duplication Assessment

| Location | Version | Runtime |
|----------|---------|---------|
| `src/utils/settlement-parser.ts` | `v1.7.1` | Browser (CSV upload) |
| `supabase/functions/fetch-amazon-settlements/index.ts` | `v1.7.1` (embedded) | Deno (API sync) |

**Risk**: If one is updated without the other, CSV uploads and API imports will produce different totals.

**Current mitigation**: `PARSER_VERSION` constant exists in both — manual comparison required.

**Structural constraint**: Deno edge functions cannot import from `src/`. The frontend parser uses `import { parseDateOrEmpty } from './date-parser'` which is unavailable in the edge function context. True code sharing requires a build step that doesn't exist in this architecture.

**Recommendation**: Accept duplication with version tracking. Add a CI check that compares `PARSER_VERSION` between both files and fails if they differ.

---

## 8. GST Divisor — Verified Correct

```typescript
const gstDivisor = 1 + (100 / gstRate); // gstRate=10 → 11
gstOnIncome = auIncome / gstDivisor;    // $1100 / 11 = $100
```

This is the standard Australian method for extracting GST from a **GST-inclusive** amount:
- Amazon reports all amounts GST-inclusive
- To extract GST: divide by 11 (for 10% GST)
- `$1100 / 11 = $100` GST ✓
- `$1100 - $100 = $1000` ex-GST ✓

The formula `1 + (gstRate / 100) = 1.10` would give the GST **multiplier** (ex-GST → inc-GST), not the **divisor** (inc-GST → GST component). The code is correct.
