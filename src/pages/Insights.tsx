import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import XettleLogo from '@/components/shared/XettleLogo';
import {
  ArrowRight, CheckCircle, Ban, AlertTriangle, Package, Truck, DollarSign,
  Shield, BarChart3, Layers, Receipt, Store, Zap, TrendingUp,
  Eye, Search, Megaphone, Info, PieChart, LineChart
} from 'lucide-react';
import insightsComparisonImg from '@/assets/insights-marketplace-comparison.png';
import insightsFeeTrendsImg from '@/assets/insights-fee-trends.png';
import profitLeakImg from '@/assets/profit-leak-preview.png';
import feeAlertsImg from '@/assets/fee-alerts-preview.png';

export default function Insights() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <XettleLogo height={32} />
            <span className="hidden sm:inline text-xs text-muted-foreground border-l border-border pl-2">
              Marketplace cost intelligence
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
            <BarChart3 className="h-4 w-4" />
            MARKETPLACE COST INTELLIGENCE
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Know what each marketplace<br />
            <span className="text-primary">actually costs you.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
            Other tools show you revenue. Xettle shows you the real cost of selling — marketplace fees, shipping costs, ad spend, and fee changes — broken down per channel, per settlement period.
          </p>
          <p className="text-sm text-muted-foreground/80 mb-10">
            Not a full COGS platform. Marketplace cost intelligence — the costs between your sale and your bank deposit.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                See your marketplace costs <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ══════════ THE REAL PROBLEM ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Revenue doesn't tell you anything.<br />Costs do.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              You made $5,000 on Kogan last month. But after commission, shipping, packing, and ad spend — what actually landed in your bank? Most tools can't answer that.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: DollarSign, title: 'Marketplace fees vary', desc: 'Kogan charges 12%. BigW charges 8%. Catch charges 12%. eBay charges 13%. These aren\'t fixed — they change between settlements, and most tools don\'t track the shifts.' },
              { icon: Truck, title: 'Shipping costs are invisible', desc: 'When you sell on Kogan or Bunnings, you\'re shipping those orders yourself. That postage cost eats into your margin — but other accounting tools don\'t let you attribute it to the marketplace.' },
              { icon: Megaphone, title: 'Ad spend is disconnected', desc: 'You spend $500/month on Amazon Sponsored Products. That comes off your settlement, but most tools don\'t connect it to the marketplace profitability view.' },
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

      {/* ══════════ WHAT XETTLE TRACKS ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold">
                <Layers className="h-3.5 w-3.5" />
                Cost layers
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Four layers of cost.<br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">All visible. All per marketplace.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Xettle tracks the costs between your gross sale and your bank deposit. These are the costs most accounting tools ignore — because they're focused on posting journals, not analysing profitability.
              </p>
              <div className="space-y-5">
                {[
                  { label: 'Marketplace fees', detail: 'Commission, referral fees, platform fees — extracted from every settlement. Where the rate is estimated (e.g. Shopify sub-channels), it\'s clearly badged with the rate used.' },
                  { label: 'Fulfilment & shipping costs', detail: 'FBA fees from Amazon. Your own postage costs for FBM, Kogan, Bunnings, and other self-ship marketplaces. Set per marketplace, deducted per order in your profit view.' },
                  { label: 'Advertising spend', detail: 'Amazon advertising is deducted at settlement. For other marketplaces, log your monthly ad spend and Xettle attributes it to the right channel.' },
                  { label: 'Refunds & adjustments', detail: 'Refund amounts, marketplace adjustment credits, reimbursements — each tracked separately so you see the real net payout.' },
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
                src={insightsComparisonImg}
                alt="Marketplace cost comparison dashboard showing revenue, fees, shipping costs, and margins"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
              <div className="absolute bottom-3 right-3">
                <span className="bg-background/90 backdrop-blur-sm text-[10px] text-muted-foreground px-2 py-1 rounded-full border border-border">
                  Xettle Insights dashboard
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ HONEST POSITIONING ══════════ */}
      <section className="py-16 px-4 bg-muted/30 border-y border-border">
        <div className="container-custom max-w-3xl mx-auto">
          <div className="flex items-start gap-4 p-6 rounded-2xl border border-border bg-background">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Info className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground mb-2">What Xettle is — and isn't</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Xettle is <span className="font-semibold text-foreground">marketplace cost intelligence</span> — not a full cost-of-goods-sold (COGS) platform. We track the costs between your sale and your bank deposit: marketplace fees, fulfilment charges, shipping costs, and ad spend.
              </p>
              <p className="text-sm text-muted-foreground mb-3">
                We don't track manufacturing costs, warehousing overhead, or per-unit product costs at the order level (though you can add SKU costs for basic margin analysis). Our strength is showing you what each <span className="font-semibold text-foreground">marketplace channel</span> costs to sell on — so you can compare Kogan vs Bunnings vs Amazon and make informed decisions.
              </p>
              <p className="text-sm text-muted-foreground">
                Where fees are estimated (e.g. commission rates for Shopify sub-channels without settlement data), we clearly badge it — and show the rate we used. As more settlements are processed, observed rates replace estimates automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ FEE TRACKING & ALERTS ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 space-y-6">
              <div className="inline-flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-1 rounded-full text-xs font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                Fee monitoring
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Marketplaces change fees.<br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">Xettle catches it.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Commission rates, fulfilment charges, and platform fees shift between settlements — often without notice. Xettle's fee observation engine compares every settlement against historical rates and alerts you when something changes.
              </p>
              <div className="space-y-3">
                {[
                  'Commission rate changes detected across settlements',
                  'Implied fee rates calculated from actual settlement data',
                  'Estimated rates clearly badged — observed rates replace them over time',
                  'Fee deviation alerts with old rate, new rate, and impact',
                  'Historical trend comparison across settlement periods',
                ].map(item => (
                  <div key={item} className="flex items-start gap-2.5">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2 relative">
              <img
                src={feeAlertsImg}
                alt="Fee change alerts showing commission rate changes and deviation detection"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ MARKETPLACE COMPARISON ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="relative">
              <img
                src={profitLeakImg}
                alt="Marketplace profitability comparison showing fee breakdown across channels"
                className="rounded-2xl border border-border shadow-xl w-full"
                loading="lazy"
              />
            </div>
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold">
                <TrendingUp className="h-3.5 w-3.5" />
                Cross-channel comparison
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                Compare every marketplace.<br />
                <span className="text-muted-foreground text-2xl md:text-3xl font-semibold">Side by side. Same metrics.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                See exactly how each channel performs — not just revenue, but the real cost of selling on each platform. Every connected marketplace in one view.
              </p>
              <div className="space-y-4">
                {[
                  { label: 'Payout margin', detail: 'What percentage of gross sales actually landed in your bank — after all marketplace deductions.' },
                  { label: 'Fee load breakdown', detail: 'Commission, FBA, storage, refunds, advertising — see which fees dominate on each marketplace.' },
                  { label: 'Shipping cost impact', detail: 'Self-ship marketplaces (Kogan, Bunnings, FBM) show the postage cost you set — deducted from your profit view.' },
                  { label: 'Return ratio', detail: 'Refund rates per marketplace. Know which channels have the highest return costs.' },
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
          </div>
        </div>
      </section>

      {/* ══════════ SHIPPING COSTS ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-semibold mb-4">
              <Truck className="h-3.5 w-3.5" />
              Shipping cost attribution
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Your shipping costs matter.<br />Other tools ignore them.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              When you sell on Kogan, Bunnings, or any FBM channel — you're paying to ship those orders. That cost should be attributed to the marketplace. Xettle lets you set shipping costs per marketplace and per fulfilment method — and deducts them from your profit view.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Xettle approach */}
            <div className="p-6 rounded-2xl border-2 border-primary/30 bg-primary/5">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Xettle — Shipping attributed</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Set postage cost per marketplace (e.g. $8.50 for Kogan)',
                  'FBA/FBM/MCF — each fulfilment method has its own cost',
                  'Shipping cost deducted per order in profit calculations',
                  'Mixed fulfilment (FBA + FBM) handled per order line',
                  'See the real margin after shipping — per marketplace',
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
                <h3 className="text-lg font-semibold text-foreground">Other tools — Shipping invisible</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'No way to attribute shipping costs to a marketplace',
                  'FBA and FBM orders treated identically for costing',
                  'Profit margins inflated — shipping costs missing',
                  'Seller has no idea which channels are truly profitable',
                  '"Revenue" reported, but not real profit after delivery costs',
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

      {/* ══════════ WHAT YOU SEE ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              What Xettle shows you.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Every chart and metric is sourced from real settlement data — not order estimates. Here's what you get in the Insights dashboard.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: 'Marketplace profit ranking', desc: 'All connected marketplaces ranked by payout margin. Those without SKU cost data show payout margin (bank deposit ÷ gross sales) for comparison.' },
              { icon: TrendingUp, title: '12-month trend view', desc: 'Revenue, fees, refunds, and net deposit trended over 12 months. Spot seasonal patterns and fee impacts across settlement periods.' },
              { icon: DollarSign, title: 'Fee load analysis', desc: 'Per-marketplace fee breakdown: commission, FBA, storage, refunds, other. See which fee types dominate each channel.' },
              { icon: Receipt, title: 'GST summary by quarter', desc: 'GST on income vs GST on expenses — aligned to ATO quarters. Useful for BAS preparation alongside your Xero data.' },
              { icon: AlertTriangle, title: 'Fee change alerts', desc: 'When a commission rate or fulfilment fee changes between settlements, Xettle flags it with the old rate, new rate, and dollar impact.' },
              { icon: Truck, title: 'Shipping cost impact', desc: 'See the postage cost per marketplace. Compare "margin before shipping" vs "margin after shipping" to understand the real cost of self-fulfilment.' },
              { icon: Megaphone, title: 'Ad spend attribution', desc: 'Log monthly ad spend per marketplace. Xettle shows "return after ads" — payout margin minus advertising costs.' },
              { icon: Store, title: 'Channel comparison table', desc: 'Side-by-side metrics: revenue, fees, refunds, payout, margin, fee rate, return ratio — for every connected marketplace on one screen.' },
              { icon: Eye, title: 'Data quality badges', desc: 'Estimated fees are badged with the rate used. Missing cost data is flagged. Anomalous margins are highlighted. You always know what\'s measured vs estimated.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-5 rounded-2xl border border-border bg-background">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ REAL EXAMPLE ══════════ */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              The difference shipping costs make.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Here's a real scenario. Without shipping attribution, Kogan looks profitable. With it, the picture changes.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl border border-border bg-card">
              <h3 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <Ban className="h-4 w-4 text-muted-foreground" />
                Without shipping costs
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Kogan gross sales</span><span className="font-medium text-foreground">$4,200</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Marketplace fees (12%)</span><span className="font-medium text-destructive">-$504</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Refunds</span><span className="font-medium text-destructive">-$180</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping cost</span><span className="font-medium text-muted-foreground">Not tracked</span></div>
                <div className="border-t border-border pt-2 mt-2 flex justify-between">
                  <span className="font-semibold text-foreground">Apparent margin</span>
                  <span className="font-bold text-primary">83.7%</span>
                </div>
              </div>
            </div>
            <div className="p-6 rounded-2xl border-2 border-primary/30 bg-primary/5">
              <h3 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                With Xettle shipping attribution
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Kogan gross sales</span><span className="font-medium text-foreground">$4,200</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Marketplace fees (12%)</span><span className="font-medium text-destructive">-$504</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Refunds</span><span className="font-medium text-destructive">-$180</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping (42 orders × $8.50)</span><span className="font-medium text-destructive">-$357</span></div>
                <div className="border-t border-border pt-2 mt-2 flex justify-between">
                  <span className="font-semibold text-foreground">Real margin</span>
                  <span className="font-bold text-primary">75.2%</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3 italic">
                8.5% margin difference — just from shipping costs. Multiply that across 12 months and multiple marketplaces.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ CTA ══════════ */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Stop guessing your marketplace margins.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Upload your first settlement file and see the real cost of each marketplace — fees, shipping, refunds, and ad spend. All from verified settlement data. All in one dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-10 py-6" asChild>
              <Link to="/auth?tab=signup">
                See your real margins <ArrowRight className="ml-2 h-5 w-5" />
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
              <Link to="/marketplaces" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Marketplaces</Link>
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
