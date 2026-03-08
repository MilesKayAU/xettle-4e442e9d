import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowLeft, Zap, Rocket, Crown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const tiers = [
  {
    name: 'Free',
    icon: Zap,
    yearlyPrice: 0,
    monthlyPrice: 0,
    description: 'Replace the spreadsheet. Full manual control.',
    features: [
      'Manual TSV/CSV upload',
      'Full settlement parsing & categorisation',
      'Manual push to Xero',
      'Unlimited settlements',
      'Full history & dashboard',
      'AU marketplace support',
    ],
    cta: 'Current Plan',
    highlighted: false,
    upgradeNudge: null,
  },
  {
    name: 'Starter',
    icon: Rocket,
    yearlyPrice: 129,
    monthlyPrice: 12.99,
    description: 'Connect Amazon. Stop downloading files manually.',
    features: [
      'Everything in Free',
      'Amazon SP-API connection',
      'Auto-fetch new settlements',
      'Manual push to Xero',
      'Settlement notifications',
    ],
    cta: 'Coming Soon',
    highlighted: true,
    upgradeNudge: '"I\'m sick of downloading files every few days"',
  },
  {
    name: 'Pro',
    icon: Crown,
    yearlyPrice: 229,
    monthlyPrice: 22.99,
    description: 'Fully hands-off. Open your laptop, books are done.',
    features: [
      'Everything in Starter',
      'Daily auto-push to Xero',
      'Email notifications & digests',
      'Priority support',
      'Early access to new features',
    ],
    cta: 'Coming Soon',
    highlighted: false,
    upgradeNudge: '"I want it to just appear in Xero automatically"',
  },
];

export default function Pricing() {
  const [isYearly, setIsYearly] = useState(true);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto max-w-5xl flex items-center justify-between h-16 px-4">
          <Link to="/" className="text-xl font-bold text-foreground tracking-tight">
            <span className="text-primary">X</span>ettle
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </header>

      <div className="container mx-auto max-w-5xl px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Simple, honest pricing
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Free is genuinely useful — not a crippled trial. Upgrade when you're ready to automate.
          </p>

          <div className="flex items-center justify-center gap-3 mt-6">
            <Label htmlFor="billing-toggle" className={`text-sm ${!isYearly ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              Monthly
            </Label>
            <Switch
              id="billing-toggle"
              checked={isYearly}
              onCheckedChange={setIsYearly}
            />
            <Label htmlFor="billing-toggle" className={`text-sm ${isYearly ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              Yearly
            </Label>
            {isYearly && (
              <Badge variant="secondary" className="ml-1 text-xs bg-primary/10 text-primary border-primary/20">
                Save ~17%
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            No contracts. Cancel anytime. Monthly billed in advance.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {tiers.map((tier) => {
            const price = isYearly ? tier.yearlyPrice : tier.monthlyPrice;
            const Icon = tier.icon;

            return (
              <Card
                key={tier.name}
                className={`relative flex flex-col ${
                  tier.highlighted
                    ? 'border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20'
                    : 'border-border'
                }`}
              >
                {tier.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground text-xs px-3">
                      Most Popular
                    </Badge>
                  </div>
                )}

                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{tier.name}</CardTitle>
                  </div>
                  <CardDescription className="text-sm">{tier.description}</CardDescription>
                </CardHeader>

                <CardContent className="flex-1">
                  <div className="mb-6">
                    <span className="text-4xl font-bold text-foreground">
                      ${price}
                    </span>
                    {price > 0 && (
                      <span className="text-muted-foreground text-sm ml-1">
                        /{isYearly ? 'year' : 'month'}
                      </span>
                    )}
                    {price === 0 && (
                      <span className="text-muted-foreground text-sm ml-1">forever</span>
                    )}
                  </div>

                  <ul className="space-y-2.5">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-foreground">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {tier.upgradeNudge && (
                    <p className="mt-4 text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                      {tier.upgradeNudge}
                    </p>
                  )}
                </CardContent>

                <CardFooter>
                  <Button
                    className="w-full"
                    variant={tier.highlighted ? 'default' : 'outline'}
                    disabled={tier.cta === 'Coming Soon' || tier.cta === 'Current Plan'}
                  >
                    {tier.cta}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="text-center mt-10 text-sm text-muted-foreground">
          <p>All plans include AU marketplace support. More regions coming soon.</p>
          <p className="mt-1">
            Questions? Email us at{' '}
            <a href="mailto:support@xettle.com.au" className="text-primary hover:underline">
              support@xettle.com.au
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
