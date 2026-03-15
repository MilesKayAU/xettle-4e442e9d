

## Problem Analysis

The Insights tab has **three distinct issues**:

### 1. Corrupted Kogan Settlement Data
8 out of 24 Kogan settlements have catastrophically wrong values — `sales_principal` of -$174M, `seller_fees` of $7.3M, `bank_deposit` of $0. These were uploaded via the generic CSV parser before the Kogan fingerprint was added. The column mapping was wrong (likely AI-guessed), causing fields like `Commission Fee` to be mapped to `gross_sales` and vice versa. This corrupted data poisons every chart and aggregate figure.

### 2. InsightsTab Location
The InsightsTab sits inside the per-marketplace `AccountingDashboard` (which is navigated to via e.g. "Amazon AU Settlements"), but it shows **cross-marketplace** data from all settlements. This is confusing — it appears "inside Amazon" but shows Kogan, BigW, Bunnings, etc.

### 3. RPC Functions Don't Filter by Marketplace
All four SQL functions (`get_marketplace_fee_analysis`, `get_gst_liability_by_quarter`, `get_rolling_12_month_trend`, `get_channel_comparison`) query across ALL settlements for the user without any marketplace filter. Since the tab is inside a marketplace-specific view, the data shown doesn't match the context.

---

## Plan

### Step 1 — Clean corrupted Kogan data
Run a migration to mark the 8 corrupted Kogan settlements (where `ABS(sales_principal) > 10000` and `bank_deposit = 0`) as hidden. These were parsed with wrong column mappings and cannot be trusted. The user can re-upload them using the new Kogan fingerprint.

```sql
UPDATE settlements 
SET is_hidden = true, 
    posting_error = 'auto-hidden: corrupted column mapping from pre-fingerprint upload'
WHERE marketplace = 'kogan' 
  AND ABS(sales_principal) > 10000 
  AND bank_deposit = 0
  AND is_hidden = false;
```

### Step 2 — Move InsightsTab to top-level navigation
Move the Insights tab out of the per-marketplace `AccountingDashboard` and into the top-level `Admin` page navigation (alongside Dashboard, Outstanding, Upload, Settlements). This makes it clear that Insights is a cross-marketplace view, not scoped to one marketplace.

| File | Change |
|------|--------|
| `src/pages/Admin.tsx` | Add "Insights" as a top-level tab/route |
| `src/components/admin/accounting/AccountingDashboard.tsx` | Remove the `insights` tab from the per-marketplace sub-tabs |

### Step 3 — Add marketplace filter parameter to RPC functions (optional enhancement)
Update the four SQL functions to accept an optional `p_marketplace` parameter. When provided, filter results to that marketplace only. When NULL, show all. This enables both the cross-marketplace overview and future per-marketplace drilldowns.

