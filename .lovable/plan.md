

## Settlement-First UX and Invoice Model Messaging

### What we're solving

With the Source Push Gate now blocking Shopify-derived marketplace pushes, CSV settlement uploads are the **only** path to Xero for those channels. The UX needs to reflect this urgency. Additionally, the codebase has a stale "journals" reference and lacks clear invoice-vs-journal positioning.

---

### Changes

**1. WelcomeGuide.tsx — Fix "journals" copy to "invoices"**
- Line 96: change `"One click pushes perfectly formatted journals to Xero"` to `"One click pushes a verified DRAFT invoice to Xero"`.
- This is the only place in the app that says "journals" in user-facing copy.

**2. DailyTaskStrip.tsx — Add settlement urgency context**
- Add a 6th informational strip below the 5-stage grid when there are marketplaces with no recent settlements (e.g., "2 marketplaces have no settlement in the last 30 days — upload now for faster Xero visibility").
- This queries `marketplace_connections` vs `settlements` to detect gaps.
- The strip links to the upload view.

**3. Landing.tsx — Add "Invoice Model" differentiator section**
- Add a compact section (between the "Why Xettle is different" and "Post to Xero safely" sections, around line 345) titled something like: **"Invoices, not journals. Simpler books."**
- Content: 2-column layout. Left: explain the invoice model (one DRAFT invoice per settlement, line items for sales/fees/refunds, maps to bank deposit, your accountant reviews). Right: explain why journals are harder (journal entries split across multiple accounts, harder to reconcile, harder to audit, no bank feed match).
- Keep it concise — 4-6 bullet points per column.

**4. Landing.tsx — Update "Settlement-first accounting" card copy**
- Line 328: strengthen the existing card to emphasize "the faster you upload settlements, the faster your books are done in Xero."

**5. Dashboard ActionCentre — Add "Missing Settlements" prominence**
- The ActionCentre already has a `MissingSettlement` interface and an `onSwitchToUpload` that accepts missing settlements. Verify and enhance the missing settlement detection to show a prominent amber banner at the top of ActionCentre when there are marketplaces overdue for a settlement, with copy like: "3 marketplace settlements are overdue — upload them to get invoices into Xero."

**6. AdminHeader.tsx — Add invoice model badge**
- Below the existing admin warning card, add a small info strip: "Xettle uses a 1:1 invoice model — each settlement becomes one DRAFT invoice in Xero. No journals. No clearing accounts."
- This serves as a constant reminder in the admin area.

**7. SettlementsOverview.tsx — Add settlement urgency indicators**
- For marketplaces with status `no_recent_data` or `never_sent`, show a more prominent amber/red indicator with copy: "No settlement uploaded — Xero has no visibility for this marketplace."

---

### Files to change

| # | File | Change |
|---|------|--------|
| 1 | `src/components/dashboard/WelcomeGuide.tsx` | "journals" → "invoices" |
| 2 | `src/components/dashboard/DailyTaskStrip.tsx` | Add missing-settlement urgency strip |
| 3 | `src/pages/Landing.tsx` | Add "Invoices, not journals" section + strengthen settlement-first card |
| 4 | `src/components/dashboard/ActionCentre.tsx` | Enhance missing settlement banner prominence |
| 5 | `src/components/admin/AdminHeader.tsx` | Add invoice model info strip |
| 6 | `src/components/admin/accounting/SettlementsOverview.tsx` | Strengthen "no data" states |

### No migrations, no edge function changes

