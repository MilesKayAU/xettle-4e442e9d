

## Shopify App Store Review Readiness Assessment

### What you already have
- Privacy Policy page at `/privacy` — but it only mentions Amazon and Xero, not Shopify
- Terms of Service page at `/terms` — same issue, no Shopify mentions
- Working install flow with HMAC verification
- Auth page with Shopify-aware signup/signin flow
- Routes are publicly accessible (no PIN gate blocking)

### What Shopify reviewers require (and gaps)

**1. Privacy Policy — needs Shopify-specific updates**
Your current policy mentions Amazon and Xero but does not mention Shopify at all. Shopify requires your privacy policy to explicitly cover:
- What Shopify merchant data you access (store name, orders, payouts, products)
- How you use that data
- How you store and protect OAuth tokens
- Data retention and deletion policy for Shopify data
- GDPR/privacy compliance webhooks (see item 5)

**2. Terms of Service — needs Shopify-specific section**
Similar gap — no mention of Shopify integration, store data access, or merchant responsibilities.

**3. GDPR Mandatory Webhooks**
Shopify requires all apps to handle three mandatory compliance webhooks:
- `customers/data_request` — return what data you hold for a customer
- `customers/redact` — delete customer data
- `shop/redact` — delete all shop data after uninstall

You do not currently have edge functions for these. Shopify will reject the app without them.

**4. App Uninstall Webhook**
Shopify expects apps to handle `app/uninstalled` — clean up tokens and stop syncing when a merchant uninstalls. You don't have this.

**5. Testing access for Shopify reviewers**
Your app is behind a PIN gate (`PinGate` component). Shopify reviewers need to be able to:
- Install the app from the App Store listing
- Sign up / sign in
- Complete the OAuth flow
- See the connected Shopify store in the dashboard

The install flow redirects to `/auth` which is not PIN-gated (routes inside `PinGate` are the authenticated ones). So the install + auth flow should work. But after login, reviewers hit the PIN gate on the dashboard. You'll need to either provide them the PIN or ensure test mode works for their session.

**6. App listing assets**
Shopify requires: app icon (128x128), screenshots of key features, a short and long description, and a support email/URL.

### Plan: Shopify Review Readiness

**Step 1 — Update Privacy Policy**
Add sections covering Shopify data: what merchant data is accessed, how OAuth tokens are stored, data retention, and deletion rights. Keep existing Amazon/Xero sections.

**Step 2 — Update Terms of Service**
Add a "Shopify Integration" section parallel to the existing Xero section, covering store data access authorisation and merchant responsibilities.

**Step 3 — Create GDPR compliance webhooks (3 edge functions)**
- `shopify-gdpr-customers-data-request` — returns stored data for a customer
- `shopify-gdpr-customers-redact` — deletes customer-specific data
- `shopify-gdpr-shop-redact` — deletes all data for a shop (tokens, settlements, settings)

These can be minimal initially (acknowledge the request, log it, process deletion) since Shopify just needs them to respond with 200.

**Step 4 — Create app/uninstalled webhook**
Edge function `shopify-uninstall` that receives the webhook, verifies HMAC, and marks the shop's token as inactive (or deletes it).

**Step 5 — Remove debug logging from shopify-install**
The `DEBUG shopify-install` and `DEBUG hmac result` console.logs leak secret prefixes and should be removed before review.

**Step 6 — Provide reviewer test instructions**
Prepare a test account or provide the PIN in the Shopify app submission notes so reviewers can access the dashboard after install.

### Technical details

- GDPR webhook URLs are configured in the Shopify Partner Dashboard under "App setup > Privacy" — not in code
- All three GDPR endpoints and the uninstall webhook must verify the Shopify HMAC header (`X-Shopify-Hmac-Sha256`) using the existing `verifyShopifyHmac` utility
- The webhooks receive POST requests with JSON bodies, not query-string HMAC like the install flow — the HMAC is computed over the raw request body

