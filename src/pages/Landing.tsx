import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Shield, Zap, DollarSign, FileSpreadsheet, RefreshCw, Users, CheckCircle } from 'lucide-react';

const features = [
  {
    icon: FileSpreadsheet,
    title: 'Settlement Parsing',
    description: 'Upload Amazon settlement TSV files and automatically categorise every transaction into proper accounting buckets.',
  },
  {
    icon: RefreshCw,
    title: 'One-Click Xero Sync',
    description: 'Push parsed settlements directly to Xero as invoices with correct account codes, GST handling, and split-month support.',
  },
  {
    icon: Shield,
    title: 'Your Data, Your Account',
    description: 'Each user connects their own Xero org. Your tokens are encrypted and isolated — nobody else can access your books.',
  },
  {
    icon: DollarSign,
    title: 'Completely Free',
    description: 'No per-order fees, no monthly subscriptions. Full settlement sync without paying $20-80/month to competitors.',
  },
  {
    icon: Zap,
    title: 'Smart Reconciliation',
    description: 'Automatic reconciliation checks ensure your parsed data matches the bank deposit before syncing to Xero.',
  },
  {
    icon: Users,
    title: 'Multi-Marketplace',
    description: 'Starting with Amazon AU, with support for UK, US, and EU regions coming soon.',
  },
];

const competitors = [
  { name: 'Link My Books', price: '$$$' },
  { name: 'A2X', price: '$$$' },
  { name: 'Taxomate', price: '$$' },
  { name: 'Xettle', price: 'Free', highlight: true },
];

const trustSignals = [
  'Built by Amazon AU sellers',
  'Australian GST handled correctly',
  'Your data stays in your own Xero',
  'No Amazon API connection needed',
  'Review every settlement before it posts',
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
                Get Started <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="container-custom text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <Zap className="h-4 w-4" />
            100% Free — No hidden fees
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight mb-6">
            Amazon settlements,
            <br />
            <span className="text-primary">Xettled.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
            Turn Amazon settlement reports into clean Xero invoices.
            <br />
            Automatically categorised, GST-handled, Xero-ready.
          </p>
          <p className="text-sm text-muted-foreground/70 mb-10 font-medium">
            <span className="text-primary font-semibold">X</span>ero + Se<span className="text-primary font-semibold">ttle</span> = <span className="text-primary font-semibold">Xettle</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 py-6" asChild>
              <Link to="/auth?tab=signup">
                Start Xettling — It's Free <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
              <a href="#features">See How It Works</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Competitor comparison */}
      <section className="py-16 px-4 bg-card border-y border-border">
        <div className="container-custom max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-3 text-foreground">
            Not everyone needs API automation
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Most sellers just want their Amazon settlements synced to Xero — accurately, with GST handled right. No marketplace API keys, no complex setup. Just upload, review, and push.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {competitors.map((c) => (
              <div
                key={c.name}
                className={`rounded-xl p-4 border-2 transition-all ${
                  c.highlight
                    ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                    : 'border-border bg-background'
                }`}
              >
                <p className="text-sm text-muted-foreground mb-1">{c.name}</p>
                {c.highlight ? (
                  <p className="text-5xl md:text-6xl font-black text-primary leading-none">
                    Free
                  </p>
                ) : (
                  <p className="text-xl font-bold text-foreground">
                    {c.price}
                  </p>
                )}
              </div>
            ))}
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
              Built by Amazon sellers, for Amazon sellers. No bloat, no complexity.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border hover:border-primary/30 transition-colors">
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
              Built for Australian Amazon sellers
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
              { step: '02', title: 'Upload Settlement', desc: 'Download your settlement TSV from Amazon Seller Central and upload it. We parse every line.' },
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
            From Amazon to Xero — Xettled.
          </h2>
          <p className="text-lg text-muted-foreground mb-10">
            Join sellers who are Xettling their Amazon settlements into Xero for free.
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
              © {new Date().getFullYear()} Xettle. Amazon settlements, sorted.
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
