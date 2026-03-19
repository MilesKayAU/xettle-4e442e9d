import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import XettleLogo from '@/components/shared/XettleLogo';
import {
  ArrowRight, CheckCircle, Ban, AlertTriangle, Package, Truck, DollarSign,
  Shield, RefreshCw, FileSpreadsheet, Eye, Lock, BarChart3, ShieldCheck,
  Layers, Receipt, Store, Search, Zap, Split, Fingerprint, Upload,
  Settings2, BookOpen, Sparkles
} from 'lucide-react';
import marketplaceSelfLearnImg from '@/assets/marketplace-self-learning.png';
import invoiceVsJournalImg from '@/assets/invoice-vs-journal-compare.png';

export default function Marketplaces() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <XettleLogo height={32} />
            <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2">
              Every Australian marketplace → Xero
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
              <Link to="/insights">Insights</Link>
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
        <div className="container-custom text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-bold mb-6 tracking-wide">
            <Store className="h-4 w-4" />
            EVERY AU MARKETPLACE. ONE ENGINE.
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Drop the file.<br />
            <span className="text-primary">Xettle does the rest.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
            Xettle auto-detects your marketplace from the settlement file, configures the connection, sets up Xero account codes, and starts syncing — without manual setup. Bunnings, Kogan, Catch, eBay, BigW, MyDeal, and any new marketplace you sell on.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-10">
            Self-learning fingerprint engine. Drop a file once — Xettle remembers the format forever.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                Try with your settlement file <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ══════════ SELF-LEARNING ENGINE ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold">
                <Fingerprint className="h-3.5 w-3.5" />
                Self-learning file detection
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Upload once.<br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">Xettle configures everything.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Drop a settlement file from any marketplace. Xettle's fingerprint engine analyses the columns, detects the marketplace, and auto-configures:
              </p>
              <div className="space-y-4">
                {[
                  { label: 'Marketplace detection', detail: 'Column signatures matched against known patterns. New formats are learned and remembered.' },
                  { label: 'Connection auto-setup', detail: 'A marketplace connection is created automatically — no manual configuration needed.' },
                  { label: 'Xero account suggestions', detail: 'Xettle scans your Xero Chart of Accounts and suggests the right account codes for sales, fees, and refunds.' },
                  { label: 'Settlement parsing', detail: 'Every line parsed, categorised, and validated. Totals must balance before the settlement is marked verified.' },
                  { label: 'Format memory', detail: 'Next time you upload from the same marketplace, it\'s instant. The fingerprint is saved.' },
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
                src={marketplaceSelfLearnImg}
                alt="Xettle auto-detecting marketplace from uploaded settlement file"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ SUPPORTED MARKETPLACES ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Every marketplace Australian sellers use.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Purpose-built for the AU marketplace landscape. Each marketplace has its own settlement format, payout schedule, and fee structure — Xettle handles all of them.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { name: 'Amazon AU', icon: '📦', method: 'SP-API + CSV upload', schedule: 'Fortnightly', highlight: 'FBA/FBM/MCF separated' },
              { name: 'Shopify', icon: '💳', method: 'API integration', schedule: 'Daily payouts', highlight: 'Sub-channel detection' },
              { name: 'eBay AU', icon: '🏪', method: 'API + CSV upload', schedule: 'Fortnightly', highlight: 'Managed payments parsed' },
              { name: 'Bunnings', icon: '🔨', method: 'CSV upload', schedule: 'Monthly', highlight: 'Remittance format supported' },
              { name: 'Kogan', icon: '📱', method: 'CSV upload', schedule: 'Monthly', highlight: 'Variable commission tracked' },
              { name: 'Catch', icon: '🎯', method: 'CSV / MarketPlus', schedule: 'Monthly', highlight: 'Auto-split from MarketPlus' },
              { name: 'BigW', icon: '🏬', method: 'CSV / MarketPlus', schedule: 'Monthly', highlight: 'Auto-split from MarketPlus' },
              { name: 'MyDeal', icon: '🏷️', method: 'CSV / MarketPlus', schedule: 'Monthly', highlight: 'Auto-split from MarketPlus' },
              { name: 'Everyday Market', icon: '🛒', method: 'CSV / MarketPlus', schedule: 'Monthly', highlight: 'Auto-split from MarketPlus' },
            ].map(({ name, icon, method, schedule, highlight }) => (
              <div key={name} className="p-5 rounded-2xl border border-border bg-card">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">{icon}</span>
                  <h3 className="text-base font-semibold text-foreground">{name}</h3>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Connection</span>
                    <span className="text-foreground font-medium">{method}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payout cycle</span>
                    <span className="text-foreground font-medium">{schedule}</span>
                  </div>
                  <div className="pt-1.5 border-t border-border mt-1.5">
                    <span className="text-xs font-medium text-primary">{highlight}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-8">
            Selling on a marketplace not listed? Upload the settlement file — Xettle will detect the format and configure it automatically.
          </p>
        </div>
      </section>

      {/* ══════════ SHOPIFY SUB-CHANNELS ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Split className="h-3.5 w-3.5" />
              Shopify sub-channel separation
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              One Shopify store. Multiple marketplaces.<br />Separated automatically.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Many Australian sellers use Shopify as their order management system — routing Kogan, Catch, MyDeal, and other marketplace orders through a single Shopify store. Most accounting tools treat the entire Shopify payout as one lump sum. Xettle doesn't.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Xettle approach */}
            <div className="p-6 rounded-2xl border-2 border-primary/30 bg-primary/5">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Xettle — Sub-channel aware</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Detects Kogan, Catch, MyDeal, etc. inside Shopify payouts',
                  'Each sub-channel gets its own Xero invoice',
                  'Invoice total matches the sub-channel portion of the deposit',
                  'Total marketplace sales held in Xettle for analysis — not pushed to Xero as a lump journal',
                  'Your accountant sees clean, per-marketplace invoices',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Other tools */}
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
                  <Ban className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Other tools — Lump sum journals</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Entire Shopify payout posted as one journal entry',
                  'All marketplace sales mixed together',
                  'Journal debits/credits across multiple accounts',
                  'Total sales figure pushed to Xero — clutters your reports',
                  'Accountant spends hours untangling which marketplace is which',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ INVOICE MODEL — UNIQUE APPROACH ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold">
                <Receipt className="h-3.5 w-3.5" />
                Invoices, not journals
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                One invoice per settlement.<br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">Matches your Xero bank feed directly.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Most marketplace accounting tools post summary journal entries — debits and credits spread across multiple accounts. This creates a reconciliation nightmare. Xettle takes a fundamentally different approach.
              </p>
              <div className="space-y-5">
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">Settlement → Invoice (1:1)</h4>
                  <p className="text-sm text-muted-foreground">Each marketplace settlement becomes exactly one DRAFT invoice in Xero. The invoice total matches the payout amount — so it reconciles directly against the bank feed deposit.</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">Sales totals stay in Xettle</h4>
                  <p className="text-sm text-muted-foreground">The gross marketplace sales figure is held in Xettle for profitability analysis — it's not pushed to Xero as a journal that clutters your P&L. Only the net settlement (what actually hit your bank) becomes an invoice.</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">Why this matters for your accountant</h4>
                  <p className="text-sm text-muted-foreground">No clearing accounts. No manual journals to reconcile. No total sales figures inflating your Xero revenue reports. One invoice, one bank deposit, one reconciliation click. Clean books.</p>
                </div>
              </div>
            </div>
            <div className="relative">
              <img
                src={invoiceVsJournalImg}
                alt="Comparison of Xettle invoice model vs journal entry model"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
              <div className="absolute bottom-3 right-3">
                <span className="bg-background/90 backdrop-blur-sm text-[10px] text-muted-foreground px-2 py-1 rounded-full border border-border">
                  Invoice vs journal — side by side
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ MIXED FILES (MARKETPLUS) ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Mixed settlement files? Auto-split.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-12">
            Woolworths MarketPlus sends one settlement file covering BigW, MyDeal, Catch, and Everyday Market. Xettle automatically splits it into separate marketplace settlements — each posted as its own Xero invoice.
          </p>
          <div className="grid md:grid-cols-4 gap-4 text-left">
            {[
              { label: 'One file uploaded', desc: 'Woolworths MarketPlus CSV dropped on Xettle' },
              { label: 'Four settlements created', desc: 'BigW, MyDeal, Catch, Everyday Market — separated' },
              { label: 'Four Xero invoices', desc: 'Each marketplace gets its own DRAFT invoice' },
              { label: 'Four bank matches', desc: 'Each verified against the correct deposit' },
            ].map(({ label, desc }) => (
              <div key={label} className="p-4 rounded-xl border border-border bg-background">
                <p className="text-sm font-semibold text-foreground mb-1">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ COA AUTO-SETUP ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Settings2 className="h-3.5 w-3.5" />
              Xero account setup
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Xero account codes — suggested, not guessed.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              When you connect Xero, Xettle scans your Chart of Accounts and detects existing marketplace accounts. If "Amazon Sales" or "Kogan Revenue" already exists, Xettle suggests it — you confirm. If nothing exists, Xettle recommends the right account structure for your bookkeeper to create.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Search, title: 'CoA scan', desc: 'Xettle reads your Xero Chart of Accounts and identifies existing marketplace-related accounts using keyword matching.' },
              { icon: Sparkles, title: 'Smart suggestions', desc: 'Detected accounts are suggested as mappings. "Amazon Marketplace Fees" → fees account. "BigW Sales" → revenue account. You confirm each one.' },
              { icon: BookOpen, title: 'Bookkeeper guidance', desc: 'Where accounts are missing, Xettle shows exactly what needs to be created in Xero — account type, code, and tax rate.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-border bg-card text-center">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Icon className="h-6 w-6 text-primary" />
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
            Any marketplace. One settlement engine.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Drop your first settlement file — Xettle detects the marketplace, configures everything, and shows you a verified Xero invoice preview. No setup wizard. No manual mapping.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-10 py-6" asChild>
              <Link to="/auth?tab=signup">
                Upload a settlement file <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
              <Link to="/amazon">
                Amazon AU deep dive
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
              <Link to="/amazon" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Amazon AU</Link>
              <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
              <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
              <a href="mailto:hello@xettle.app" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/60 text-center sm:text-left">
            Xero is a trademark of Xero Limited. Xettle is not affiliated with Xero Limited.
          </p>
        </div>
      </footer>
    </div>
  );
}
