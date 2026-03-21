

# Add New Amazon Compliance Items from Screenshots

## What exists now
7 items across 3 categories: code_architecture (3), data_protection (2), operational (2).

## New items to add (from screenshots)

### Category: `security_controls` (new — "Code & architecture — security controls")
1. **Network firewall + access control lists deny unauthorised IPs** — "Supabase has this via its own network layer — document it explicitly" → pre-mark compliant (Supabase handles this)
2. **Encryption in transit (TLS) and at rest for all data stores** — "Supabase handles this — confirm and document the config" → pre-mark compliant
3. **Access limited to approved internal users only (role-based)** — "No shared credentials; each person has an individual account with appropriate role" → pre-mark compliant (user_roles system exists)
4. **Audit log records every API call and every PII access event** — "Amazon may request these logs during a security assessment" → pre-mark compliant (api_call_log + auditedFetch)
5. **Circuit breaker: pause polling after N consecutive API failures** — "Prevents hammering a degraded API; required for DPP network protection" → pre-mark compliant (api_safe_mode exists)
6. **Anti-virus/malware on all end-user devices that access the system** — "A process/policy requirement — Amazon checks this in audits" → not compliant (process item, needs documenting)

### Category: `documentation` (new — "Documentation — what Amazon reviews")
7. **Data Protection Plan (DPP) document — custom to your stack** — "Specific to Supabase/Vercel/your infra. Vague answers get rejected" → not compliant
8. **Incident response plan (approved by senior manager, reviewed every 6 months)** — "Must include: incident types, response procedures, escalation path, notify Amazon within 24hrs" → not compliant
9. **Risk assessment reviewed annually by senior management** — "Must include threat/vulnerability assessment with likelihood and impact" → not compliant
10. **Vulnerability scan every 180 days; pen test every 365 days** — "Must scan code before each release too — document your process even if lightweight" → not compliant
11. **Use case description: specific, not generic (under 500 words)** — draft text provided → not compliant
12. **Website meets Amazon's public developer guidelines** — "xettle.app must have a product page describing the FBM bridge, privacy policy, and terms of service" → partially (privacy/terms exist, needs FBM product page)
13. **$1,400 USD annual SP-API subscription fee budgeted (from Jan 2026)** — "New fee for all third-party developers — confirm this is accounted for" → not compliant

### Category: `scope_decision` (new — "Private vs public app — your decision point")
14. **Decided: private app (your store only) vs public app (Appstore listing)** — "Private = no Appstore listing required, less scrutiny..." → not compliant
15. **Roles selected: which SP-API roles you're requesting** — "Only request what you actually use — unnecessary roles delay approval" → not compliant

## Changes

### 1. Database migration
Insert the 15 new items into `amazon_compliance_items` with appropriate categories and pre-set `is_compliant` for items we know are covered (items 1-5 above). Uses a subquery to get the admin user_id from `user_roles`.

### 2. UI update (`AmazonComplianceDashboard.tsx`)
- Add new category labels: `security_controls` → "Security Controls", `documentation` → "Documentation", `scope_decision` → "Scope Decision"
- Add category priority badges: "High priority", "Docs required", "Scope question" (matching the screenshot styling)
- Add a category selector dropdown when adding custom items (currently hardcoded to 'custom')
- Pre-populate the use case description draft text in the evidence_notes for item 11

### 3. Use case description draft
Store this in evidence_notes for the "Use case description" item:
> "Xettle automates Fulfilled-by-Merchant (FBM) order fulfilment by syncing Amazon orders to Shopify. When an Amazon order is placed, Xettle creates a corresponding draft order in Shopify with the order details. The merchant fulfils the order through their standard Shopify workflow, and Xettle automatically feeds the tracking number and carrier back to Amazon via the SP-API confirmShipment endpoint. This eliminates manual dual-platform management for merchants who use Shopify as their primary fulfilment hub but also sell on Amazon. The application requires the Orders role (to poll for new FBM orders), the Shipping role (to confirm shipment with tracking), and optionally Restricted Data access for buyer shipping addresses when the merchant needs to pre-populate customer details. Xettle is a private application used exclusively by a single Australian merchant."

## Files changed

| File | What |
|------|------|
| Database migration | Insert 15 new compliance items with categories and pre-set compliance status |
| `src/components/admin/AmazonComplianceDashboard.tsx` | Add 3 new category labels, priority badges per category, category selector in add form |

