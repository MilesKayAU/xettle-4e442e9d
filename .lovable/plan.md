
# Marketplace Intelligence Engine — Build Plan

## What's being built
A settlement-driven intelligence layer: every time a settlement is saved, Xettle automatically extracts fee observations, builds a per-user fee profile, and flags anomalies. No scraping. AI learns from real financial data.

## Database migration — 3 new tables

### `marketplaces` (system-level knowledge, admin-managed)
| Column | Notes |
|--------|-------|
| `marketplace_code` UNIQUE | `amazon_au`, `bunnings_au` |
| `name` | Display name |
| `settlement_frequency` | `weekly` / `fortnightly` / `monthly` |
| `gst_model` | `seller` / `marketplace` / `mixed` |
| `payment_delay_days` | integer |
| `currency` | `AUD` default |
| `is_active` | boolean |

RLS: authenticated users SELECT; admins INSERT/UPDATE/DELETE via `has_role('admin')`.
Seeded immediately with Amazon AU and Bunnings AU.

### `marketplace_fee_observations` (one row per fee per settlement)
| Column | Notes |
|--------|-------|
| `user_id` | owner |
| `marketplace_code` | `amazon_au`, `bunnings` |
| `settlement_id` | links to `settlements.settlement_id` |
| `fee_type` | controlled: `commission`, `referral`, `fba_fulfilment`, `storage`, `refund_rate`, `shipping_fee`, `transaction_fee` |
| `fee_category` | `settlement` / `tax` / `fees` / `shipping` |
| `observed_rate` | numeric (e.g. 0.1249) — nullable for fixed-amount fees |
| `observed_amount` | numeric |
| `base_amount` | what the rate was calculated from |
| `currency` | `AUD` / `USD` etc. |
| `observation_method` | `parser` / `derived` / `manual` |
| `period_start`, `period_end` | from the settlement |

RLS: users can SELECT/INSERT/DELETE their own rows.

### `marketplace_fee_alerts` (anomaly flags)
| Column | Notes |
|--------|-------|
| `user_id` | |
| `marketplace_code` | |
| `settlement_id` | the triggering settlement |
| `fee_type` | |
| `expected_rate` | historical average |
| `observed_rate` | new value |
| `deviation_pct` | e.g. 0.25 = 25% higher |
| `status` | `pending` / `acknowledged` / `dismissed` |

RLS: users SELECT/UPDATE own rows; admins SELECT all via `has_role('admin')`.

---

## New utility: `src/utils/fee-observation-engine.ts`

### `extractFeeObservations(settlement, userId)`
Called after `saveSettlement()` returns `{ success: true }`. Inserts observations into the DB.

**For Bunnings** (uses `sales_principal` + `seller_fees` from StandardSettlement):
```
commission: rate = Math.abs(fees_ex_gst) / sales_ex_gst
```

**For Amazon AU** (uses saved settlement fields):
```
referral:       rate = Math.abs(seller_fees)  / sales_principal
fba_fulfilment: rate = Math.abs(fba_fees)     / sales_principal
storage:        amount = Math.abs(storage_fees)  (no rate — absolute cost)
refund_rate:    rate = Math.abs(refunds)       / sales_principal
```

Skips observations where `base_amount < 100` (prevents noise from tiny test uploads).

### `detectAndSaveAnomalies(userId, marketplace_code, newObservations)`
For each rate-based observation:
1. Query last N observations for same `user_id + marketplace_code + fee_type`
2. If fewer than 3 prior observations → skip
3. Compute rolling avg
4. If `Math.abs(newRate - avgRate) / avgRate > 0.15` → insert `marketplace_fee_alerts` with `status = 'pending'`

---

## Hook point in `settlement-engine.ts`

After the successful `supabase.from('settlements').insert(...)`, add:
```ts
// Fire-and-forget — doesn't block the save
extractFeeObservations(settlement, user.id).catch(console.error);
```
This keeps `saveSettlement()` fast and non-breaking even if observation extraction fails.

---

## New user-facing components

### `src/components/MarketplaceInfoPanel.tsx`
Compact read-only card. Two data sources:
1. `marketplaces` table — static profile (GST model, settlement cycle, payment delay)
2. Aggregate query on `marketplace_fee_observations` — user's actual avg rates + COUNT for sample_count

```text
┌──────────────────────────────────────────┐
│  Bunnings                                 │
│  Settlement cycle: Fortnightly            │
│  GST: Seller responsible                 │
│  Your avg commission: 12.5% (3 settlements) │
│  Payment delay: ~14 days                 │
└──────────────────────────────────────────┘
```

### `src/components/MarketplaceAlertsBanner.tsx`
Shows when `marketplace_fee_alerts` has `pending` rows for current user + marketplace:
```text
⚠️ Bunnings commission 25% above your average (12.5% vs 10.0%) — Settlement BUN-123  [View] [Dismiss]
```

Both injected into `BunningsDashboard.tsx` and `AccountingDashboard.tsx` near the top.

---

## Admin Panel: Marketplace Config tab

Wrap `Admin.tsx` content in `<Tabs>` (Users | Marketplace Config).

New file: `src/components/admin/marketplace/MarketplaceConfigTab.tsx`
- **Left column**: list of marketplaces from the `marketplaces` table
- **Right panel**:
  - Edit profile fields (settlement frequency, GST model, payment delay, currency)
  - All users' fee alerts with user email visible (admin-level SELECT policy on `marketplace_fee_alerts`)

---

## Files summary

| Action | File |
|--------|------|
| Create migration | `supabase/migrations/..._marketplace_intelligence.sql` |
| Create | `src/utils/fee-observation-engine.ts` |
| Create | `src/components/MarketplaceInfoPanel.tsx` |
| Create | `src/components/MarketplaceAlertsBanner.tsx` |
| Create | `src/components/admin/marketplace/MarketplaceConfigTab.tsx` |
| Modify | `src/utils/settlement-engine.ts` — hook extraction after save |
| Modify | `src/pages/Admin.tsx` — add Tabs + Marketplace Config tab |
| Modify | `src/components/admin/accounting/BunningsDashboard.tsx` — add panels |
| Modify | `src/components/admin/accounting/AccountingDashboard.tsx` — add panels |

## What this does NOT do
- No external scraping
- No automatic rule changes — anomalies are flagged for human review
- Amazon settlement saving path (the complex multi-step flow in `AccountingDashboard`) hooks via `StandardSettlement` through `settlement-engine.ts`, so the same extraction function covers all marketplaces
