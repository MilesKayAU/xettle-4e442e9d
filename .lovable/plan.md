

## Current State: You Already Have a Cache-First Architecture (Mostly)

Your system already implements the pattern you're describing for several data sources. Here's the audit:

### What's Already Cached (Database-First)

| Data | Cache Table | TTL | API Call Trigger |
|------|------------|-----|-----------------|
| Xero Outstanding Invoices | `outstanding_invoices_cache` | 30 min | Manual refresh or stale cache |
| Xero Bank Transactions | `bank_transactions` | Date-range based | Scheduled sync only |
| Settlements (Amazon/eBay/Shopify) | `settlements` | Permanent | Sync fetches new ones, never re-fetches old |
| Marketplace Validation | `marketplace_validation` | Permanent | Validation sweep recalculates |
| Xero Accounting Matches | `xero_accounting_matches` | Permanent | Incremental scan |

### What Still Makes Live API Calls on Page Load

| View | What Happens | Problem |
|------|-------------|---------|
| **Outstanding tab** (Awaiting Payment) | Calls `fetch-outstanding` edge function → checks cache TTL → hits Xero API if >30 min stale | Works well already |
| **Settlements → per-row Sync** | Calls marketplace API directly | Fixed in last change to use `runDirectMarketplaceSync` |
| **Xero COA refresh** | Calls `refresh-xero-coa` on demand | On-demand only, fine |

### Assessment: Your System Is Already Doing This

The `scheduled-sync` cron pipeline already runs daily and syncs:
1. Xero invoice statuses → stored in `outstanding_invoices_cache`
2. Bank transactions → stored in `bank_transactions`
3. Amazon/eBay/Shopify settlements → stored in `settlements`
4. Validation sweep → stored in `marketplace_validation`
5. Bank deposit matching → stored in `payment_verifications`

**Every page view reads from the database first.** The Outstanding tab has a 30-min TTL before hitting Xero again. Settlement data is permanent once fetched.

### What Could Be Improved (Low Effort, High Impact)

The one gap is: **the `scheduled-sync` cron needs to actually be scheduled.** Right now it only runs when manually triggered or when a user clicks "Sync". There's no `pg_cron` job set up to run it daily.

### Recommendation: Set Up Daily Automated Sync

Create a `pg_cron` job that calls `scheduled-sync` once per day (e.g. 2:00 AM AEST). This ensures:
- All marketplace settlements are fetched incrementally (only new data since last sync)
- Xero invoice statuses are refreshed
- Bank transactions are updated
- Validation sweep runs
- No user action required
- Every page load for the rest of the day reads from local database — zero API calls

**This is exactly what you're describing.** The infrastructure is already built. We just need to wire up the cron trigger.

### Will This Exhaust More API Calls?

**No — it will reduce them.** Right now, API calls happen reactively (user clicks sync, opens a page). With a daily cron:
- One batch of API calls at 2 AM covers the whole day
- All page loads serve from cache
- Manual syncs still work as an override for urgent refreshes
- The smart sync window already limits fetch ranges to only unresolved data

### Speed Impact

**Pages will load faster.** Every view already reads from local tables first. With fresh daily data, the cache TTL checks will almost always pass, meaning zero edge function calls on page load.

### Implementation

1. **Create a `pg_cron` job** via SQL (not a migration — contains project-specific URLs):
   - Schedule: `0 16 * * *` (2:00 AM AEST = 4:00 PM UTC)
   - Calls: `scheduled-sync` edge function
   - Uses the service role key for auth

2. **Optionally reduce the Outstanding cache TTL** from 30 min to 2 hours (since daily sync keeps it fresh) — fewer redundant Xero API calls during the day.

No new tables, no new edge functions, no component changes needed.

