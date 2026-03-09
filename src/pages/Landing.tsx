import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Shield, Zap, FileSpreadsheet, RefreshCw, CheckCircle, Upload, Bot, Crown, Store, BarChart3, AlertTriangle, ScanSearch, FolderUp, Table, Settings2, Layers, Users, ClipboardCheck, Ban } from 'lucide-react';
import profitLeakImg from '@/assets/profit-leak-preview.png';
import feeAlertsImg from '@/assets/fee-alerts-preview.png';
import PublicDemoUpload from '@/components/PublicDemoUpload';
import { supabase } from '@/integrations/supabase/client';

const marketplaces = [
  { name: 'Amazon', icon: '📦', status: 'live' as const },
  { name: 'Bunnings', icon: '🔨', status: 'live' as const },
  { name: 'Shopify', icon: '💳', status: 'live' as const },
  { name: 'Kogan', icon: '🛒', status: 'soon' as const },
  { name: 'MyDeal', icon: '🏷️', status: 'soon' as const },
  { name: 'Woolworths', icon: '🛍️', status: 'soon' as const },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-foreground tracking-tight">
              <span className="text-primary">X</span>ettle
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2">
              Amazon, Shopify & marketplace settlements → Xero
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/pricing">Pricing</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/auth">Sign In</Link>
            </Button>
            <Button asChild>
              <Link to="/auth?tab=signup">
                Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* ════════════════════════════════════════════════════════════════════
          HERO — Challenge + Upload + Instant Xero Preview
          ════════════════════════════════════════════════════════════════════ */}
      <section className="pt-32 pb-12 px-4">
        <div className="container-custom text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-bold mb-6 tracking-wide">
            <Zap className="h-4 w-4" />
            ⚡ THE XETTLE CHALLENGE
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight mb-6">
            Drop any settlement file.
            <br />
            <span className="text-primary">It's in Xero in seconds.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-2">
            Drop any marketplace file. We'll recognise it, parse it, and show you your Xero invoice before you finish your coffee.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-10">
            No account needed · No setup · No configuration
          </p>

          {/* Public Demo Upload */}
          <PublicDemoUpload />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          STATIC "WOW" PREVIEW — Shows what happens BEFORE they upload
          ════════════════════════════════════════════════════════════════════ */}
      <section className="pb-16 px-4">
        <div className="container-custom max-w-3xl mx-auto">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-center mb-4">Here's what you'll see</p>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Settlement preview */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📦</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Amazon AU Settlement</p>
                  <p className="text-xs text-muted-foreground">Jan 7 – Jan 12, 2026</p>
                </div>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Sales</span><span className="font-medium text-foreground">$2,478.85</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">FBA Fees</span><span className="font-medium text-destructive">-$892.50</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Seller Fees</span><span className="font-medium text-destructive">-$285.43</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Refunds</span><span className="font-medium text-destructive">-$65.45</span></div>
                <div className="border-t border-border pt-2 mt-2 flex justify-between items-center">
                  <span className="font-semibold text-foreground">Bank Deposit</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary text-lg">$2,726.74</span>
                    <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                      <CheckCircle className="h-3 w-3" /> Reconciled
                    </span>
                  </div>
                </div>
              </div>
            </div>
            {/* Xero invoice preview */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg bg-[hsl(var(--primary))]/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-primary">X</span>
                </div>
                <p className="text-sm font-semibold text-foreground">Xero Invoice — Ready to post</p>
              </div>
              <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-mono text-foreground">INV-XXXX</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span className="font-medium text-foreground">Amazon.com.au</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span className="text-foreground">12 Jan 2026</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold text-foreground">AUD $2,726.74</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">✓ AUTHORISED</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/60 text-center mt-3 italic">Preview — actual invoice created when you sync</p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          MARKETPLACE STRIP + CTAs
          ════════════════════════════════════════════════════════════════════ */}
      <section className="pb-16 px-4">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-4">Works with files other tools can't handle</p>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            {marketplaces.map((m) => (
              <span
                key={m.name}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border ${
                  m.status === 'live'
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-background text-muted-foreground border-border/60'
                }`}
              >
                <span>{m.icon}</span>
                {m.name}
                {m.status === 'soon' && <span className="text-[10px] opacity-60">soon</span>}
              </span>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                Start Free <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
              <Link to="/pricing">See Plans</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          ZERO CONFIG — The biggest differentiator
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                No integrations.<br />
                No setup.<br />
                No mapping.
              </h2>
              <p className="text-lg text-muted-foreground mb-6">
                Most tools force you to connect your store, map accounts, configure fees, then import data. Xettle skips all of that.
              </p>
              <p className="text-lg font-semibold text-foreground">
                Just drop your settlement file. Done.
              </p>
            </div>
            <div className="space-y-4">
              {[
                { icon: Ban, label: 'No store connection required', desc: 'Upload any file from any marketplace — no API keys or store access needed.' },
                { icon: Layers, label: 'Auto-detect marketplace', desc: 'Our fingerprint engine identifies Amazon, Shopify, Bunnings and more from the file structure alone.' },
                { icon: CheckCircle, label: 'Instant Xero-ready output', desc: 'Every line categorised, GST handled, reconciliation verified — ready to push.' },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-background">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <item.icon className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          BULK UPLOAD — Drop 50 files
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <FolderUp className="h-3.5 w-3.5" />
              Smart Bulk Upload
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Drop 50 files. We sort them for you.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Mix Amazon TSVs, Shopify CSVs, and Bunnings PDFs in a single upload. Xettle detects each marketplace, creates the tabs, and sorts every settlement into the right place.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Layers className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Auto-detect marketplace</h3>
              <p className="text-muted-foreground text-sm">
                Recognises Amazon, Shopify, Bunnings, Kogan and more — from the file structure alone. No manual labelling.
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Table className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Sorted settlement table</h3>
              <p className="text-muted-foreground text-sm">
                Every settlement lands in a clean table under its marketplace tab — period, deposit, reconciliation, and Xero sync status at a glance.
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Settings2 className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Approve & sync your way</h3>
              <p className="text-muted-foreground text-sm">
                Review each settlement before syncing to Xero manually — or upgrade to Pro and let Xettle auto-push on a schedule.
              </p>
            </div>
          </div>
          <div className="text-center mt-10">
            <Button size="lg" asChild>
              <Link to="/auth?tab=signup">
                Try Bulk Upload Free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          WHAT XETTLE DOES — Simplified feature list
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              What Xettle does automatically
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              No bloat. No complexity. Just the things that matter.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {[
              { icon: FileSpreadsheet, title: 'Detect settlements', desc: 'Recognise marketplace, parse every line, categorise transactions.' },
              { icon: ClipboardCheck, title: 'Create accounting entries', desc: 'Sales, fees, refunds, GST — all mapped to the right Xero accounts.' },
              { icon: RefreshCw, title: 'Sync to Xero', desc: 'One click to push. Or auto-sync on a schedule with Pro.' },
              { icon: ScanSearch, title: 'Highlight fee changes', desc: 'Spot commission rate shifts, new fees, or refund spikes before they hit your books.' },
              { icon: BarChart3, title: 'Show real profit', desc: 'See what you actually kept after every marketplace fee and refund.' },
              { icon: Store, title: 'Multi-marketplace', desc: 'Amazon, Bunnings, Shopify today. Kogan, MyDeal, Woolworths coming soon.' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-4 p-4 rounded-xl">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-0.5">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          THREE STEPS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-16">
            Three steps. Xettled.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Connect Xero', desc: 'Securely link your Xero organisation with one click. Tokens are encrypted per-user.' },
              { step: '02', title: 'Upload or Auto-Sync', desc: 'Drop all your settlement files at once — Amazon, Shopify, Bunnings, anything. Or let Pro auto-fetch.' },
              { step: '03', title: 'Xettle It', desc: 'Review settlements sorted by marketplace, approve, and push to Xero. Individually or in bulk.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="text-5xl font-bold text-primary/20 mb-4">{item.step}</div>
                <h3 className="text-xl font-semibold text-foreground mb-2">{item.title}</h3>
                <p className="text-muted-foreground text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          PROFIT LEAK
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              See your real marketplace profit
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              What landed in your bank after every marketplace fee and refund.
            </p>
          </div>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="relative">
              <img
                src={profitLeakImg}
                alt="Profit Leak Breakdown showing fee-by-fee analysis across Bunnings and Amazon AU"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
              <div className="absolute bottom-3 right-3">
                <span className="bg-background/90 backdrop-blur-sm text-[10px] text-muted-foreground px-2 py-1 rounded-full border border-border">
                  Live preview from Xettle dashboard
                </span>
              </div>
            </div>
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Marketplace fee breakdown</h3>
                  <p className="text-muted-foreground text-sm">See exactly what the marketplace charged — commission, FBA fulfilment, refunds, and platform fees.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Store className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Compare marketplaces</h3>
                  <p className="text-muted-foreground text-sm">Instantly compare what you keep from Bunnings vs Amazon vs Shopify — side by side.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Spot your biggest cost</h3>
                  <p className="text-muted-foreground text-sm">Every marketplace highlights your biggest profit leak so you know where to focus.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          FEE CHANGE ALERTS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1 space-y-6">
              <div className="inline-flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-1 rounded-full text-xs font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                Built-in Alerts
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Auto-scan for fee changes &amp; discrepancies
              </h2>
              <p className="text-lg text-muted-foreground">
                Marketplaces change commission rates, add fees, or adjust shipping — often without notice. Xettle watches every settlement.
              </p>
              <ul className="space-y-3">
                {[
                  'Commission rate changes detected automatically',
                  'Shipping & fulfilment fee deviation alerts',
                  'Refund rate spikes flagged before Xero sync',
                  'Historical trend comparison across settlements',
                  'Dismiss or investigate — you stay in control',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5">
                    <ScanSearch className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="order-1 lg:order-2">
              <img
                src={feeAlertsImg}
                alt="Fee Change Alerts showing commission rate changes, shipping deviations, and status indicators"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          BUILT FOR ACCOUNTANTS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
                <Users className="h-3.5 w-3.5" />
                For Accountants
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Built for accountants too
              </h2>
              <p className="text-lg text-muted-foreground mb-6">
                Your clients sell on Amazon, Bunnings, Shopify — and you need their settlements in Xero without chasing files or decoding CSVs.
              </p>
              <ul className="space-y-3">
                {[
                  'Review every settlement before it posts to Xero',
                  'Approve individually or sync in bulk',
                  'Smart reconciliation catches errors first',
                  'See exactly what the marketplace charged — no surprises',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-background rounded-2xl border border-border p-6 space-y-4">
              <p className="text-sm font-semibold text-foreground mb-2">Demo it to a client in 60 seconds:</p>
              <div className="space-y-3">
                {[
                  { num: '1', text: 'Ask them to export their settlement file' },
                  { num: '2', text: 'Drop it on xettle.lovable.app — no signup' },
                  { num: '3', text: 'Show them the Xero invoice preview' },
                  { num: '4', text: 'They sign up and you both save hours' },
                ].map((step) => (
                  <div key={step.num} className="flex items-center gap-3">
                    <span className="h-7 w-7 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center shrink-0">{step.num}</span>
                    <span className="text-sm text-muted-foreground">{step.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          TRUST SIGNALS — File compatibility
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4">
        <div className="container-custom max-w-3xl mx-auto">
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-8 md:p-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-8">
              Works with files other tools can't handle
            </h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              {[
                'Amazon settlement TSV (any region)',
                'Shopify Payments payouts CSV',
                'Bunnings / Mirakl invoice PDF',
                'Most marketplace CSV exports',
                'Australian GST handled correctly',
                'Your data stays in your own Xero',
              ].map((signal) => (
                <div key={signal} className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span className="text-foreground font-medium text-sm">{signal}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground/70 text-center italic">
              Manual settlement uploads are free forever. No credit card required.
            </p>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          FINAL CTA
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            See the result first. Sign up second.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Most tools make you sign up before you see anything. Xettle shows you the Xero invoice from your own file — no account needed.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-10 py-6" asChild>
              <Link to="/auth?tab=signup">
                Create Free Account <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              ↑ Try the challenge
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container-custom flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Xettle. Marketplace accounting for Xero.
            </p>
            <div className="flex flex-wrap gap-6">
              <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</Link>
              <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms of Service</Link>
              <a href="mailto:hello@xettle.app" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a>
              <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Sign In</Link>
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
