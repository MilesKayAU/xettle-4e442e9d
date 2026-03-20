import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import XettleLogo from '@/components/shared/XettleLogo';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center">
            <XettleLogo height={32} />
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
          </Button>
        </div>
      </nav>

      <div className="container-custom max-w-3xl mx-auto pt-28 pb-16 px-4">
        <h1 className="text-4xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

        <div className="prose prose-sm max-w-none text-foreground space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">1. Who We Are</h2>
            <p className="text-muted-foreground leading-relaxed">Xettle ("we", "us", "our") operates the xettle.app website and service. We are an Australian-based software service that helps marketplace sellers synchronise settlement data with Xero accounting software.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">2. Information We Collect</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We collect information you provide directly:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Account information (email address, name) when you register</li>
              <li>Xero OAuth tokens when you connect your Xero organisation</li>
              <li>Amazon settlement report data that you upload or sync via the Selling Partner API (see Section 5b)</li>
              <li>Shopify store data when you connect your Shopify store (see Section 5a)</li>
              <li>eBay account data when you connect your eBay account</li>
              <li>Usage data and application logs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>To provide and maintain the Xettle service</li>
              <li>To authenticate your marketplace and accounting connections</li>
              <li>To synchronise settlement and payout data with your accounting software</li>
              <li>To reconcile marketplace fees, refunds, and adjustments for GST/BAS compliance</li>
              <li>To communicate with you about the service</li>
              <li>To detect and prevent fraud or abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">4. Data Storage and Security</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">Your data is stored securely using industry-standard measures:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li><strong>Encryption at rest</strong> — all data, including OAuth tokens and personally identifiable information (PII), is encrypted using AES-256 in managed PostgreSQL databases</li>
              <li><strong>Encryption in transit</strong> — all connections between your browser, our servers, and third-party APIs use TLS 1.2 or higher</li>
              <li><strong>Row-Level Security (RLS)</strong> — database policies ensure that each user can only access their own data; no user can view, modify, or query another user's records</li>
              <li><strong>Authentication</strong> — all backend functions authenticate requests via JSON Web Tokens (JWT); admin-level actions require an additional PIN gate</li>
              <li><strong>Audit logging</strong> — data access events, API calls, and administrative actions are logged in a centralised audit trail and retained for a minimum of 12 months</li>
              <li><strong>No direct database access</strong> — all data operations are performed through authenticated serverless functions; there is no publicly exposed database port</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">We do not store your login credentials for any third-party service. Settlement and payout data you upload or sync is processed and stored in your account only.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">5. Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We integrate with the following third-party services:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li><strong>Xero</strong> — for accounting data synchronisation (governed by Xero's privacy policy)</li>
              <li><strong>Shopify</strong> — for store, order, and payout data synchronisation (see Section 5a)</li>
              <li><strong>Amazon</strong> — for settlement, financial, and order data via the Selling Partner API (see Section 5b)</li>
              <li><strong>eBay</strong> — for settlement report data</li>
              <li><strong>Supabase</strong> — for authentication and data storage infrastructure</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">We do not sell your personal information to third parties.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">5a. Shopify Data</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">When you install or connect the Xettle Shopify app, we access the following data from your Shopify store:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li><strong>Store information</strong> — shop domain and store name, used to identify your connection</li>
              <li><strong>Orders</strong> — order ID, amounts, taxes, discounts, gateway, source name, and tags, used for settlement reconciliation</li>
              <li><strong>Payouts</strong> — payout amounts, dates, and status from Shopify Payments, used to generate settlement records</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>How we store Shopify data:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Shopify OAuth access tokens and refresh tokens are stored encrypted at rest in our database, isolated per user</li>
              <li>Order and payout data is cached locally in your account to prevent redundant API calls and to support reconciliation workflows</li>
              <li>We do not access or store customer personal information (names, addresses, emails) from your Shopify store</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>Data retention and deletion:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>You can disconnect your Shopify store at any time from your Xettle dashboard, which deactivates the OAuth token</li>
              <li>You can permanently delete a disconnected store's tokens from the inactive stores section</li>
              <li>If you uninstall the Xettle app from Shopify, we automatically deactivate the stored OAuth token</li>
              <li>Upon receiving a Shopify shop data erasure request (GDPR shop/redact webhook), we permanently delete all stored tokens, orders, and settlement data associated with your shop</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>GDPR compliance:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>We respond to Shopify mandatory GDPR webhooks: customer data requests, customer data erasure, and shop data erasure</li>
              <li>Since Xettle does not store end-customer personal data from your Shopify store, customer data requests and erasure requests are acknowledged but typically contain no actionable data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">5b. Amazon Selling Partner API Data</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">When you connect your Amazon Seller Central account to Xettle via the Selling Partner API (SP-API), we access and process the following data:</p>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>Data collected:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li><strong>Settlement reports</strong> — settlement IDs, period dates, transaction-level line items (sales, fees, refunds, reimbursements, adjustments), net payout amounts, and deposit dates</li>
              <li><strong>Financial events</strong> — order-level fee breakdowns, commission amounts, FBA fees, storage fees, advertising costs, and promotional discounts</li>
              <li><strong>Order data</strong> — Amazon order IDs, order amounts, fulfilment channel (FBA/FBM), SKUs, and order status</li>
              <li><strong>Restricted PII (where access is granted)</strong> — buyer name, buyer email address, and shipping address (recipient name, street address, city, state, postal code, country). This data is accessed only via Restricted Data Tokens (RDT) and only when Amazon has approved the corresponding restricted data roles for our application</li>
            </ul>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>Purpose of data collection:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Settlement reconciliation — matching Amazon settlement line items to Xero accounting entries for accurate bookkeeping</li>
              <li>GST/BAS compliance — calculating and verifying GST on sales, fees, and adjustments to support quarterly Australian tax reporting</li>
              <li>Fulfilment tracking — for FBM (Fulfilled by Merchant) orders, syncing order details to Shopify for shipping label generation and dispatch</li>
              <li>Fee attribution — analysing marketplace commission rates, FBA fees, and advertising costs per settlement period for profitability insights</li>
            </ul>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>How PII is accessed and handled:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>PII is accessed exclusively via Amazon's Restricted Data Token (RDT) mechanism, which grants time-limited, scoped access to specific data elements</li>
              <li>We request RDTs independently for each data element (<code className="text-xs bg-muted px-1 py-0.5 rounded">buyerInfo</code> and <code className="text-xs bg-muted px-1 py-0.5 rounded">shippingAddress</code>), so a denial for one element does not prevent access to the other</li>
              <li>PII is used solely to create fulfilment orders in Shopify for FBM shipments and is never used for marketing, advertising, or any purpose unrelated to order fulfilment and accounting</li>
              <li>PII is never stored in browser local storage, session storage, cookies, or any client-side mechanism; it is processed and stored only in server-side encrypted databases</li>
            </ul>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>Encryption and access controls:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Amazon OAuth refresh tokens and access tokens are encrypted at rest using AES-256 and stored in managed PostgreSQL with Row-Level Security (RLS) ensuring strict per-user isolation</li>
              <li>All API calls to Amazon SP-API endpoints are made over TLS 1.2+ from authenticated server-side edge functions; no Amazon API calls are made from the browser</li>
              <li>Access to Amazon PII data within the Xettle admin interface requires PIN-gated authentication in addition to standard login credentials</li>
              <li>All Amazon API interactions are logged in our audit trail, including RDT request outcomes (granted/denied per data element), for compliance monitoring</li>
            </ul>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>Data retention:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Amazon settlement and financial data is retained for as long as your account is active, as it forms part of your accounting reconciliation history</li>
              <li>Buyer PII (name, email, shipping address) is retained for 91–180 days after order shipment to support quarterly Australian BAS/GST reconciliation cycles, after which it is automatically purged from our systems</li>
              <li>Amazon OAuth tokens are retained only while your Amazon connection is active</li>
            </ul>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>Data deletion and disconnection:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>You can disconnect your Amazon Seller Central account from Xettle at any time via your dashboard settings</li>
              <li>Upon disconnection, your Amazon OAuth refresh token is immediately revoked and deleted from our systems</li>
              <li>You may request full erasure of all Amazon-sourced data (settlements, orders, PII) by contacting us at <a href="mailto:hello@xettle.app" className="text-primary hover:underline">hello@xettle.app</a></li>
              <li>Data erasure requests are processed within 30 days and include permanent deletion from all databases, backups, and audit logs where technically feasible</li>
            </ul>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>No sharing or secondary use:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Amazon data — including PII — is never sold, shared with third parties, or used for advertising, marketing, or any purpose other than providing the Xettle service to you</li>
              <li>Amazon data is processed solely for your own settlement reconciliation, accounting, and tax compliance purposes</li>
              <li>We do not aggregate Amazon seller data across users for benchmarking or analytics purposes</li>
            </ul>

            <p className="text-muted-foreground leading-relaxed mt-3 mb-3"><strong>Development and testing:</strong></p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Only synthetic and anonymised data is used in development, staging, and test environments; real Amazon PII is never present in non-production systems</li>
              <li>CI/CD pipelines and application logs are configured to exclude PII; log redaction is enforced at the application layer</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">6. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">Under the Australian Privacy Act 1988 and applicable data protection laws (including GDPR where applicable), you have the right to access, correct, and request deletion of your personal information. You can disconnect your marketplace and accounting integrations and delete your Xettle account at any time. To exercise these rights, contact us at <a href="mailto:hello@xettle.app" className="text-primary hover:underline">hello@xettle.app</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">7. Cookies</h2>
            <p className="text-muted-foreground leading-relaxed">We use essential cookies for authentication and session management. We do not use advertising or tracking cookies.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">8. Data Breach and Vulnerability Management</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">We maintain documented procedures for managing security vulnerabilities and responding to data breaches:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li><strong>Vulnerability management</strong> — critical vulnerabilities are triaged and resolved within 7 days; high-severity issues within 30 days. Dependency scanning is performed on every deployment</li>
              <li><strong>Penetration testing</strong> — we conduct regular security assessments of our application and infrastructure</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">9. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "Last updated" date.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">10. Incident Response</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">In the event of a confirmed or suspected data breach involving personal information or third-party API data (including Amazon SP-API data), we follow a documented incident response protocol:</p>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-1">
              <li><strong>Detection and containment</strong> — the incident is identified, classified by severity, and affected systems are isolated to prevent further exposure</li>
              <li><strong>Token revocation</strong> — all OAuth tokens associated with the affected integration (Amazon, Shopify, Xero, eBay) are immediately revoked</li>
              <li><strong>Assessment</strong> — we determine the scope of the breach, including what data was accessed, which users are affected, and the root cause</li>
              <li><strong>Notification</strong> — affected users and relevant third parties (including Amazon, where Amazon data is involved) are notified within 24 hours of confirmed breach identification</li>
              <li><strong>Remediation</strong> — the vulnerability or access vector is patched, and preventive controls are updated</li>
              <li><strong>Post-incident review</strong> — a written post-mortem is prepared documenting the timeline, impact, root cause, and corrective actions taken</li>
            </ol>
            <p className="text-muted-foreground leading-relaxed mt-3">To report a security concern, contact our incident response team at <a href="mailto:hello@xettle.app" className="text-primary hover:underline">hello@xettle.app</a>.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mt-8 mb-3">11. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">If you have any questions about this Privacy Policy, please contact us at <a href="mailto:hello@xettle.app" className="text-primary hover:underline">hello@xettle.app</a>.</p>
          </section>
        </div>
      </div>

      <footer className="border-t border-border py-6 px-4">
        <div className="container-custom text-center">
          <p className="text-xs text-muted-foreground/60">Xero is a trademark of Xero Limited. Shopify is a trademark of Shopify Inc. Amazon is a trademark of Amazon.com, Inc. Xettle is not affiliated with these companies.</p>
        </div>
      </footer>
    </div>
  );
}