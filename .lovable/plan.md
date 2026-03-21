

## Problem

The batch logic **is** sending 2 accounts at a time (BATCH_SIZE = 2) — the screenshot showing "batch 7 of 38" confirms this (75 accounts ÷ 2 ≈ 38 batches). However, the UI makes it look like everything fires at once because:

1. All rows stay visible with green checkmarks during sync — no visual distinction between "sent", "sending now", and "queued"
2. The progress text ("Sending batch 7 of 38…") is small and easy to miss
3. No per-row feedback showing which accounts have already been pushed vs which are still waiting

## Plan

### 1. Add per-row sync status indicators

Track which batch index each row belongs to and show three states in the Action column during sync:
- **Sent** (green check + "Sent") — batches already completed
- **Sending** (spinner) — current batch in flight
- **Queued** (clock/dash) — not yet sent

This requires passing `batchIndex` from progress into the modal state and computing each row's batch membership.

### 2. Improve progress bar messaging

Replace the small text with a more prominent strip:
- "Pushing 2 accounts at a time to stay within Xero rate limits"
- Bold the current batch count: **"Batch 7 of 38"**
- Show running tally: "12 created so far"

### 3. Add a pre-sync confirmation count

Before clicking Sync, show: **"This will push 75 new accounts to Xero in batches of 2 (≈ 38 API calls)"** so the user knows what to expect.

### Files changed

- `src/components/settings/XeroCoaSyncModal.tsx` — all three changes above

