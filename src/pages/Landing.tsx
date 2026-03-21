import { useEffect } from 'react';
import XettleLogo from '@/components/shared/XettleLogo';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRight, Shield, Zap, FileSpreadsheet, RefreshCw, CheckCircle, Upload, Bot, Crown, Store, BarChart3, AlertTriangle, ScanSearch, FolderUp, Table, Settings2, Layers, Users, ClipboardCheck, Ban, FileText, DollarSign, Scale, ShieldCheck, Search, Lock, Repeat, Building2, Briefcase, Receipt, Activity, Eye, ListChecks, Fingerprint, Clock, BadgeCheck, Package, Truck, Split, Sparkles, Brain } from 'lucide-react';
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
              AI-powered marketplace accounting for Xero
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/amazon">Amazon AU</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => {
              document.getElementById('xero-section')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              Xero
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

      {/* ════════════════════════════════════════════════════════════════════
          HERO
          ════════════════════════════════════════════════════════════════════ */}
      <section className="pt-32 pb-12 px-4">
        <div className="container-custom text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-bold mb-6 tracking-wide">
            <Brain className="h-4 w-4" />
            AI-POWERED · XERO-NATIVE · ANY MARKETPLACE
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Every marketplace settlement.
            <br />
            <span className="text-primary">Verified and posted to Xero.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-2">
            Xettle's AI parses any marketplace settlement — Amazon, Shopify, eBay, Bunnings, Kogan, Catch, BigW, MyDeal or anything else — verifies every line, and posts a clean DRAFT invoice to Xero. With GST, account codes, and a full audit trail.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-10">
            Not limited to Amazon and Shopify like other tools. Drop any settlement file — our AI figures it out.
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
          STATIC "WOW" PREVIEW — Multi-marketplace
          ════════════════════════════════════════════════════════════════════ */}
      <section className="pb-16 px-4">
        <div className="container-custom max-w-4xl mx-auto">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider text-center mb-4">Here's what you'll see — from any marketplace</p>
          <div className="grid md:grid-cols-3 gap-4">
            {/* Kogan settlement preview */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📱</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Kogan Settlement</p>
                  <p className="text-xs text-muted-foreground">Feb 1 – Feb 28, 2026</p>
                </div>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Sales</span><span className="font-medium text-foreground">$4,812.00</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Commission</span><span className="font-medium text-destructive">-$721.80</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Refunds</span><span className="font-medium text-destructive">-$149.95</span></div>
                <div className="border-t border-border pt-2 mt-2 flex justify-between items-center">
                  <span className="font-semibold text-foreground text-xs">Payout</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary">$3,940.25</span>
                    <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                      <CheckCircle className="h-3 w-3" /> Verified
                    </span>
                  </div>
                </div>
              </div>
            </div>
            {/* Amazon settlement preview */}
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
                <div className="flex justify-between"><span className="text-muted-foreground">FBA + Seller Fees</span><span className="font-medium text-destructive">-$1,177.93</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Refunds</span><span className="font-medium text-destructive">-$65.45</span></div>
                <div className="border-t border-border pt-2 mt-2 flex justify-between items-center">
                  <span className="font-semibold text-foreground text-xs">Deposit</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary">$1,235.47</span>
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
                <p className="text-sm font-semibold text-foreground">→ Xero DRAFT Invoice</p>
              </div>
              <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-mono text-foreground text-xs">Xettle-KOGAN-0228</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span className="font-medium text-foreground">Kogan.com</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold text-foreground">AUD $3,940.25</span></div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">✓ DRAFT</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/60 text-center mt-3 italic">Your accountant reviews before authorising</p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          THE MARKET GAP
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              The tools that exist only work<br />with Amazon and Shopify.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              But Australian sellers sell on 9+ marketplaces. And every one of them has a different settlement format, payout schedule, and fee structure. Here's the reality:
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 mb-12">
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <Ban className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Most tools ignore your other channels</h3>
              <p className="text-sm text-muted-foreground">
                A2X, Link My Books — they support Amazon and Shopify. But if you sell on Bunnings, Kogan, Catch, BigW, MyDeal or eBay? You're on your own. Manual CSVs. Manual invoices. Every month.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Every marketplace sends something different</h3>
              <p className="text-sm text-muted-foreground">
                Amazon sends TSV files via SP-API. Shopify pushes daily payouts. Bunnings emails a monthly CSV. Kogan's format changes. BigW comes through Woolworths MarketPlus alongside Catch and MyDeal. None of them match.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Your accountant is stuck doing it manually</h3>
              <p className="text-sm text-muted-foreground">
                Download CSVs, figure out fees, create Xero invoices, match bank deposits — for every marketplace, every payout cycle. Hours of work that could be automated.
              </p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <DollarSign className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Fees change without notice</h3>
              <p className="text-sm text-muted-foreground">
                Commission rates, fulfilment charges, platform fees — they shift between settlements. By the time you notice, the books are wrong and BAS is due.
              </p>
            </div>
            <div className="p-6 rounded-2xl border border-border bg-background">
              <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <Repeat className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Xero ends up a mess</h3>
              <p className="text-sm text-muted-foreground">
                Duplicate invoices from re-uploads. Journal entries that don't match deposits. Missing account codes. No audit trail. The more marketplaces you sell on, the worse it gets.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          AI-POWERED CORE
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Brain className="h-3.5 w-3.5" />
              AI at the core
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              AI that understands settlement files<br />from any marketplace.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Most tools hardcode parsers for Amazon and Shopify. Xettle's AI reads any settlement file — detects the marketplace, maps the columns, separates fees, and learns the format for next time.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: ScanSearch, title: 'Auto-detect marketplace', desc: 'Drop any CSV, TSV or spreadsheet. Xettle\'s AI identifies the marketplace, maps the columns, and parses every line — no manual configuration needed.' },
              { icon: Fingerprint, title: 'Fingerprint learning', desc: 'New settlement format? The AI learns it. Next upload is instant. Even when marketplaces change their CSV layouts, Xettle adapts automatically.' },
              { icon: Sparkles, title: 'Intelligent account mapping', desc: 'AI suggests Xero account codes based on your existing Chart of Accounts pattern. Revenue accounts, expense categories, fee types — all mapped intelligently.' },
              { icon: Split, title: 'Auto-split mixed files', desc: 'Woolworths MarketPlus bundles Catch, BigW and MyDeal into one file. Xettle splits them into separate settlement records automatically.' },
              { icon: Bot, title: 'AI assistant built in', desc: 'Ask questions about your settlements, fees, or accounting setup. The AI assistant understands your marketplace data and can explain discrepancies.' },
              { icon: AlertTriangle, title: 'Fee anomaly detection', desc: 'AI monitors commission rates across settlements. When a marketplace changes its fee structure, you\'re alerted before posting — not after.' },
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
          MARKETPLACE LOGOS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
            Works with every marketplace Australians sell on.
          </h2>
          <p className="text-muted-foreground mb-8">
            API connections for Amazon &amp; Shopify. File upload for everything else — our AI handles the rest.
          </p>
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
            Selling somewhere else? Drop the settlement file — our AI figures it out and remembers it for next time.
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          XERO COA — ONE-CLICK SETUP
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4" id="xero-section">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-xs font-bold mb-4 tracking-wide">
              <Settings2 className="h-3.5 w-3.5" />
              XERO CHART OF ACCOUNTS
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Your entire Xero Chart of Accounts<br />
              <span className="text-primary">built in one click.</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              The hardest part of marketplace accounting on Xero isn't the settlements — it's setting up the right accounts. Revenue, fees, refunds, GST — for every marketplace. Xettle does it all for you.
            </p>
          </div>

          <Tabs defaultValue="new-to-xero" className="w-full">
            <TabsList className="grid w-full max-w-lg mx-auto grid-cols-2 mb-10">
              <TabsTrigger value="new-to-xero" className="text-sm">New to Xero</TabsTrigger>
              <TabsTrigger value="already-on-xero" className="text-sm">Already on Xero</TabsTrigger>
            </TabsList>

            {/* ─── NEW TO XERO ─────────────────────────────────────────── */}
            <TabsContent value="new-to-xero" className="space-y-10">
              <div className="grid lg:grid-cols-2 gap-12 items-start">
                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-foreground">
                    Skip the blank spreadsheet.<br />
                    <span className="text-primary">Xettle builds your Xero for you.</span>
                  </h3>
                  <p className="text-muted-foreground">
                    New Xero users face hours of setup: creating accounts for sales, fees, refunds, and GST —
                    for every marketplace, in the right account type, with the right codes. Most get it wrong.
                    Their bookkeeper fixes it later. Or worse, they don't.
                  </p>
                  <p className="text-muted-foreground">
                    Xettle detects which marketplaces you sell on and generates a properly structured
                    Chart of Accounts — Amazon, Shopify, Bunnings, Kogan, BigW, eBay — all set up correctly
                    and pushed to Xero in one click.
                  </p>
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
                    <p className="text-sm font-semibold text-foreground mb-3">What Xettle creates for you:</p>
                    <ul className="space-y-2">
                      {[
                        'Revenue accounts for each marketplace (Amazon Sales, Kogan Sales, Bunnings Sales, etc.)',
                        'Expense accounts for commission, FBA, fulfilment, storage, and advertising fees',
                        'Refund and reimbursement accounts separated by channel',
                        'Correct account types (Revenue vs Direct Costs) — no misclassification',
                        'Numbered codes following Xero best-practice ranges (200s for revenue, 400s for expenses)',
                        'All pushed directly to Xero — no manual data entry',
                      ].map(item => (
                        <li key={item} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span className="text-foreground">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Without Xettle */}
                  <div className="p-5 rounded-2xl border border-border bg-background">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                        <Clock className="h-4 w-4 text-destructive" />
                      </div>
                      <h4 className="text-sm font-semibold text-foreground">Without Xettle</h4>
                    </div>
                    <ol className="space-y-2.5 text-sm text-muted-foreground">
                      {[
                        'Sign up to Xero',
                        'Stare at a blank Chart of Accounts',
                        'Google "how to set up Xero for marketplace sellers"',
                        'Spend hours creating accounts for each marketplace',
                        'Get the account types wrong',
                        'Your bookkeeper fixes it at month-end',
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* With Xettle */}
                  <div className="p-5 rounded-2xl border-2 border-primary/30 bg-primary/5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Zap className="h-4 w-4 text-primary" />
                      </div>
                      <h4 className="text-sm font-semibold text-foreground">With Xettle</h4>
                    </div>
                    <ol className="space-y-2.5 text-sm">
                      {[
                        'Sign up to Xero',
                        'Connect your marketplaces to Xettle',
                        'Xettle detects Amazon, Shopify, Kogan, Bunnings, etc.',
                        'One click → your entire Chart of Accounts is built and pushed to Xero',
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          <span className="text-foreground">{step}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="text-xs text-primary font-semibold mt-3 flex items-center gap-1.5">
                      <Zap className="h-3 w-3" />
                      What takes an accountant an hour takes Xettle seconds.
                    </p>
                  </div>
                </div>
              </div>

              <div className="text-center pt-4">
                <Button size="lg" className="text-lg px-8 py-6" asChild>
                  <Link to="/auth?tab=signup">
                    Set up your Xero the smart way <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <p className="text-xs text-muted-foreground mt-3">No Xero account yet? That's fine — connect after setup.</p>
              </div>
            </TabsContent>

            {/* ─── ALREADY ON XERO ────────────────────────────────────── */}
            <TabsContent value="already-on-xero" className="space-y-10">
              <div className="grid lg:grid-cols-2 gap-12 items-start">
                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-foreground">
                    Already on Xero?<br />
                    <span className="text-primary">Xettle fills the gaps and upgrades your setup.</span>
                  </h3>
                  <p className="text-muted-foreground">
                    You've got Xero set up. Maybe you're doing marketplace accounting manually — downloading CSVs,
                    creating invoices, matching bank deposits. Maybe you've tried other tools and they've created
                    duplicate invoices or journal entries your accountant had to clean up.
                  </p>
                  <p className="text-muted-foreground">
                    Xettle reads your current Chart of Accounts, detects which marketplace accounts you already have,
                    and fills the gaps — matching your existing code numbering pattern. No starting over. No duplicates. Just a clean upgrade.
                  </p>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-foreground">What Xettle does with your existing Xero:</p>
                    {[
                      { icon: Search, title: 'Scans your existing COA', desc: 'Detects marketplace accounts you already have — Amazon Sales, Shopify Fees, etc.' },
                      { icon: Sparkles, title: 'Fills the gaps intelligently', desc: 'New marketplace? Xettle suggests accounts that match your existing numbering pattern.' },
                      { icon: ShieldCheck, title: 'Preview before creating', desc: 'See exactly what will be added to Xero — new, changed, unchanged — before anything happens.' },
                      { icon: Lock, title: 'Never overwrites by default', desc: 'Create-only mode is the default. Overwrite requires explicit confirmation + PIN.' },
                    ].map(({ icon: Icon, title, desc }) => (
                      <div key={title} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{title}</p>
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="p-5 rounded-2xl border border-border bg-background">
                    <h4 className="text-sm font-semibold text-foreground mb-4">Common problems Xettle eliminates:</h4>
                    <div className="space-y-4">
                      {[
                        { problem: 'Downloading CSVs every payout cycle', solution: 'API connections for Amazon & Shopify. Upload once for others — Xettle\'s AI remembers the format.' },
                        { problem: 'Manually creating Xero invoices', solution: 'Every verified settlement becomes a DRAFT invoice with correct line items and GST.' },
                        { problem: 'Bank deposits that don\'t match', solution: 'Tolerance-based deposit verification against transactions already in Xero.' },
                        { problem: 'Duplicate invoices from re-uploads', solution: 'Fingerprint-based deduplication — the same settlement can\'t post twice.' },
                        { problem: 'Accountant spending hours on marketplace accounting', solution: 'Clean DRAFT invoices with audit CSVs attached. Review and authorise, not recreate.' },
                      ].map(({ problem, solution }) => (
                        <div key={problem}>
                          <p className="text-sm font-medium text-destructive mb-0.5 flex items-start gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            {problem}
                          </p>
                          <p className="text-sm text-muted-foreground pl-5">→ {solution}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-5 rounded-2xl border-2 border-primary/30 bg-primary/5">
                    <p className="text-sm font-semibold text-foreground mb-2">Switching from A2X or Link My Books?</p>
                    <p className="text-sm text-muted-foreground">
                      Xettle's deduplication engine detects existing Xero invoices and prevents double-posting.
                      Your existing data stays clean while Xettle takes over future postings.
                    </p>
                  </div>
                </div>
              </div>

              <div className="text-center pt-4">
                <Button size="lg" className="text-lg px-8 py-6" asChild>
                  <Link to="/auth?tab=signup">
                    Upgrade your Xero setup <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          HOW IT WORKS — 7-STEP FLOW
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border" id="how-it-works">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Not upload → push.<br />Verify → reconcile → approve → post.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              A complete settlement engine — from any marketplace to Xero, with AI verification and reconciliation at every step.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[
              { step: '01', icon: Store, title: 'Connect or upload', desc: 'API sync for Amazon & Shopify. File upload for Bunnings, eBay, Kogan, BigW, Catch, MyDeal and any other marketplace. AI detects the format.' },
              { step: '02', icon: Brain, title: 'AI parses & verifies', desc: 'Auto-detect marketplace and format. Split mixed files. Validate every line item. Sales + fees + refunds must balance.' },
              { step: '03', icon: DollarSign, title: 'Verify against Xero', desc: 'Optionally match the settlement payout against a deposit already in Xero. Tolerance-based matching handles rounding.' },
              { step: '04', icon: AlertTriangle, title: 'Surface exceptions', desc: 'Missing contacts, duplicate settlements, fee changes, locked periods — caught and surfaced before posting.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="p-5 rounded-2xl border border-border bg-background">
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
              { step: '05', icon: FileSpreadsheet, title: 'Generate Xero invoice', desc: 'Sales, shipping, commission, fulfilment, storage, refunds, reimbursements — each mapped to your Xero account codes. AI suggests mappings and flags missing accounts.' },
              { step: '06', icon: ShieldCheck, title: 'Post safely as DRAFT', desc: 'Duplicate guard active. Audit CSV attached. Raw payload stored. Your accountant reviews before authorising.' },
              { step: '07', icon: Lock, title: 'Full audit history', desc: 'Every posting logged. Void and repost with replacement chain. Period locks respected. Nothing lost.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="p-5 rounded-2xl border border-border bg-background">
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
          INVOICES, NOT JOURNALS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Receipt className="h-3.5 w-3.5" />
              Xero-native approach
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Invoices, not journals.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Most tools post journal entries — debits and credits across multiple accounts. Hard to audit, hard to match, hard for your accountant. Xettle posts one DRAFT invoice per settlement. Simple.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
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
          POST TO XERO SAFELY
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
                { icon: Eye, title: 'Push safety preview', desc: 'See exactly what will post to Xero before it happens. Line items, account codes, GST — previewed and validated.' },
                { icon: Fingerprint, title: 'Deduplication', desc: 'Fingerprint-based deduplication guards against duplicate invoices from re-uploads, overlaps, and tool migrations.' },
                { icon: Repeat, title: 'Safe void & repost', desc: 'Void the original, repost with a replacement invoice. Full chain of custody. No orphaned entries.' },
                { icon: AlertTriangle, title: 'Exception inbox', desc: 'Missing contacts, attachment failures, posting blocks — all caught and surfaced. Nothing silently fails.' },
                { icon: Lock, title: 'Period lock safety', desc: 'Locked months stay locked. Xettle blocks postings into finalised periods automatically.' },
                { icon: Activity, title: 'Deposit verification', desc: 'Verify settlement payouts against matching deposits already in Xero. Configurable per marketplace.' },
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
          MULTI-MARKETPLACE COMPLEXITY
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-6">
                <Layers className="h-3.5 w-3.5" />
                Beyond Amazon &amp; Shopify
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
                Built for the reality of<br />Australian multi-marketplace selling.
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Other tools support two marketplaces. Australian sellers use nine or more. Different formats, different schedules, different fee structures. Xettle handles all of them.
              </p>
              <div className="space-y-4">
                {[
                  { mp: 'Amazon AU', detail: 'SP-API integration — FBA, FBM, MCF fees separated per order line' },
                  { mp: 'Shopify', detail: 'Daily payouts with sub-channel detection — Kogan, Catch, MyDeal orders separated automatically' },
                  { mp: 'eBay AU', detail: 'Managed payments with fortnightly settlement cycles' },
                  { mp: 'Bunnings', detail: 'Monthly CSV remittance — AI parses the format' },
                  { mp: 'Kogan', detail: 'Monthly CSV with variable commission — observed rates tracked' },
                  { mp: 'Catch / MyDeal / BigW', detail: 'Woolworths MarketPlus — auto-split into separate settlements' },
                  { mp: 'New marketplaces', detail: 'Drop the file — AI learns the format. No waiting for us to build support.' },
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
            <div className="p-8 rounded-2xl border border-border bg-card">
              <h3 className="text-lg font-semibold text-foreground mb-6">What other tools miss:</h3>
              <div className="space-y-5">
                {[
                  { problem: 'Only support Amazon & Shopify', solution: 'Xettle works with any marketplace — API or file upload' },
                  { problem: 'Mixed settlement files', solution: 'AI auto-splits into separate marketplace settlements' },
                  { problem: 'Different payout schedules', solution: 'Coverage map shows gaps across all channels' },
                  { problem: 'Commission rate changes', solution: 'Fee observation engine detects and alerts automatically' },
                  { problem: 'CSV formats keep changing', solution: 'AI fingerprint learning adapts to new layouts' },
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
          WHY XETTLE IS DIFFERENT — SUMMARY
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Why Xettle is different.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Not another Amazon-only tool. An AI-powered settlement engine for every Australian marketplace seller on Xero.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Brain, title: 'AI-powered processing', desc: 'AI parses any file format, detects marketplaces, maps accounts, learns layouts, and flags anomalies. Not hardcoded parsers — adaptive intelligence.' },
              { icon: FileText, title: 'Settlement-first accounting', desc: 'Every invoice is generated from the settlement — the only source of truth for marketplace payouts. Upload settlements, get verified Xero invoices.' },
              { icon: Settings2, title: 'One-click COA setup', desc: 'Build your entire Xero Chart of Accounts in one click. Revenue, fees, refunds — for every marketplace you sell on. Pushed directly to Xero.' },
              { icon: Split, title: 'Shopify sub-channel separation', desc: 'One Shopify store, multiple marketplaces. Xettle auto-detects Kogan, Catch, MyDeal inside your Shopify payouts — and separates them.' },
              { icon: Shield, title: 'Deduplication safeguards', desc: 'Fingerprint-based deduplication guards against duplicate invoices from re-uploads, split-month overlaps, and tool migrations.' },
              { icon: Truck, title: 'Fulfilment-aware profit', desc: 'FBA, FBM, MCF — each fulfilment method has different costs. Xettle tracks them separately so profit reflects reality.' },
              { icon: ShieldCheck, title: 'Accountant-safe posting', desc: 'Every invoice posts as DRAFT with audit CSV attached. Your accountant reviews before authorising. No surprises.' },
              { icon: Layers, title: 'Any marketplace, any format', desc: 'Not limited to Amazon and Shopify. Bunnings, Kogan, Catch, BigW, MyDeal, eBay — and any new marketplace you start selling on.' },
              { icon: BarChart3, title: '100% Australian', desc: 'Australian GST, ATO reporting periods, and every marketplace Australian sellers actually use — built in from day one. Not a US tool adapted for AU.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl border border-border bg-background">
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
          MARKETPLACE PROFITABILITY
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              See your real marketplace profitability
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              What landed in your bank after every marketplace fee and refund — verified against settlement data, across every channel.
            </p>
          </div>
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="relative">
              <img
                src={profitLeakImg}
                alt="Marketplace profitability breakdown showing fee-by-fee analysis across multiple marketplaces"
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
                  <p className="text-muted-foreground text-sm">See exactly what each marketplace charged — commission, fulfilment, refunds, and platform fees — verified from settlement data. Where fees are estimated, we badge it and show the rate used.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Truck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Fulfilment-aware costs</h3>
                  <p className="text-muted-foreground text-sm">FBA, FBM, MCF — each has different postage and fulfilment costs. Xettle deducts the right amount per fulfilment channel so your profit reflects what you actually paid.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Store className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">Compare every marketplace</h3>
                  <p className="text-muted-foreground text-sm">Instantly compare settlement margins from Bunnings vs Amazon vs Shopify vs Kogan — side by side. Track how margins shift as marketplaces adjust their fee structures.</p>
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
                Marketplaces change commission rates, add fees, or adjust shipping — often without notice. Xettle's AI monitors every settlement automatically across every channel.
              </p>
              <ul className="space-y-3">
                {[
                  'Commission rate changes detected across settlements',
                  'Fulfilment fee deviation alerts',
                  'Refund rate spikes flagged before posting',
                  'Historical trend comparison across periods',
                  'Works for every marketplace — not just Amazon',
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
                alt="Fee Change Alerts showing commission rate changes and status indicators across marketplaces"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          WHO IT'S FOR
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Users className="h-3.5 w-3.5" />
              Built for everyone in the workflow
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              For sellers and their accountants.
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
                  'Connect all your marketplaces — not just the big two',
                  'See what each marketplace actually costs you in fees',
                  'Know your books are correct before BAS time',
                  'Stop downloading CSVs and creating invoices manually',
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
                  'Standardise marketplace accounting across e-commerce clients',
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
                  { num: '1', text: 'Ask them to export a settlement file from any marketplace' },
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
          STATS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center p-6 rounded-2xl border border-border bg-background">
              <p className="text-4xl font-bold text-primary mb-3">9+</p>
              <p className="text-sm text-muted-foreground">
                Australian marketplaces supported
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-background">
              <p className="text-4xl font-bold text-primary mb-3">AI</p>
              <p className="text-sm text-muted-foreground">
                Powered core — adaptive parsing, not hardcoded
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-background">
              <p className="text-4xl font-bold text-primary mb-3">DRAFT</p>
              <p className="text-sm text-muted-foreground">
                Every settlement posts as DRAFT — your accountant reviews first
              </p>
            </div>
            <div className="text-center p-6 rounded-2xl border border-border bg-background">
              <p className="text-4xl font-bold text-primary mb-3">100%</p>
              <p className="text-sm text-muted-foreground">
                Australian — GST, ATO quarters, Xero-native
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          THREE STEPS
          ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-12">
            Three steps. Every marketplace. One Xero.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { num: '1', title: 'Connect', desc: 'Link your Xero account. Connect Amazon & Shopify via API. Upload files for everything else.', icon: RefreshCw },
              { num: '2', title: 'Verify', desc: 'AI parses every settlement, verifies totals, flags exceptions, and optionally checks against Xero deposits.', icon: CheckCircle },
              { num: '3', title: 'Post', desc: 'Verified DRAFT invoices posted to Xero — with GST, account codes, and audit trail. Your accountant reviews.', icon: FileSpreadsheet },
            ].map(({ num, title, desc, icon: Icon }) => (
              <div key={num} className="text-center">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">{title}</h3>
                <p className="text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-10">
            Works with{' '}
            <span className="text-foreground font-semibold">Amazon AU</span> ·{' '}
            <span className="text-foreground font-semibold">Shopify</span> ·{' '}
            <span className="text-foreground font-semibold">eBay</span> ·{' '}
            <span className="text-foreground font-semibold">Bunnings</span> ·{' '}
            <span className="text-foreground font-semibold">Kogan</span> ·{' '}
            <span className="text-foreground font-semibold">Catch</span> ·{' '}
            <span className="text-foreground font-semibold">BigW</span> ·{' '}
            <span className="text-foreground font-semibold">MyDeal</span> ·{' '}
            <span className="text-foreground font-semibold">Everyday Market</span> ·{' '}
            <span className="text-foreground font-semibold">and any new marketplace</span>
          </p>
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
            Upload a real settlement file from any marketplace before you create an account. See exactly how Xettle's AI verifies and posts your data — no commitment, no card.
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
              © {new Date().getFullYear()} Xettle. AI-powered marketplace accounting for Xero.
            </p>
            <div className="flex flex-wrap gap-6">
              <Link to="/amazon" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Amazon AU</Link>
              <Link to="/marketplaces" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Marketplaces</Link>
              <Link to="/insights" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Insights</Link>
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
