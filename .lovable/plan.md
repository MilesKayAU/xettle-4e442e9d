

## Analysis: Shopify Payments "Not Paid" + PayPal Reconciliation

### Why Shopify Payments from Jan/Feb Show as Unpaid

There are two likely reasons:

1. **Never pushed to Xero yet.** These settlements are sitting in `ready_to_push` status. They were ingested from the Shopify Payouts API, but nobody has clicked "Send to Xero" for them. The system correctly waits for manual push (Golden Rule). Once pushed and the Xero invoice reaches PAID status, the `sync-xero-status` function would auto-close them.

2. **Pushed but `bank_match_required` is blocking closure.** Shopify Payments rail is configured as `bank_match_required: true`, meaning the system expects a bank deposit match even after the Xero invoice is PAID. However, the code at `sync-xero-status` lines 396-414 already overrides this — when a Xettle invoice reaches PAID in Xero, it sets `bank_verified = true` and moves to `reconciled_in_xero` regardless of the rail config. So this shouldn't be the blocker.

**Most likely:** These are `ready_to_push` and simply haven't been sent to Xero yet. Or they may have been posted by an external tool (LMB) and the sync hasn't matched them.

### PayPal Strategy — No API Needed

PayPal is already connected to Xero as a bank account (visible in the screenshot as "Payment from/to" transactions). This means:

- **Xero already has the PayPal bank feed** — every PayPal transaction (Shopify purchases, hosting costs, outbound payments) appears as a Xero bank transaction.
- **The existing `fetch-xero-bank-transactions` function** already pulls these into the local `bank_transactions` cache when the PayPal account is included.
- **No PayPal API is needed.** Xero's bank feed IS the reconciliation source for PayPal.

PayPal handles mixed traffic (inbound Shopify sales + outbound hosting/subscriptions). The system should:
- Match inbound PayPal transactions against Shopify order totals (net of PayPal fees)
- Leave outbound payments (hosting, GitHub, etc.) to standard Xero reconciliation — these aren't settlements

### Proposed Changes

**1. Auto-trust Xero PAID status for Shopify Payments rail**
- Change `shopify_payments` in `RAIL_PAYOUT_MODE` from `bank_match_required: true` to `bank_match_required: false`
- Rationale: Once the Xero invoice is PAID (meaning the bank feed matched it in Xero), we don't need a second layer of bank matching in Xettle. Xero already confirmed it.

**2. Surface PayPal as a reconciliation-ready account in the UI**
- In the Payment Verification Settings, show PayPal's Xero bank account status (already detected via COA scan)
- Add a note: "PayPal transactions are reconciled via your Xero bank feed — no separate API required"

**3. Add a "Bulk Review" action for old Shopify settlements**
- For settlements older than 30 days still in `ready_to_push`, add a batch action: "Review & Push All" or "Mark as Already Reconciled" if they were handled externally
- This clears the Jan/Feb backlog without one-by-one clicking

### Files to Modify

| File | Change |
|------|--------|
| `src/constants/settlement-rails.ts` | Set `shopify_payments.bank_match_required` to `false` |
| `src/components/settings/PaymentVerificationSettings.tsx` | Add PayPal status note about Xero bank feed |
| `src/components/dashboard/RecentSettlements.tsx` | Add bulk action for stale `ready_to_push` settlements |
| `src/components/dashboard/ActionCentre.tsx` | Show count of stale settlements with prompt to review |

