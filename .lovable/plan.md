

# Strict "Send to Xero" — Only `ready_to_push`

## Problem
The current query (line 147) includes `ingested` settlements in the "Send to Xero" card. `ingested` means "parsed/uploaded" — not "validated and safe to post." This risks surfacing settlements with missing mappings, unconfirmed splits, or mismatched totals.

## Changes — `src/components/dashboard/ActionCentre.tsx`

### 1. Restrict the settlements query to `ready_to_push` only
Line 147: change `.in('status', ['ingested', 'ready_to_push'])` to `.eq('status', 'ready_to_push')`.

### 2. Add a second query for `ingested` (uploaded, needs review)
Add a parallel query filtering `status = 'ingested'` with the same hidden/boundary/duplicate guards. Store in new state `ingestedSettlements`.

### 3. Add an "Uploaded — needs review" section
Below the "Send to Xero" card, render a smaller card/section showing `ingestedSettlements` count with a label like "Uploaded — needs review" and a CTA button linking to Settlement Matching (`onSwitchToSettlements`). This gives visibility without implying posting readiness.

### 4. No backend changes
The `ingested → ready_to_push` promotion already happens in the validation sweep / matching engine. This is purely a UI gating change.

## Result
- "Send to Xero" = only settlements validated and safe to post (matches Link My Books "Ready to Post")
- "Uploaded — needs review" = ingested items visible but clearly separated
- No risk of posting unvalidated entries

