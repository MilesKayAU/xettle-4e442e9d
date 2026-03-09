

# Settlement Workflow Manager — Implementation Plan

## Build Order (dependency chain)

### 1. Database Migration
Add two columns to `settlements`:
```sql
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS xero_invoice_number text,
  ADD COLUMN IF NOT EXISTS xero_status text;
```

### 2. Config Registration
Add to `supabase/config.toml`:
```toml
[functions.sync-xero-status]
verify_jwt = false
```

### 3. Feature 1 — Settlement Status Badges + Push States

**`settlement-engine.ts`**:
- Line 273: Change reference from `${label} Settlement ${periodLabel} (${s.settlement_id})` to `Xettle-${s.settlement_id}`. Move the human-readable text into the invoice Description field.
- Lines 309-316: After successful push, also save `xero_invoice_number: result.invoiceNumber`.
- Lines 319-321: On push failure, set `status = 'push_failed'` in DB.

**`GenericMarketplaceDashboard.tsx`**:
- Add `xero_invoice_number`, `xero_status` to `SettlementRow` interface and `loadSettlements` select.
- Replace `statusBadge()` (lines 60-76):
  - `saved`/`parsed` → yellow "Ready to push"
  - `synced`/`pushed_to_xero` with `xero_invoice_number` → green "In Xero (INV-XXXX)"
  - `synced_external` → grey "Already in Xero"
  - `push_failed` → red "Push failed"
- Push button states (lines 504-543):
  - `saved`: blue `[Push to Xero →]`
  - `synced`: green disabled `[✅ Pushed — INV-XXXX]`
  - `push_failed`: amber `[⚠️ Retry Push]` — resets status to `saved`, clears `xero_journal_id`, then calls `syncSettlementToXero()`
- Show Xero invoice number/status below settlement ID when available: `INV-0892 · Authorised ✅`

### 4. Feature 2 — Duplicate Prevention

**`GenericMarketplaceDashboard.tsx`** in `handlePushToXero`:
- Before calling `syncSettlementToXero`, if `xero_journal_id` already set, show confirmation dialog.
- Parse error from `syncSettlementToXero` — if contains `already exists in Xero`, show structured warning with invoice ID and "Void in Xero first" guidance instead of generic toast.

### 5. Feature 3 — Xero Sync Back

**New edge function: `supabase/functions/sync-xero-status/index.ts`**
- Accepts `{ userId }`, gets Xero token via same pattern as `sync-settlement-to-xero`.
- Two Xero API queries for backward compatibility:
  1. `GET /invoices?where=Reference.StartsWith("Xettle-")&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID`
  2. `GET /invoices?where=Reference.Contains("Settlement")&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID` (fallback for old-format references like `Big W Settlement ... (290994)`)
- For each invoice: extract `settlement_id` from `Xettle-{id}` or regex `/\(([^)]+)\)$/` for old format.
- Update `settlements` table: set `xero_invoice_number`, `xero_status`, `pushed_to_xero = true` (status → `synced`), `xero_journal_id`.
- Return count of updated records.

**`settlement-engine.ts`**: Add `syncXeroStatus(userId)` that invokes the edge function.

**`GenericMarketplaceDashboard.tsx`**: Add "Refresh from Xero" button in bulk actions bar. Call `syncXeroStatus` on mount (once per session via ref) and after every push.

### 6. Feature 4 — Monthly Status Overview Panel

**New component: `MonthlyReconciliationStatus.tsx`**
- Period selector: `[← February 2026 →]` defaulting to current month.
- Query settlements with overlap filter: `WHERE period_start <= monthEnd AND period_end >= monthStart`.
- Cross-reference with `marketplace_connections` to show all connected channels.
- **Missing detection**: marketplace_connections with zero settlements for the period shown as `⚠️ 2 missing — Kogan, Bunnings` with `"Upload now →"` link that switches to Smart Upload view.
- Table: Marketplace | Uploaded (count) | Pushed (count) | Xero Status.
- Footer: "X ready to push · Y already done · Z missing".

**`Dashboard.tsx`**: Mount `MonthlyReconciliationStatus` above `MarketplaceSwitcher` (line 265) when on settlements view. Pass `userMarketplaces`, `onSwitchToUpload`, `onSelectMarketplace` props.

### 7. Feature 5 — Push All Ready Button

**In `MonthlyReconciliationStatus`**:
- Collects all `saved`/`parsed` settlements for selected period.
- Confirmation dialog listing each with marketplace + net amount + total.
- Sequential push via `syncSettlementToXero()` (includes Xero duplicate check).
- Progress indicator: "Pushing 3 of 9..."
- Results summary: `✅ X pushed · ⚠️ Y duplicates skipped · ❌ Z failed`.
- Auto-refresh + call `syncXeroStatus()` after completion.

---

## Files Changed

| File | Action |
|------|--------|
| DB migration | Add `xero_invoice_number`, `xero_status` columns |
| `supabase/config.toml` | Register `sync-xero-status` function |
| `src/utils/settlement-engine.ts` | Standardize reference to `Xettle-{id}`, save invoice number, `push_failed` status, add `syncXeroStatus()` |
| `supabase/functions/sync-xero-status/index.ts` | New edge function — dual query for old+new reference formats |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Rich badges, duplicate warning, retry flow, Xero refresh, Xero status display |
| `src/components/admin/accounting/MonthlyReconciliationStatus.tsx` | New component — period selector, status table, missing detection with "Upload now →", push-all button |
| `src/pages/Dashboard.tsx` | Mount status panel above marketplace tabs |

