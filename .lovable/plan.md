

## Diagnosis

Two separate issues found:

### Issue 1: verify-mirakl-settlement 401
The edge function logs show ALL auth variants failing with 401 against `marketplace.bunnings.com.au`. The stored API key (`J@cobGuy1996...`) appears to be a password rather than a proper Mirakl API key. However, `fetch-mirakl-settlements` successfully created a `mirakl_api` settlement on March 23 using the same credential and same endpoint, so the key was valid 2 days ago. This is likely a credential expiry or rotation on Bunnings' side.

**Before any code changes**: You need to verify your Bunnings Mirakl API key is still valid. Log into marketplace.bunnings.com.au seller portal and check if the API key has been rotated or expired. If it has, update it in Settings > API Connections.

### Issue 2: Auto-correction not triggering
The scheduled-sync orchestrator DOES call `fetch-mirakl-settlements` (Step 4.7, line 340), but it only runs if the elapsed time hasn't exceeded 4 minutes. Looking at the system_events, there are zero `mirakl_fetch_complete` events — the Mirakl step is being skipped every cycle due to the elapsed timeout (Amazon, eBay, Shopify all run first and consume the time budget).

### Plan (code changes needed)

**Step 1 — Fix Mirakl priority in scheduled-sync**
Move the Mirakl fetch step earlier in the pipeline (before Shopify channel scan) or add an independent elapsed check that ensures Mirakl gets at least one attempt per cycle. Currently Amazon (Step 4), eBay (Step 4.5), and Shopify (Step 5) consume the entire 4-minute budget, so Mirakl at Step 4.7 is always skipped.

**Step 2 — Add mirakl_fetch_complete event logging**
The fetch-mirakl-settlements function does not log a `mirakl_fetch_complete` system_event like the other fetch functions do. Add this so the Data Integrity scanner can track Mirakl sync freshness.

**Step 3 — Credential validation surface**
The verify function's 401 retry loop is correct but the underlying credential is rejected. No code fix will resolve this — the user needs to re-validate or re-enter their Bunnings API key. Add a clearer error message in the UI: "Your Bunnings API key was rejected — please verify it's still valid in the Bunnings seller portal and update in Settings > API Connections."

### Technical detail

```text
Current pipeline order (4-min budget):
  Step 1: Xero audit
  Step 2: Bank txns
  Step 3: Sync windows
  Step 4: Amazon           ← often takes 60-90s
  Step 4.5: eBay           ← often takes 30-60s
  Step 4.7: Mirakl         ← STARVED (timeout reached)
  Step 5: Shopify          ← sometimes runs
  Step 5.5: Channel scan

Proposed: Interleave Mirakl with eBay (both are fast) or add a
per-step time budget so each rail gets at least one attempt.
```

