

# Code Review: Architecture Alignment

## Status of the 3 requested fixes

### 1. PushSafetyPreview bypass elimination — DONE
All 4 previously-bypassing components now route through PushSafetyPreview:

| Component | How it works now |
|-----------|-----------------|
| `BunningsDashboard` (L478-504) | `openPushPreview()` → sets `previewSettlements` + `previewOpen=true` → `handlePreviewConfirm` only called from modal's `onConfirm` |
| `ShopifyOrdersDashboard` (L402-431) | `handlePushAllToXero()` → opens modal → `handlePreviewConfirm` from `onConfirm` |
| `MonthlyReconciliationStatus` (L120-150) | Opens modal → `handlePreviewConfirm` from `onConfirm` |
| `AccountingDashboard` (L1242-1247) | `onSyncToXero` callback disabled with toast redirecting to Settlements Overview |
| `ValidationSweep` (L760+) | Already renders `<PushSafetyPreview>`, `executePush` called from `onConfirm` |
| `SettlementsOverview` | Already gated via `<PushSafetyPreview>` |

**Verdict: No bypass paths remain.** Every `syncSettlementToXero()` call is inside a `handlePreviewConfirm` callback triggered only by the modal.

### 2. Contact fallback removal — DONE
`sync-settlement-to-xero/index.ts` L926-958:
- `SERVER_MARKETPLACE_CONTACTS` map with 13 entries (no generic fallback)
- If `!resolvedContact` → logs `xero_push_blocked` system event → throws `missing_contact_mapping` error
- Invoice is never created for unmapped marketplaces

**Verdict: Impossible to silently post to "Amazon.com.au" for a non-Amazon settlement.**

### 3. DRAFT-only — Confirmed
L966: `Status: "DRAFT"` — hardcoded, no conditional path.

---

## Issues and gaps found during review

### Issue 1: `auto-push-xero` has a stale MARKETPLACE_CONTACTS map
`auto-push-xero/index.ts` L21-34 has its own `MARKETPLACE_CONTACTS` map that won't stay in sync with the one in `sync-settlement-to-xero`. This is technically dead code (function is hard-blocked at L66), but if ever re-enabled, it would have a different contact list.

**Recommendation**: Leave as-is since the function is permanently blocked. Add a comment noting it's dead code.

### Issue 2: `auto-post-settlement` edge function has its own contact map
Same duplication risk. Needs audit if that function is ever used.

### Issue 3: Contact map in `settlement-engine.ts` (client) vs edge function (server)
`settlement-engine.ts` L32-43 has 9 entries. `sync-settlement-to-xero` L927-943 has 13 entries (adds `amazon_us`, `amazon_uk`, `amazon_ca`, `everyday_market`). These should stay in sync — the client map is used by PushSafetyPreview for the amber/green contact check.

**Recommendation**: Add the 4 missing entries to `settlement-engine.ts` MARKETPLACE_CONTACTS so the preview shows green instead of amber for those marketplaces.

### Issue 4: No `theiconic` or `etsy` in server contact map
`auto-push-xero` L31-33 has `theiconic` and `etsy`. The main `sync-settlement-to-xero` L927-943 has `ebay_au` and `everyday_market` but is missing `theiconic` and `etsy`.

**Recommendation**: Add `theiconic: 'THE ICONIC'` and `etsy: 'Etsy'` to the server map in `sync-settlement-to-xero`.

### Issue 5: Tolerance / reserves not modeled
Your positioning doc mentions reserves, chargebacks, FX rounding. Currently the system has a hard $0.10 tolerance in reconciliation but no concept of:
- Marketplace reserves (held back from payout)
- Chargebacks (post-settlement adjustments)
- Multi-currency

This is fine for now but worth noting as a future gap.

---

## Alignment with your architectural summary

| Rule | Status | Evidence |
|------|--------|----------|
| Only settlements create entries | Enforced | `settlementId` required (L634), no order→invoice path exists |
| Orders never create invoices | Enforced | Structural (no code path) |
| Payments never create invoices | Enforced | Structural (no code path) |
| Server rebuild authoritative | Enforced | `lineItemsSource: 'server_rebuilt'` typed literal |
| Invoice always DRAFT | Enforced | L966 hardcoded |
| Attachment required | Enforced | L1110-1235 failure states |
| Preview required for manual push | Enforced | All 6 UI paths go through PushSafetyPreview |
| Per-marketplace contact | Enforced | Hard error on missing mapping (L947-958) |
| Auto-push blocked | Enforced | L66-75 early return with `golden_rule_enforced` |

---

## Recommended next improvements (priority order)

### 1. Sync MARKETPLACE_CONTACTS across client + server
Add `theiconic`, `etsy`, `amazon_us`, `amazon_uk`, `amazon_ca`, `everyday_market` to `settlement-engine.ts` so preview validation matches server behavior.

### 2. Accountant workflow: Exceptions inbox
Surface `xero_push_blocked`, `xero_attachment_failed`, `missing_contact_mapping` system events in a dedicated UI panel. This is your biggest trust-building feature for accountants.

### 3. Period close / month lock
Allow locking a month so no new pushes can be made for that period. Export audit pack (all settlements + CSVs + hashes) for the locked period.

### 4. Safe repost workflow
Void old invoice → rebuild from settlement → push new DRAFT → maintain audit trail linking old and new invoice IDs.

### 5. Tolerance model for reserves
Add a `reserves` or `adjustments` field to the settlement schema to handle marketplace holdbacks without breaking the "invoice = payout" invariant.

