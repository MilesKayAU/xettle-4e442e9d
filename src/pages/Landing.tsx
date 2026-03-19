import { useEffect } from 'react';
import XettleLogo from '@/components/shared/XettleLogo';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Shield, Zap, FileSpreadsheet, RefreshCw, CheckCircle, Upload, Bot, Crown, Store, BarChart3, AlertTriangle, ScanSearch, FolderUp, Table, Settings2, Layers, Users, ClipboardCheck, Ban, FileText, DollarSign, Scale, ShieldCheck, Search, Lock, Repeat, Building2, Briefcase, Receipt, Activity, Eye, ListChecks, Fingerprint, Clock, BadgeCheck, Package, Truck, Split } from 'lucide-react';
import profitLeakImg from '@/assets/profit-leak-preview.png';
import feeAlertsImg from '@/assets/fee-alerts-preview.png';
import PublicDemoUpload from '@/components/PublicDemoUpload';
import { supabase } from '@/integrations/supabase/client';

const marketplaceLogos = [
  { name: 'Amazon AU', icon: '📦' },
  { name: 'Shopify', icon: '💳' },
  { name: 'eBay AU', icon: '🏪' },
  { name: 'Bunnings', icon: '🔨' },
  { name: 'Kogan', icon: '📱' },
  { name: 'Catch', icon: '🎯' },
  { name: 'BigW', icon: '🏬' },
  { name: 'MyDeal', icon: '🏷️' },
  { name: 'Everyday Market', icon: '🛒' },
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
            <XettleLogo height={32} />
            <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2">
              Australian marketplace settlements → verified Xero invoices
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
            BUILT FOR AUSTRALIAN SELLERS ON XERO
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Marketplace settlements
            <br />
            <span className="text-primary">verified and posted to Xero.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-2">
            Xettle parses your marketplace settlements, validates totals, and posts verified DRAFT invoices to Xero — with GST, account codes, and a full audit trail. Amazon, Shopify, eBay, Bunnings, Kogan, Catch, MyDeal and more.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-10">
            Not a file uploader. A settlement engine with duplicate prevention, push-safety preview, and Xero deposit verification built in.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button size="lg" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                Connect your marketplaces <ArrowRight className="ml-2 h-5 w-5" />
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
                      <CheckCircle className="h-3 w-3" /> Verified
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
                <p className="text-sm font-semibold text-foreground">Xero Invoice — Verified &amp; ready to post</p>
              </div>
              <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-mono text-foreground">Xettle-AMZN-1234</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span className="font-medium text-foreground">Amazon.com.au</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span className="text-foreground">12 Jan 2026</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold text-foreground">AUD $2,726.74</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">✓ DRAFT</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/60 text-center mt-3 italic">Posted as DRAFT — your accountant reviews before authorising</p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          THE REAL PROBLEM
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              The real problem isn't the files.<br />It's the reconciliation.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Every Australian marketplace seller faces the same broken workflow.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 mb-12">
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Multiple settlement formats</h3>
              <p className="text-sm text-muted-foreground">
                Amazon TSV, Shopify CSV, Bunnings remittance, BigW payout, eBay report. Every marketplace sends something different.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <DollarSign className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Fees change without notice</h3>
              <p className="text-sm text-muted-foreground">
                Commission rates, fulfilment charges, platform fees — they shift between settlements. By the time you notice, the books are wrong.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <Scale className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Deposits never match</h3>
              <p className="text-sm text-muted-foreground">
                The bank gets one lump sum. The settlement says something different. Your accountant spends hours making them agree.
              </p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <Repeat className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Duplicate invoices everywhere</h3>
              <p className="text-sm text-muted-foreground">
                Re-upload a file, push the wrong period, or switch tools — and your Xero is full of duplicates that take hours to clean up.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Accountants fixing it manually</h3>
              <p className="text-sm text-muted-foreground">
                Every month, the same cycle: download CSVs, calculate fees, create invoices, reconcile bank feeds. For every marketplace. Manually.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          WHAT XETTLE ACTUALLY DOES — 7-STEP FLOW
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4" id="how-it-works">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Not upload → push.<br />Verify → reconcile → approve → post.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              A complete settlement engine — from marketplace to Xero, with verification and reconciliation at every step.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[
              { step: '01', icon: Store, title: 'Connect marketplace', desc: 'API for Amazon & Shopify. File upload for Bunnings, eBay, Kogan, BigW, Catch, MyDeal and more.' },
              { step: '02', icon: Search, title: 'Parse & verify settlement', desc: 'Auto-detect format, split mixed files, validate every line item. Sales + fees + refunds must balance.' },
              { step: '03', icon: DollarSign, title: 'Verify deposit in Xero', desc: 'Optionally match the settlement payout against a deposit already in Xero. Tolerance-based matching handles rounding.' },
              { step: '04', icon: AlertTriangle, title: 'Surface exceptions', desc: 'Missing contacts, duplicate settlements, fee changes, locked periods — caught and surfaced before posting.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="p-5 rounded-2xl border border-border bg-card">
                  <div className="text-3xl font-bold text-primary/20 mb-3">{item.step}</div>
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-1.5">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              );
            })}
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { step: '05', icon: FileSpreadsheet, title: 'Generate Xero invoice', desc: 'Sales, shipping, commission, FBA, storage, refunds, reimbursements — each mapped to your Xero account codes. We suggest mappings and flag missing accounts — your bookkeeper stays in control.' },
              { step: '06', icon: ShieldCheck, title: 'Post safely as DRAFT', desc: 'Duplicate guard active. Audit CSV attached. Raw payload stored. Your accountant reviews before authorising.' },
              { step: '07', icon: Lock, title: 'Full audit history', desc: 'Every posting logged. Void and repost with replacement chain. Period locks respected. Nothing lost.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="p-5 rounded-2xl border border-border bg-card">
                  <div className="text-3xl font-bold text-primary/20 mb-3">{item.step}</div>
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-1.5">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
              );
            })}
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
            Selling somewhere else? Drop the settlement file — we'll figure it out and remember it.
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          WHY XETTLE IS DIFFERENT
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Why Xettle is different.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Not another bank-feed tool. A purpose-built settlement engine for Australian marketplace sellers on Xero.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: FileText, title: 'Settlement-first accounting', desc: 'Every invoice is generated from the settlement — the only source of truth for marketplace payouts. The faster you upload settlements, the faster your books are done in Xero.' },
              { icon: Split, title: 'Shopify sub-channel separation', desc: 'One Shopify store, multiple marketplaces. Xettle auto-detects Kogan, Catch, MyDeal, and other channels inside your Shopify payouts — and separates them for accounting.' },
              { icon: Eye, title: 'Push safety preview', desc: 'See exactly what will post to Xero before it happens. Line items, account codes, GST — previewed and validated. No surprise journals.' },
              { icon: Shield, title: 'Deduplication safeguards', desc: 'Fingerprint-based deduplication and idempotent syncing guard against duplicate invoices from re-uploads, split-month overlaps, and tool migrations.' },
              { icon: BarChart3, title: 'Fee transparency', desc: 'Where fees are estimated, we badge it — and show the rate we used. Observed commission rates improve over time as more settlements are processed.' },
              { icon: Truck, title: 'Fulfilment-aware profit', desc: 'FBA, FBM, MCF — each fulfilment method has different costs. Xettle tracks postage deductions by fulfilment channel so your profit view reflects reality.' },
              { icon: ShieldCheck, title: 'Accountant-safe posting', desc: 'Every invoice posts as DRAFT with audit CSV attached. Your accountant reviews before authorising. No surprises.' },
              { icon: Layers, title: 'Handles mixed files', desc: 'Woolworths MarketPlus covering BigW, MyDeal and Everyday Market? Automatically split into separate settlements.' },
              { icon: BarChart3, title: 'Built for Australia', desc: 'Australian GST, ATO reporting periods, and every marketplace Australian sellers actually use — built in from day one.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-border bg-card">
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

      {/* ════════════════════════════════════════════════════════════════════
          INVOICES, NOT JOURNALS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Receipt className="h-3.5 w-3.5" />
              Accounting model
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Invoices, not journals.<br />Simpler books.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Xettle uses a 1:1 invoice model — each settlement becomes one DRAFT invoice in Xero. Here's why that matters.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Xettle invoice model */}
            <div className="p-6 rounded-2xl border-2 border-primary/30 bg-primary/5">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Xettle — Invoice model</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'One DRAFT invoice per settlement period',
                  'Line items for sales, fees, refunds, and GST',
                  'Invoice total matches the marketplace payout',
                  'Your accountant reviews and authorises',
                  'Reconciles directly against Xero bank transactions',
                  'Full audit CSV attached to every invoice',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Journal model comparison */}
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
                  <Ban className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Other tools — Journal model</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Journal entries split across multiple accounts',
                  'No single document to review or approve',
                  'Harder to match against deposits in Xero',
                  'Requires clearing accounts and manual journals',
                  'Difficult to audit — no attached evidence',
                  'Accountants often redo the work manually',
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

      {/* ════════════════════════════════════════════════════════════════════
          POST TO XERO SAFELY — SAFETY SECTION
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold">
                <ShieldCheck className="h-3.5 w-3.5" />
                Accountant-grade posting
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Post to Xero safely.
                <br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">With safeguards at every step.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Posting marketplace settlements to Xero shouldn't break your books. Xettle verifies totals, checks for duplicates, prevents locked-period edits, and keeps a full audit trail — so every settlement posts cleanly.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Fingerprint, title: 'Deduplication safeguards', desc: 'Fingerprint-based deduplication and idempotent syncing guard against duplicate invoices from re-uploads, overlaps, and tool migrations.' },
                { icon: Repeat, title: 'Safe void & repost', desc: 'Void the original, repost with a replacement invoice. Full chain of custody. No orphaned entries.' },
                { icon: Eye, title: 'Audit trail', desc: 'Every posting is logged with the raw settlement payload, Xero response, and timestamp. Your accountant can verify any invoice.' },
                { icon: AlertTriangle, title: 'Exception inbox', desc: 'Missing contacts, attachment failures, posting blocks — all caught and surfaced. Nothing silently fails.' },
                { icon: Lock, title: 'Period lock safety', desc: 'Locked months stay locked. Xettle blocks postings into finalised periods automatically.' },
                { icon: Activity, title: 'Xero deposit verification', desc: 'Optionally verify the settlement payout against a matching deposit already in Xero. Configurable per marketplace rail.' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="p-4 rounded-xl border border-border bg-background">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          RECONCILIATION ENGINE
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <ListChecks className="h-3.5 w-3.5" />
              Reconciliation engine
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Verify each settlement before posting to Xero.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Most tools push invoices and hope for the best. Xettle validates settlement totals, optionally checks deposits already in Xero, and surfaces exceptions — so you know the numbers are right before anything posts.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl border border-border bg-card text-center">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Receipt className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">Settlement verification</h3>
              <p className="text-sm text-muted-foreground">
                Settlement totals are validated — sales, fees, refunds, GST. Order-level drilldown where available. Totals must balance before the settlement is marked verified.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-card text-center">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">Xero deposit verification</h3>
              <p className="text-sm text-muted-foreground">
                Optionally match the settlement payout to a deposit already in Xero. Tolerance-based matching handles rounding — you confirm before it's linked.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-card text-center">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <BadgeCheck className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">Coverage tracking</h3>
              <p className="text-sm text-muted-foreground">
                See which periods have settlements, which are missing, and which have gaps — across every marketplace, on one screen. Some marketplace exports may not include transaction-level drilldown. Xettle warns you when drilldown is unavailable.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          MULTI-MARKETPLACE COMPLEXITY
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-6">
                <Layers className="h-3.5 w-3.5" />
                Not just one marketplace
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                Built for the mess of<br />real multi-marketplace selling.
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Most accounting tools assume one marketplace, one format, one schedule. Australian sellers don't work like that.
              </p>
              <div className="space-y-4">
                {[
                  { mp: 'Amazon AU', detail: 'Fortnightly TSV settlements via SP-API — FBA, FBM, MCF separated' },
                  { mp: 'Shopify', detail: 'Daily payouts with sub-channel detection — Kogan, Catch, MyDeal orders separated automatically' },
                  { mp: 'eBay AU', detail: 'Managed payments, fortnightly cycles' },
                  { mp: 'Bunnings', detail: 'Monthly CSV remittance' },
                  { mp: 'Kogan', detail: 'Monthly CSV with variable commission — observed rates tracked' },
                  { mp: 'Catch / MyDeal / BigW', detail: 'Woolworths MarketPlus — auto-split into separate settlements' },
                ].map(({ mp, detail }) => (
                  <div key={mp} className="flex items-start gap-3">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-1" />
                    <div>
                      <span className="text-sm font-semibold text-foreground">{mp}</span>
                      <span className="text-sm text-muted-foreground"> — {detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-8 rounded-2xl border border-border bg-background">
              <h3 className="text-lg font-semibold text-foreground mb-6">What other tools miss:</h3>
              <div className="space-y-5">
                {[
                  { problem: 'Mixed settlement files', solution: 'Auto-split into separate marketplace settlements' },
                  { problem: 'Different payout schedules', solution: 'Coverage map shows gaps across all channels' },
                  { problem: 'Commission rate changes', solution: 'Fee observation engine detects and alerts' },
                  { problem: 'Bank deposits that don\'t match', solution: 'Tolerance-based matching with manual override' },
                  { problem: 'CSV formats keep changing', solution: 'Fingerprint learning adapts to new layouts' },
                ].map(({ problem, solution }) => (
                  <div key={problem}>
                    <p className="text-sm font-medium text-destructive mb-0.5">❌ {problem}</p>
                    <p className="text-sm text-muted-foreground">→ {solution}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          NOT JUST UPLOADS — FULL SETTLEMENT ENGINE
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
            Not just uploads.<br />A full settlement engine.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-12">
            Xettle doesn't just create Xero invoices. It tracks each settlement, verifies payouts, matches deposits, handles exceptions, and keeps your accounting clean across every marketplace — with a complete audit trail. Every invoice is traceable back to the original settlement ID.
          </p>
          <div className="grid md:grid-cols-4 gap-4 text-left">
            {[
              { label: 'Settlement tracking', desc: 'Every payout period, every marketplace, one view' },
              { label: 'Payout verification', desc: 'Totals validated before anything posts' },
              { label: 'Bank matching', desc: 'Deposits reconciled against settlements' },
              { label: 'Exception handling', desc: 'Problems surfaced, never hidden' },
              { label: 'Duplicate guard', desc: 'Fingerprint dedup prevents double-posting' },
              { label: 'Safe repost', desc: 'Void and replace with full audit chain' },
              { label: 'Period locks', desc: 'Finalised months stay protected' },
              { label: 'Posting modes', desc: 'Per-rail control over how each channel posts' },
            ].map(({ label, desc }) => (
              <div key={label} className="p-4 rounded-xl border border-border bg-card">
                <p className="text-sm font-semibold text-foreground mb-1">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SOCIAL PROOF / STATS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Built for sellers with more than one marketplace.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-2xl border border-border bg-background">
              <p className="text-4xl font-bold text-primary mb-3">9+</p>
              <p className="text-sm text-muted-foreground">
                Australian marketplaces supported — Amazon, Shopify, eBay, Bunnings, Kogan, Catch, BigW, MyDeal, Everyday Market
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-background">
              <p className="text-4xl font-bold text-primary mb-3">DRAFT</p>
              <p className="text-sm text-muted-foreground">
                Every settlement posts as a DRAFT invoice — your accountant reviews before authorising. No surprise entries in Xero.
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-background">
              <p className="text-4xl font-bold text-primary mb-3">100%</p>
              <p className="text-sm text-muted-foreground">
                Australian — GST, ATO quarters, and Xero built in from day one. No US-centric assumptions.
              </p>
            </div>
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
              { step: '01', title: 'Connect your marketplaces', desc: 'Amazon and Shopify connect via API. Bunnings, eBay, Kogan, Catch and others — upload the settlement file.' },
              { step: '02', title: 'We verify everything', desc: 'Xettle parses every format, validates totals, matches bank deposits, and flags exceptions before anything reaches Xero.' },
              { step: '03', title: 'Xero stays clean', desc: 'Every verified settlement becomes a correctly coded DRAFT Xero invoice with full audit trail. Deduplication safeguards and a full audit trail — clean books.' },
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
          TRUST BAR
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-10 px-4 bg-muted/30">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <p className="text-sm font-medium text-muted-foreground tracking-wide">
            Trusted by Australian sellers on{' '}
            <span className="text-foreground font-semibold">Amazon</span> ·{' '}
            <span className="text-foreground font-semibold">Shopify</span> ·{' '}
            <span className="text-foreground font-semibold">eBay</span> ·{' '}
            <span className="text-foreground font-semibold">Bunnings</span> ·{' '}
            <span className="text-foreground font-semibold">Kogan</span> ·{' '}
            <span className="text-foreground font-semibold">Catch</span> ·{' '}
            <span className="text-foreground font-semibold">BigW</span> ·{' '}
            <span className="text-foreground font-semibold">MyDeal</span> ·{' '}
            <span className="text-foreground font-semibold">Everyday Market</span>
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          MARKETPLACE PROFITABILITY
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              See your real marketplace profitability
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              What landed in your bank after every marketplace fee and refund — verified against settlement data.
            </p>
          </div>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="relative">
              <img
                src={profitLeakImg}
                alt="Marketplace profitability breakdown showing fee-by-fee analysis across Amazon AU, Shopify and BigW"
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
                  <h3 className="text-lg font-semibold text-foreground mb-1">Settlement fee breakdown</h3>
                  <p className="text-muted-foreground text-sm">See exactly what the marketplace charged — commission, FBA fulfilment, refunds, and platform fees — verified from settlement data. Where fees are estimated, we badge it and show the rate used.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Fulfilment-aware costs</h3>
                  <p className="text-muted-foreground text-sm">FBA, FBM, MCF — each has different postage and fulfilment costs. Xettle deducts the right amount per fulfilment channel so your profit reflects what you actually paid to ship.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Store className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Compare marketplaces</h3>
                  <p className="text-muted-foreground text-sm">Instantly compare settlement margins from Bunnings vs Amazon vs Shopify — side by side. Track how margins shift as marketplaces adjust their fee structures.</p>
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
                Built-in Monitoring
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Auto-scan for fee changes &amp; discrepancies
              </h2>
              <p className="text-lg text-muted-foreground">
                Marketplaces change commission rates, add fees, or adjust shipping — often without notice. Xettle monitors every settlement automatically.
              </p>
              <ul className="space-y-3">
                {[
                  'Commission rate changes detected across settlements',
                  'Shipping &amp; fulfilment fee deviation alerts',
                  'Refund rate spikes flagged before posting',
                  'Historical trend comparison across periods',
                  'Dismiss or investigate — you stay in control',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5">
                    <ScanSearch className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground text-sm" dangerouslySetInnerHTML={{ __html: item }} />
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
          WHO IT'S FOR — 4 AUDIENCES
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Users className="h-3.5 w-3.5" />
              Built for everyone in the workflow
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Built for accountants too
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Store className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Marketplace Sellers</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  'Connect marketplaces and verify settlements',
                  'See what each marketplace actually costs you',
                  'Know your books are correct before BAS time',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Accountants &amp; Bookkeepers</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  'Every settlement posts as DRAFT — review before authorising',
                  'Audit trail with payload snapshots and posting history',
                  'Duplicate prevention and safe void/repost workflow',
                  'Clean Xero files without chasing marketplace CSVs',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-card">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Accounting Firms &amp; Agencies</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  'Standardise marketplace accounting across clients',
                  'Reduce manual data entry and month-end friction',
                  'Consistent settlement posting for every marketplace',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
              <p className="text-sm font-semibold text-foreground mb-2">Demo it to a client in 60 seconds:</p>
              <div className="space-y-3">
                {[
                  { num: '1', text: 'Ask them to export their settlement file' },
                  { num: '2', text: 'Drop it on xettle.app — no signup needed' },
                  { num: '3', text: 'Show them the verified Xero invoice preview' },
                  { num: '4', text: 'They sign up. You both save hours every month.' },
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
            Upload a real settlement file before you create an account. See exactly how Xettle verifies and posts your data — no commitment, no card.
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
              © {new Date().getFullYear()} Xettle. Australian marketplace settlements → verified Xero invoices.
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
