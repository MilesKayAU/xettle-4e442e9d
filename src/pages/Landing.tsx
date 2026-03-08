import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Shield, Zap, DollarSign, FileSpreadsheet, RefreshCw, Users, CheckCircle, Upload, Bot, Crown, Rocket, Store } from 'lucide-react';

const features = [
  {
    icon: FileSpreadsheet,
    title: 'Settlement Parsing',
    description: 'Upload marketplace settlement files and automatically categorise every transaction into proper accounting buckets.',
    free: true,
  },
  {
    icon: RefreshCw,
    title: 'One-Click Xero Sync',
    description: 'Push parsed settlements directly to Xero as invoices with correct account codes and GST handling.',
    free: true,
  },
  {
    icon: Bot,
    title: 'Auto-Import from Amazon (SP-API)',
    description: 'Connect your Seller Central account and let Xettle automatically fetch new settlement reports. More marketplaces coming soon.',
    free: false,
  },
  {
    icon: Shield,
    title: 'Your Data, Your Account',
    description: 'Each user connects their own Xero org. Your tokens are encrypted and isolated — nobody else can access your books.',
    free: true,
  },
  {
    icon: Zap,
    title: 'Smart Reconciliation',
    description: 'Automatic reconciliation checks ensure your parsed data matches the bank deposit before syncing to Xero.',
    free: true,
  },
  {
    icon: Store,
    title: 'Multi-Marketplace',
    description: 'Amazon and Bunnings supported today. Kogan, MyDeal, Woolworths, Big W and more coming soon.',
    free: true,
  },
];

const marketplaces = [
  { name: 'Amazon', status: 'live' },
  { name: 'Bunnings', status: 'live' },
  { name: 'Kogan', status: 'soon' },
  { name: 'MyDeal', status: 'soon' },
  { name: 'Woolworths', status: 'soon' },
  { name: 'Big W', status: 'soon' },
];

const trustSignals = [
  'Built by Australian marketplace sellers',
  'Australian GST handled correctly',
  'Works with Xero AU tax rules',
  'Your data stays in your own Xero',
  'Review every settlement before it posts',
  'Manual settlement uploads free forever',
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-background/80 backdrop-blur-md border-b border-border z-50">
        <div className="container-custom flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-bold text-foreground tracking-tight">
            <span className="text-primary">X</span>ettle
          </Link>
          <div className="flex items-center gap-3">
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

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="container-custom text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <Store className="h-4 w-4" />
            Marketplace settlement uploads · Paid auto-sync
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight mb-6">
            Marketplace settlements,
            <br />
            <span className="text-primary">Xettled.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
            Turn marketplace settlement reports into clean Xero invoices.
            <br />
            Works with Amazon today — Bunnings and more coming soon.
          </p>
          <p className="text-sm text-muted-foreground/70 mb-8 font-medium">
            <span className="text-primary font-semibold">X</span>ero + Se<span className="text-primary font-semibold">ttle</span> = <span className="text-primary font-semibold">Xettle</span>
          </p>

          {/* Marketplace strip */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
            {marketplaces.map((m) => (
              <span
                key={m.name}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border ${
                  m.status === 'live'
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-background text-muted-foreground border-border/60'
                }`}
              >
                {m.name}
                {m.status === 'soon' && (
                  <span className="text-[10px] opacity-60">soon</span>
                )}
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
              <a href="#pricing">See Plans</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Pricing / Plans */}
      <section id="pricing" className="py-16 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-foreground mb-3">
            Simple pricing
          </h2>
          <p className="text-muted-foreground text-center mb-10 max-w-xl mx-auto">
            Manual uploads are free forever. Upgrade when you want automation.
          </p>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Free */}
            <div className="rounded-2xl border-2 border-border bg-background p-8">
              <div className="flex items-center gap-2 mb-1">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-bold text-foreground">Free</h3>
              </div>
              <p className="text-4xl font-black text-foreground mb-1">$0</p>
              <p className="text-sm text-muted-foreground mb-6">forever</p>
              <ul className="space-y-3 text-sm mb-8">
                {[
                  'Upload settlement files manually',
                  'Full parsing & categorisation',
                  'Push to Xero with one click',
                  'GST handling for AU sellers',
                  'Smart reconciliation checks',
                  'Unlimited settlements',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/auth?tab=signup">Get Started Free</Link>
              </Button>
            </div>

            {/* Starter */}
            <div className="rounded-2xl border-2 border-primary bg-primary/5 p-8 relative">
              <div className="absolute -top-3 right-6">
                <span className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                  POPULAR
                </span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <Rocket className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-bold text-foreground">Starter</h3>
              </div>
              <p className="text-4xl font-black text-foreground mb-1">$129</p>
              <p className="text-sm text-muted-foreground mb-6">per year</p>
              <ul className="space-y-3 text-sm mb-8">
                {[
                  'Everything in Free, plus:',
                  'Amazon SP-API auto-fetch',
                  'New settlements fetched daily',
                  'Manual review & push to Xero',
                  'No more downloading CSVs',
                ].map((item, i) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle className={`h-4 w-4 shrink-0 mt-0.5 ${i === 0 ? 'text-muted-foreground' : 'text-primary'}`} />
                    <span className={`${i === 0 ? 'text-muted-foreground font-medium' : 'text-foreground'}`}>{item}</span>
                  </li>
                ))}
              </ul>
              <Button className="w-full" disabled>
                Coming Soon
              </Button>
            </div>

            {/* Pro */}
            <div className="rounded-2xl border-2 border-border bg-background p-8 relative">
              <div className="absolute -top-3 right-6">
                <span className="bg-muted text-muted-foreground text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                  <Crown className="h-3 w-3" /> PRO
                </span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <Crown className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-bold text-foreground">Pro</h3>
              </div>
              <p className="text-4xl font-black text-foreground mb-1">$229</p>
              <p className="text-sm text-muted-foreground mb-6">per year</p>
              <ul className="space-y-3 text-sm mb-8">
                {[
                  'Everything in Starter, plus:',
                  'Auto-push to Xero on schedule',
                  'Every 12 or 24 hour sync cycle',
                  'Toggle automations on/off anytime',
                  'Priority support & early access',
                ].map((item, i) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle className={`h-4 w-4 shrink-0 mt-0.5 ${i === 0 ? 'text-muted-foreground' : 'text-primary'}`} />
                    <span className={`${i === 0 ? 'text-muted-foreground font-medium' : 'text-foreground'}`}>{item}</span>
                  </li>
                ))}
              </ul>
              <Button className="w-full" variant="outline" disabled>
                Coming Soon
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-4">
        <div className="container-custom">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Everything you need to Xettle
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Built by marketplace sellers, for marketplace sellers. No bloat, no complexity.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border hover:border-primary/30 transition-colors relative">
                {!feature.free && (
                  <div className="absolute top-3 right-3">
                    <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Crown className="h-3 w-3" /> PRO
                    </span>
                  </div>
                )}
                <CardContent className="pt-6">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Signals */}
      <section className="py-16 px-4">
        <div className="container-custom max-w-3xl mx-auto">
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-8 md:p-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center mb-8">
              Built for Australian Marketplace Sellers
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {trustSignals.map((signal) => (
                <div key={signal} className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                  <span className="text-foreground font-medium">{signal}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-foreground mb-16">
            Three steps. Xettled.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Connect Xero', desc: 'Securely link your Xero organisation with one click. Your tokens are encrypted per-user.' },
              { step: '02', title: 'Upload or Auto-Sync', desc: 'Upload your marketplace settlement file — or let Pro auto-fetch from Amazon for you.' },
              { step: '03', title: 'Xettle It', desc: 'Review the breakdown, confirm reconciliation, and push. Your invoice appears in Xero instantly.' },
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

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="container-custom max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
            Marketplace settlements — Xettled.
          </h2>
          <p className="text-lg text-muted-foreground mb-10">
            Start with free manual uploads. Upgrade to Pro when you're ready to automate.
          </p>
          <Button size="lg" className="text-lg px-10 py-6" asChild>
            <Link to="/auth?tab=signup">
              Create Free Account <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container-custom flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} Xettle. Marketplace accounting for Xero.
            </p>
            <div className="flex gap-6">
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <Link to="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Terms of Service
              </Link>
              <a href="mailto:hello@xettle.app" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Contact
              </a>
              <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Sign In
              </Link>
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
