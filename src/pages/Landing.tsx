import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Shield, Zap, FileSpreadsheet, RefreshCw, CheckCircle, Upload, Bot, Crown, Store, BarChart3, AlertTriangle, ScanSearch, FolderUp, Table, Settings2, Layers, Users, ClipboardCheck, Ban, FileText, DollarSign, Scale } from 'lucide-react';
import profitLeakImg from '@/assets/profit-leak-preview.png';
import feeAlertsImg from '@/assets/fee-alerts-preview.png';
import PublicDemoUpload from '@/components/PublicDemoUpload';
import { supabase } from '@/integrations/supabase/client';

const marketplaceLogos = [
  { name: 'Amazon AU', icon: '📦' },
  { name: 'Shopify', icon: '💳' },
  { name: 'BigW', icon: '🏬' },
  { name: 'MyDeal', icon: '🏷️' },
  { name: 'Everyday Market', icon: '🛒' },
  { name: 'Bunnings', icon: '🔨' },
  { name: 'Catch', icon: '🎯' },
  { name: 'Kogan', icon: '📱' },
  { name: 'eBay AU', icon: '🏪' },
];

export default function Landing() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Handle Shopify redirecting to App URL (/) instead of callback URL
  useEffect(() => {
    const shop = searchParams.get('shop');
    const hmac = searchParams.get('hmac');
    const host = searchParams.get('host');
    const code = searchParams.get('code');

    if (shop && hmac && host && !code) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          navigate('/dashboard', { replace: true });
        } else {
          navigate('/auth', { replace: true });
        }
      });
    }
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight">
              <span className="text-primary">Xe</span><span className="text-foreground">ttle</span>
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2">
              Marketplace settlements → Xero, automatically
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
                Start free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* ════════════════════════════════════════════════════════════════════
          HERO
          ════════════════════════════════════════════════════════════════════ */}
      <section className="pt-32 pb-12 px-4">
        <div className="container-custom text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-bold mb-6 tracking-wide">
            <Zap className="h-4 w-4" />
            MARKETPLACE ACCOUNTING, SOLVED
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            You sell on 4 marketplaces.
            <br />
            <span className="text-primary">Your accountant is losing their mind.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-2">
            Xettle pulls every settlement from Amazon, Shopify, BigW, MyDeal and more — calculates every fee, and pushes clean invoices to Xero. Automatically.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-10">
            No card needed · Works in minutes · Australian GST built in
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button size="lg" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                Start free — no card needed <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" onClick={() => {
              document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              See how it works
            </Button>
          </div>

          {/* Public Demo Upload */}
          <PublicDemoUpload />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          STATIC "WOW" PREVIEW
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
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
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
          PAIN SECTION
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Most Australian marketplace sellers have the same problem.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">5 different settlement formats</h3>
              <p className="text-sm text-muted-foreground">
                Amazon TSV, Shopify CSV, BigW remittance, MyDeal payout, Everyday Market report. All different. All manual.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <DollarSign className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Fees that don't add up</h3>
              <p className="text-sm text-muted-foreground">
                Commission, FBA, transaction fees, monthly subscriptions. By the time you calculate net profit, you've lost an hour.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <Scale className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Xero that never matches the bank</h3>
              <p className="text-sm text-muted-foreground">
                Every settlement hits your bank as one lump sum. Reconciling it manually takes forever and still feels wrong.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SOLUTION SECTION
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4" id="how-it-works">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Xettle handles every Australian marketplace.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Drop any file — or connect your API. Xettle auto-detects the format, splits mixed files by marketplace, calculates every fee, and creates the right Xero invoice automatically.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Layers className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Auto-detect any format</h3>
              <p className="text-muted-foreground text-sm">
                Amazon TSV, Shopify CSV, Bunnings PDF, BigW remittance, or anything new. If we haven't seen it before, we'll figure it out and remember it.
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Table className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Split mixed marketplace files</h3>
              <p className="text-muted-foreground text-sm">
                One payment from Woolworths MarketPlus covering BigW, MyDeal and Everyday Market? We split it into three separate settlements automatically.
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Push to Xero, correctly</h3>
              <p className="text-muted-foreground text-sm">
                Sales, refunds, fees and GST mapped to the right accounts. Your bookkeeper will actually enjoy month-end.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          MARKETPLACE LOGOS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-8">
            Works with every marketplace Australians actually sell on.
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            {marketplaceLogos.map((m) => (
              <span
                key={m.name}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-medium border bg-background text-foreground border-border"
              >
                <span>{m.icon}</span>
                {m.name}
              </span>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Selling somewhere else? Drop the file — we'll figure it out.
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SOCIAL PROOF / STATS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Built for sellers with more than one marketplace.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <p className="text-4xl font-bold text-primary mb-3">4+</p>
              <p className="text-sm text-muted-foreground">
                The average Xettle user sells on 4+ marketplaces
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <p className="text-4xl font-bold text-primary mb-3">3 min</p>
              <p className="text-sm text-muted-foreground">
                Settlement reconciliation that used to take 3 hours now takes 3 minutes
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-card">
              <p className="text-4xl font-bold text-primary mb-3">100%</p>
              <p className="text-sm text-muted-foreground">
                Australian — GST, ATO reporting, and Xero built in from day one
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          THREE STEPS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-16">
            Three steps. Xettled.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Connect your marketplaces', desc: 'Amazon and Shopify connect via API. BigW, MyDeal and others just need a file upload.' },
              { step: '02', title: 'We handle everything', desc: 'Xettle auto-syncs, parses every format, splits mixed files, and calculates the real net after every fee.' },
              { step: '03', title: 'Xero stays clean', desc: 'Every settlement becomes a correctly coded invoice. Your bank reconciles. Your accountant relaxes.' },
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
      <section className="py-20 px-4">
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
      <section className="py-20 px-4 bg-card border-y border-border">
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
      <section className="py-16 px-4">
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
            <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
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
          FINAL CTA
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            See the result first. Sign up second.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Upload a real settlement file before you create an account. See exactly what Xettle does with your data — no commitment, no card.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-10 py-6" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              Try with your own data <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                Create Free Account
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
