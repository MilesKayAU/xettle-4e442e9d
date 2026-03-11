

## Audit Result: Signup Flow

### Status: Nearly Complete — 1 Remaining Bug

The core architecture is correct and working well. Here's the full assessment:

### What Works

1. **Xero OAuth** — Redirects to Xero, returns to `/xero/callback`, saves tokens, redirects to `/dashboard?connected=xero`. Dashboard detects this and opens wizard at step 2 (Marketplaces). Background `scan-xero-history` fires when user clicks Continue. Correct.

2. **Shopify OAuth** — Pre-filled domain (`mileskayaustralia.myshopify.com`), redirects to Shopify, returns to `/shopify/callback`, saves tokens, redirects to `/dashboard?connected=shopify`. Dashboard opens wizard at step 2 with `hasShopify=true`. Clicking Continue on Shopify card fires `fetch-shopify-payouts` + `scan-shopify-channels`. Correct.

3. **Amazon OAuth** — Redirects to Amazon SP-API, returns to `/amazon/callback`, saves tokens, redirects to `/dashboard?connected=amazon`. Dashboard opens wizard at step 2 with `hasAmazon=true`. Clicking Continue fires `fetch-amazon-settlements`. Correct.

4. **Background scans** — Fire-and-forget pattern works. `pendingScans` counter tracks in-flight scans. Results page shows sync banner when scans are running. Auto-retries at 5s and 15s. Correct.

5. **Unknown marketplace detection** — `scan-shopify-channels` detects sub-channels (eBay, TikTok, etc.) from order data. `run-validation-sweep` runs after each scan. Correct.

6. **Uncleared funds / settlements** — `scan-xero-history` finds existing Xero records. `fetch-amazon-settlements` and `fetch-shopify-payouts` pull settlement data. Results page shows gaps, ready-to-push counts, and already-in-Xero counts. Correct.

### Bug Found

**`Dashboard.tsx` line 69 (test mode path):** Still sets `setWizardInitialStep(3)` for Xero returns. Should be `2` to match the 4-step wizard. The production path (line 106) was already fixed.

### Known Limitations (unchanged from last audit)

- **Upload step is a no-op** — files collected in state are discarded on Continue. Real uploads happen via SmartUploadFlow on the dashboard. Acceptable for now.
- **Results polling stops after 2 retries** — scans taking >20s won't refresh on the Results page, but data appears on dashboard automatically.

### Fix

**`src/pages/Dashboard.tsx` line 69:**
Change `setWizardInitialStep(3)` to `setWizardInitialStep(2)` in the test mode block.

One line change. Everything else is working correctly.

