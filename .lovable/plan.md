

## Plan: Expand Privacy Policy with Amazon SP-API Data Handling Section

### Why
Amazon's developer review requires a public URL documenting how Amazon data (including PII) is collected, processed, stored, and disposed. The current privacy page mentions Amazon only briefly. We need a dedicated section modelled on the Shopify section (5a) that covers all points from the security assessment.

### What Changes

**File: `src/pages/Privacy.tsx`**

1. **Expand the Amazon entry in Section 5** to reference the new dedicated section (5b)

2. **Add new Section 5b: Amazon Selling Partner API Data** after Section 5a, covering:
   - **Data collected**: Settlement reports, financial events, order data (order IDs, amounts, fees, fulfilment channel), and — where restricted access is granted — buyer name, email, and shipping address (PII)
   - **Purpose**: Settlement reconciliation with Xero, GST/BAS compliance, fulfilment tracking, fee attribution
   - **How PII is accessed**: Via Restricted Data Tokens (RDT) with separate requests for `buyerInfo` and `shippingAddress`; partial-grant architecture ensures graceful degradation
   - **Encryption**: AES-256 at rest in managed PostgreSQL; TLS 1.2+ in transit; no PII stored in browser or client-side storage
   - **Access controls**: Row-Level Security isolates data per user; admin access is PIN-gated; edge functions authenticate via JWT; no direct database access
   - **Data retention**: PII retained for 91–180 days after order shipment to support quarterly Australian BAS/GST reconciliation cycles, then purged
   - **Data deletion**: Users can disconnect Amazon at any time; on disconnection, OAuth refresh tokens are revoked; users can request full data erasure via hello@xettle.app
   - **No sharing**: Amazon data is never sold, shared with third parties, or used for advertising; processed solely for the user's own accounting reconciliation
   - **Testing**: Only synthetic/anonymised data is used in test environments; no real PII in CI/CD or staging

3. **Update Section 4 (Data Storage and Security)** to add explicit mentions of:
   - AES-256 encryption at rest
   - TLS 1.2+ in transit
   - Row-Level Security per user
   - Audit logging with 12+ month retention

4. **Add new Section 10: Incident Response** before Contact Us:
   - Documented incident response plan
   - Immediate token revocation on breach detection
   - Affected users and Amazon notified within 24 hours
   - Contact IMPOC at hello@xettle.app

5. **Renumber existing sections** (Contact becomes 11, etc.)

### No other files change. This is a single-file update to `src/pages/Privacy.tsx`.

