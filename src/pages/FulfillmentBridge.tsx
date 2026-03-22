import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import XettleLogo from '@/components/shared/XettleLogo';
import {
  ArrowRight, CheckCircle, Shield, Package, Truck, RefreshCw,
  AlertTriangle, Lock, Eye, Zap, ShieldCheck, Activity, Clock, Ban,
} from 'lucide-react';

export default function FulfillmentBridgePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <XettleLogo height={32} />
            <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2">
              Fulfillment Bridge
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/amazon">Amazon AU</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/marketplaces">Marketplaces</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/pricing">Pricing</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/auth">Sign In</Link>
            </Button>
            <Button asChild>
              <Link to="/auth?tab=signup">
                Start free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* ══════════ HERO ══════════ */}
      <section className="pt-32 pb-16 px-4">
        <div className="container-custom max-w-4xl text-center space-y-6">
          <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Beta — Coming Soon
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Fulfillment Bridge
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Automate order fulfillment between Shopify and Amazon FBA.
            Sync orders, push tracking, and reconcile settlements — all from one dashboard.
          </p>
          <div className="flex justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/auth?tab=signup">
                Join the waitlist <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/amazon">Amazon AU features</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ══════════ BETA NOTICE ══════════ */}
      <section className="px-4 pb-12">
        <div className="container-custom max-w-3xl">
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="pt-6">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-900">Beta Feature — Not Yet Available</p>
                  <p className="text-xs text-amber-800">
                    Fulfillment Bridge is currently in development and pending Amazon SP-API role approval.
                    The features described on this page represent our planned capabilities and are not yet
                    available to users. We are actively working through Amazon's developer approval process
                    to enable these integrations.
                  </p>
                  <p className="text-xs text-amber-700">
                    Sign up to be notified when Fulfillment Bridge launches.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ══════════ MCF — SHOPIFY → AMAZON ══════════ */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="container-custom max-w-5xl space-y-8">
          <div className="text-center space-y-3">
            <Badge variant="secondary" className="text-xs">Multi-Channel Fulfillment</Badge>
            <h2 className="text-3xl font-bold text-foreground">Shopify → Amazon FBA</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Automatically fulfill Shopify orders using your existing Amazon FBA inventory.
              No manual order creation in Seller Central needed.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Package, title: 'Auto-Scan Eligible Orders', desc: 'Identifies Shopify orders where all line items have FBA product links, ready for Amazon fulfillment.' },
              { icon: Zap, title: 'One-Click MCF Creation', desc: 'Creates Multi-Channel Fulfillment orders in Amazon from your Shopify dashboard with a single action.' },
              { icon: Truck, title: 'Tracking Sync to Shopify', desc: 'Once Amazon ships, tracking numbers and carrier details are automatically pushed back to Shopify.' },
              { icon: RefreshCw, title: 'Lifecycle Tags', desc: 'Shopify orders are tagged (amazon-mcf-pending, amazon-mcf-fulfilled) for complete visibility.' },
              { icon: Ban, title: 'Cancel MCF Orders', desc: 'Cancel unfulfilled MCF orders directly from the dashboard if plans change.' },
              { icon: Activity, title: 'Status Polling', desc: 'Continuous polling monitors fulfillment status with circuit breaker protection against API failures.' },
            ].map(({ icon: Icon, title, desc }) => (
              <Card key={title}>
                <CardContent className="pt-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ FBM — AMAZON → SHOPIFY ══════════ */}
      <section className="py-16 px-4">
        <div className="container-custom max-w-5xl space-y-8">
          <div className="text-center space-y-3">
            <Badge variant="secondary" className="text-xs">Fulfilled By Merchant</Badge>
            <h2 className="text-3xl font-bold text-foreground">Amazon → Shopify</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Pull Amazon FBM orders into Shopify for centralized order management,
              and push tracking back to Amazon once fulfilled.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Package, title: 'Order Import', desc: 'Pulls Amazon FBM orders into Shopify with full line-item, address, and shipping level detail.' },
              { icon: Truck, title: 'Tracking Push', desc: 'When you fulfill in Shopify, tracking info is automatically sent back to Amazon for buyer notifications.' },
              { icon: Clock, title: 'Retry Queue', desc: 'Failed syncs enter an exponential backoff retry queue (5, 15, 60 min intervals) with email alerts.' },
              { icon: RefreshCw, title: 'Bulk Retry', desc: '"Retry All Failed" action lets you re-process all errored orders in one click.' },
              { icon: Eye, title: 'Full Audit Trail', desc: 'Every sync attempt is logged with timestamps, error details, and retry counts for transparency.' },
              { icon: ShieldCheck, title: 'Circuit Breaker', desc: 'Halts polling after 5 consecutive failures to prevent API rate-limit exhaustion.' },
            ].map(({ icon: Icon, title, desc }) => (
              <Card key={title}>
                <CardContent className="pt-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ SECURITY & COMPLIANCE ══════════ */}
      <section className="py-16 px-4 bg-muted/30">
        <div className="container-custom max-w-4xl space-y-8">
          <div className="text-center space-y-3">
            <h2 className="text-3xl font-bold text-foreground">Security & Data Handling</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Built to meet Amazon SP-API developer requirements and Australian data regulations.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: Lock, title: 'Encryption', desc: 'All data encrypted with AES-256 at rest and TLS 1.2+ in transit. Amazon tokens stored server-side only.' },
              { icon: Shield, title: 'PII Retention Policy', desc: '30-day PII retention after shipment, with legal exceptions for ATO/GST compliance as required by Australian tax law.' },
              { icon: ShieldCheck, title: 'Incident Response', desc: '24-hour notification protocol to security@amazon.com and affected users in the event of a data incident.' },
              { icon: CheckCircle, title: 'Regular Audits', desc: 'Annual penetration tests, semi-annual vulnerability scans, and code scans prior to each release.' },
            ].map(({ icon: Icon, title, desc }) => (
              <Card key={title}>
                <CardContent className="pt-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-center gap-4 pt-4">
            <Button variant="outline" size="sm" asChild>
              <Link to="/privacy">Privacy Policy</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/terms">Terms of Service</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ══════════ SP-API ROLES ══════════ */}
      <section className="py-16 px-4">
        <div className="container-custom max-w-3xl space-y-6">
          <h2 className="text-2xl font-bold text-foreground text-center">Amazon SP-API Integration</h2>
          <p className="text-sm text-muted-foreground text-center max-w-xl mx-auto">
            Fulfillment Bridge uses the following Amazon SP-API roles to securely connect your seller account.
          </p>
          <div className="space-y-3">
            {[
              { role: 'Orders', type: 'Standard', desc: 'Read Amazon orders for FBM import into Shopify.', status: 'Pending' },
              { role: 'Amazon Fulfillment', type: 'Standard', desc: 'Create, monitor, and cancel Multi-Channel Fulfillment orders.', status: 'Pending' },
              { role: 'Direct-to-Consumer Delivery', type: 'Restricted', desc: 'Push tracking numbers from Shopify fulfillments back to Amazon.', status: 'Pending' },
            ].map(({ role, type, desc, status }) => (
              <Card key={role}>
                <CardContent className="pt-4 pb-4 flex items-center justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{role}</h3>
                      <Badge variant={type === 'Restricted' ? 'destructive' : 'secondary'} className="text-[10px]">
                        {type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0 border-amber-300 text-amber-700">
                    {status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Standard roles are non-restricted and granted upon app registration. The restricted
            Direct-to-Consumer Delivery role requires a security audit and PII access review.
          </p>
        </div>
      </section>

      {/* ══════════ CTA ══════════ */}
      <section className="py-16 px-4 bg-primary/5">
        <div className="container-custom max-w-2xl text-center space-y-4">
          <h2 className="text-2xl font-bold text-foreground">Get Notified When We Launch</h2>
          <p className="text-muted-foreground text-sm">
            Fulfillment Bridge is in beta. Create an account to join the waitlist and be the first
            to connect your Shopify + Amazon workflow.
          </p>
          <Button size="lg" asChild>
            <Link to="/auth?tab=signup">
              Join the waitlist <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ══════════ FOOTER ══════════ */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container-custom flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Xettle. Australian marketplace settlements → verified Xero invoices.
            </p>
            <div className="flex flex-wrap gap-6">
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Home</Link>
              <Link to="/amazon" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Amazon AU</Link>
              <Link to="/marketplaces" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Marketplaces</Link>
              <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
              <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
              <a href="mailto:hello@xettle.app" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/60 text-center sm:text-left">
            Amazon, Seller Central, and FBA are trademarks of Amazon.com, Inc. Shopify is a trademark of Shopify Inc. Xettle is not affiliated with either.
          </p>
        </div>
      </footer>
    </div>
  );
}
