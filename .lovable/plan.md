

## Settlement Detail Drawer — Immutable Audit Trail

### What We're Building

Two changes that close the bookkeeper trust gap:

1. **Store immutable payload snapshots** at posting time in `system_events.details` (both manual and auto-post paths)
2. **New `SettlementDetailDrawer` component** accessible from every settlement row in the Action Centre

No database schema changes needed — `system_events.details` (JSONB) already exists with proper RLS (`user_id = auth.uid()`).

---

### 1. Expand Snapshot at Post Time

**`src/utils/settlement-engine.ts`** (~line 910, `xero_push_success` event):
Replace the current minimal `{ invoice_id, invoice_number }` with:

```json
{
  "posting_mode": "manual",
  "xero_request_payload": { /* exact lineItems, contactName, reference, description, date, dueDate, netAmount */ },
  "xero_response": { "invoice_id": "...", "invoice_number": "...", "xero_status": "DRAFT", "xero_type": "invoice" },
  "normalized": {
    "net_amount": 10488.50,
    "currency": "AUD",
    "contact_name": "Amazon.com.au",
    "line_items": [
      { "description": "Sales", "account_code": "200", "tax_type": "OUTPUT", "amount": 12340.00 }
    ]
  }
}
```

The `lineItems` array and `contactName` are already in scope at line ~856. Capture them before invoking the function, then include in the event.

Add size protection: if `lineItems.length > 200`, set `truncated: true` and store only the first 200.

**`supabase/functions/auto-post-settlement/index.ts`** (~line 443, `auto_post_success` event):
Same structure. The `lineItems` array is built at line ~347 and `contactName` at ~309 — both in scope. Add the same normalized snapshot + raw request payload.

---

### 2. New Component: `SettlementDetailDrawer.tsx`

**File**: `src/components/shared/SettlementDetailDrawer.tsx`

A `Sheet` (side drawer) that accepts `settlementId: string`, `open: boolean`, `onClose: () => void`.

**Data fetching**:
- Fetch settlement row from `settlements` table by `settlement_id` + `user_id`
- Fetch `system_events` where `settlement_id` matches, ordered by `created_at`
- Find the `xero_push_success` or `auto_post_success` event → read `details.normalized.line_items` for the immutable snapshot

**Sections**:

| Section | Source |
|---------|--------|
| Header (ID, Rail, Period, Status, Xero Ref/Invoice#) | `settlements` row |
| Posted Payload — line items table with Description, Amount, Account Code, Tax Type | `system_events.details.normalized.line_items` |
| Net total + Bank deposit comparison | `settlements.bank_deposit` vs sum of line items |
| GST Summary (income/expense/net liability) | `settlements.gst_on_income`, `gst_on_expenses` |
| Audit Trail — chronological event list | All `system_events` for this `settlement_id` |
| Auto-post banner (if `posting_mode === 'auto'`) | Event details + link to Settings |

**Backward compatibility**: If no snapshot event exists (pre-change settlements), show reconstructed line items with a warning label: *"Reconstructed — posted before audit snapshots were introduced"*.

**Xero link**: Display `xero_invoice_id` prominently. No deep-link attempt (too brittle across Xero orgs).

---

### 3. Wire Click Handlers in ActionCentre

**`src/components/dashboard/ActionCentre.tsx`**:
- Add `selectedSettlementId` + `drawerOpen` state
- Add click handler on settlement rows in all cards: Ready to Push, All Good, Auto-post Failed, Uploaded — needs review
- Render `<SettlementDetailDrawer>` at the bottom of the component

---

### Files Changed

| File | Change |
|------|--------|
| `src/utils/settlement-engine.ts` | Expand `xero_push_success` event (~line 910) to include full snapshot |
| `supabase/functions/auto-post-settlement/index.ts` | Expand `auto_post_success` event (~line 443) to include full snapshot |
| **New**: `src/components/shared/SettlementDetailDrawer.tsx` | Drawer component |
| `src/components/dashboard/ActionCentre.tsx` | Add drawer state + click handlers |

No database migrations. No new tables. No edge function changes beyond the snapshot expansion.

