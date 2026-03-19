import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import XettleLogo from '@/components/shared/XettleLogo';
import {
  ArrowRight, CheckCircle, Ban, AlertTriangle, Package, Truck, DollarSign,
  Shield, RefreshCw, FileSpreadsheet, Eye, Lock, BarChart3, ShieldCheck,
  Layers, Receipt, Store, Search, Zap, Split
} from 'lucide-react';
import amazonFbaFbmImg from '@/assets/amazon-fba-fbm-breakdown.png';
import sellerCentralImg from '@/assets/seller-central-statements.png';

export default function Amazon() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <XettleLogo height={32} />
            <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2">
              Amazon AU → Xero
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/marketplaces">Marketplaces</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/pricing">Pricing</Link>
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
        <div className="container-custom text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-bold mb-6 tracking-wide">
            <Package className="h-4 w-4" />
            AMAZON AU SETTLEMENT ENGINE
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Every Amazon fee.<br />
            <span className="text-primary">Separated. Verified. Posted to Xero.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
            Xettle connects to Amazon SP-API, syncs your settlements daily, separates FBA from FBM costs, and posts verified DRAFT invoices to Xero — with every hidden fee accounted for.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-10">
            Not a CSV uploader. A direct SP-API integration that understands Amazon AU settlement structure.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                Connect Amazon AU <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
              <Link to="/#how-it-works">How it works</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ══════════ THE AMAZON PROBLEM ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Amazon settlements are complex.<br />Most tools pretend they're not.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              A single Amazon AU settlement can contain 15+ different fee types across FBA, FBM, and MCF orders — plus refunds, reimbursements, advertising charges, and storage fees. Most accounting tools lump these together.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Layers, title: 'FBA and FBM lumped together', desc: 'Other tools combine all fulfilment types into a single journal entry. You can\'t see whether FBA fees are eating your margin or if FBM postage costs are actually lower.' },
              { icon: DollarSign, title: 'Hidden fees buried in totals', desc: 'Storage fees, long-term storage, removal orders, advertising costs, subscription fees — Amazon charges for everything. Most tools don\'t separate them.' },
              { icon: Receipt, title: 'Journals instead of invoices', desc: 'Many tools post complex journal entries with debits and credits across multiple accounts. Hard to audit, hard to match against bank deposits, hard for your accountant to review.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-border bg-background">
                <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                  <Icon className="h-6 w-6 text-destructive" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ FBA vs FBM SEPARATION ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold">
                <Split className="h-3.5 w-3.5" />
                Fulfilment-aware accounting
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                FBA. FBM. MCF.<br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">Each separated in your Xero invoice.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Xettle reads the fulfilment channel on every order line in your settlement. FBA fees, FBM postage costs, and MCF charges are separated — so your profit view reflects what you actually paid to fulfil each order.
              </p>
              <div className="space-y-4">
                {[
                  { label: 'FBA (Fulfilled by Amazon)', detail: 'Pick & pack, weight handling, storage — each fee line itemised separately in your Xero invoice' },
                  { label: 'FBM (Fulfilled by Merchant)', detail: 'Your own postage costs tracked per order. Xettle deducts the right shipping cost for profit analysis' },
                  { label: 'MCF (Multi-Channel Fulfilment)', detail: 'Using Amazon warehouses for non-Amazon orders? MCF fees separated with their own cost rate' },
                ].map(({ label, detail }) => (
                  <div key={label} className="flex items-start gap-3">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-1" />
                    <div>
                      <span className="text-sm font-semibold text-foreground">{label}</span>
                      <p className="text-sm text-muted-foreground">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <img
                src={amazonFbaFbmImg}
                alt="Amazon settlement breakdown showing FBA fees, FBM shipping costs, and MCF charges separated"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
              <div className="absolute bottom-3 right-3">
                <span className="bg-background/90 backdrop-blur-sm text-[10px] text-muted-foreground px-2 py-1 rounded-full border border-border">
                  Xettle settlement breakdown
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ HIDDEN AMAZON COSTS ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <AlertTriangle className="h-3.5 w-3.5" />
              Hidden costs most tools miss
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Amazon charges for everything.<br />Xettle shows all of it.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Beyond commission and FBA fees, Amazon deducts dozens of charges from your settlements. Xettle parses every line — nothing is lumped into "other".
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { fee: 'FBA Pick & Pack', desc: 'Per-unit fulfilment fees based on size and weight tier' },
              { fee: 'FBA Storage', desc: 'Monthly inventory storage — spikes Oct–Dec' },
              { fee: 'Long-Term Storage', desc: 'Aged inventory surcharges at 6 and 12 months' },
              { fee: 'Referral Fees', desc: 'Category-based commission on every sale' },
              { fee: 'Closing Fees', desc: 'Fixed per-unit fee on media categories' },
              { fee: 'Refund Admin', desc: 'Amazon keeps part of the commission on refunds' },
              { fee: 'Removal Orders', desc: 'Charges to return or dispose of FBA inventory' },
              { fee: 'Advertising', desc: 'Sponsored Products and Brands deducted at settlement' },
              { fee: 'Subscription', desc: 'Monthly Professional seller plan fee' },
              { fee: 'FBA Inbound', desc: 'Placement service fees for distributed inventory' },
              { fee: 'Reimbursements', desc: 'Amazon compensation for lost/damaged inventory' },
              { fee: 'Adjustments', desc: 'Retroactive corrections, missed credits, balance adjustments' },
            ].map(({ fee, desc }) => (
              <div key={fee} className="p-4 rounded-xl border border-border bg-background">
                <p className="text-sm font-semibold text-foreground mb-1">{fee}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-8">
            Every fee type above is parsed, categorised, and posted as a separate line item in your Xero invoice.
          </p>
        </div>
      </section>

      {/* ══════════ XETTLE vs OTHER TOOLS COMPARISON ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              How Xettle compares for Amazon AU sellers.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Built specifically for the Australian Amazon seller workflow — GST, ATO quarters, and Xero.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Feature</th>
                  <th className="text-center py-3 px-4 font-semibold text-primary">Xettle</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">A2X / Link My Books</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { feature: 'Accounting model', xettle: '1:1 DRAFT invoice per settlement', other: 'Summary journal entries' },
                  { feature: 'FBA / FBM separation', xettle: 'Per-line fulfilment channel', other: 'Lumped together' },
                  { feature: 'Posting to Xero', xettle: 'DRAFT — accountant reviews first', other: 'Direct post (often AUTHORISED)' },
                  { feature: 'Duplicate prevention', xettle: 'Fingerprint-based deduplication', other: 'Basic date matching' },
                  { feature: 'Bank deposit verification', xettle: 'Optional — verified against Xero deposits', other: 'Not available' },
                  { feature: 'Hidden fee separation', xettle: '12+ fee types as line items', other: 'Grouped into categories' },
                  { feature: 'MCF cost tracking', xettle: 'Separate MCF cost rate', other: 'Not separated' },
                  { feature: 'GST model', xettle: 'Australian GST built in', other: 'Multi-country (AU as afterthought)' },
                  { feature: 'Void & repost', xettle: 'Full chain of custody', other: 'Manual delete & re-sync' },
                  { feature: 'Settlement audit trail', xettle: 'Raw payload + CSV attached', other: 'Limited or none' },
                  { feature: 'Push safety preview', xettle: 'See invoice before posting', other: 'No preview' },
                  { feature: 'Period lock protection', xettle: 'Blocks posting to locked months', other: 'Not available' },
                ].map(({ feature, xettle, other }) => (
                  <tr key={feature} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground">{feature}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center gap-1.5 text-primary">
                        <CheckCircle className="h-3.5 w-3.5" /> {xettle}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center text-muted-foreground">{other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ══════════ DAILY SYNC & DIRECT PUSH ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-6">
                <RefreshCw className="h-3.5 w-3.5" />
                SP-API integration
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                Daily sync. Direct to Xero.<br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">No more downloading TSV files.</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Connect your Amazon Seller Central account once. Xettle pulls your settlements automatically via SP-API — parses every line, validates totals, and posts to Xero as a verified DRAFT invoice.
              </p>
              <div className="space-y-4">
                {[
                  'Automatic daily settlement fetch via Amazon SP-API',
                  'Every fee type parsed and categorised — nothing lumped',
                  'Settlements verified before they reach Xero',
                  'Manual CSV/TSV upload still supported as backup',
                  'Both API and upload paths use the same parser — identical results',
                ].map(item => (
                  <div key={item} className="flex items-start gap-3">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <img
                src={sellerCentralImg}
                alt="Amazon Seller Central settlement export guide"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
              <div className="absolute bottom-3 right-3">
                <span className="bg-background/90 backdrop-blur-sm text-[10px] text-muted-foreground px-2 py-1 rounded-full border border-border">
                  Still prefer CSV? We support that too.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ PROFIT VISIBILITY ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Know your real Amazon profit.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-12">
            When FBA and FBM costs are separated, and every hidden fee is accounted for, you can finally see what Amazon AU is actually costing you — per settlement, per period, per fulfilment method.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: 'Settlement-level margin', desc: 'See gross revenue, total fees, refunds, and net payout for every settlement period. No aggregated averages — real numbers.' },
              { icon: Truck, title: 'Fulfilment cost comparison', desc: 'Compare FBA fees vs FBM postage costs across settlements. Know which fulfilment method is actually cheaper for your products.' },
              { icon: AlertTriangle, title: 'Fee change detection', desc: 'When Amazon changes a fee rate between settlements, Xettle flags it. You see the old rate, the new rate, and the impact.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-border bg-card text-left">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ CTA ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Stop guessing what Amazon costs you.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Connect your Amazon Seller Central account and see your first settlement breakdown in minutes. Every fee separated. Every line verified. Posted to Xero as a clean DRAFT invoice.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-10 py-6" asChild>
              <Link to="/auth?tab=signup">
                Connect Amazon AU <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
              <Link to="/marketplaces">
                See all marketplaces
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container-custom flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Xettle. Australian marketplace settlements → verified Xero invoices.
            </p>
            <div className="flex flex-wrap gap-6">
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Home</Link>
              <Link to="/marketplaces" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Marketplaces</Link>
              <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
              <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
              <a href="mailto:hello@xettle.app" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/60 text-center sm:text-left">
            Amazon is a trademark of Amazon.com, Inc. Xero is a trademark of Xero Limited. Xettle is not affiliated with either.
          </p>
        </div>
      </footer>
    </div>
  );
}
