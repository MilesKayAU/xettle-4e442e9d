/**
 * SetupStepSelectMarketplaces — Lets users pick which marketplaces they sell on.
 * Creates marketplace_connections for each selected marketplace.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, ShoppingCart, Store, Package, Globe } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MarketplaceOption {
  code: string;
  name: string;
  icon: React.ReactNode;
  description: string;
}

const MARKETPLACE_OPTIONS: MarketplaceOption[] = [
  { code: 'amazon_au', name: 'Amazon AU', icon: <ShoppingCart className="h-5 w-5" />, description: 'Amazon Seller Central (Australia)' },
  { code: 'shopify', name: 'Shopify', icon: <Store className="h-5 w-5" />, description: 'Shopify store & sub-channels' },
  { code: 'ebay_au', name: 'eBay AU', icon: <Package className="h-5 w-5" />, description: 'eBay Australia seller account' },
  { code: 'catch_au', name: 'Catch', icon: <Globe className="h-5 w-5" />, description: 'Catch.com.au marketplace' },
  { code: 'kogan', name: 'Kogan', icon: <Globe className="h-5 w-5" />, description: 'Kogan marketplace' },
  { code: 'bunnings', name: 'Bunnings MarketLink', icon: <Package className="h-5 w-5" />, description: 'Bunnings online marketplace' },
  { code: 'woolworths_mp', name: 'Woolworths Everyday Market', icon: <Package className="h-5 w-5" />, description: 'Woolworths MarketPlus' },
  { code: 'mydeal', name: 'MyDeal', icon: <Globe className="h-5 w-5" />, description: 'MyDeal marketplace' },
];

interface Props {
  onNext: (selectedCodes: string[]) => void;
  onSkip: () => void;
}

export default function SetupStepSelectMarketplaces({ onNext, onSkip }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleContinue = async () => {
    if (selected.size === 0) {
      onNext([]);
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const codes = Array.from(selected);

      // Upsert marketplace connections for each selected marketplace
      const rows = codes.map(code => {
        const opt = MARKETPLACE_OPTIONS.find(m => m.code === code);
        return {
          user_id: user.id,
          marketplace_code: code,
          marketplace_name: opt?.name || code,
          connection_type: 'manual' as const,
          connection_status: 'active' as const,
        };
      });

      const { error } = await supabase
        .from('marketplace_connections')
        .upsert(rows, { onConflict: 'user_id,marketplace_code' });

      if (error) {
        // If upsert with onConflict fails, insert individually ignoring dupes
        for (const row of rows) {
          await supabase.from('marketplace_connections').upsert(row, { onConflict: 'user_id,marketplace_code' }).select();
        }
      }

      toast.success(`${codes.length} marketplace${codes.length > 1 ? 's' : ''} set up`);
      onNext(codes);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save marketplaces');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Which marketplaces do you sell on?</h2>
        <p className="text-sm text-muted-foreground">
          Select all that apply — we'll create folders for each and start looking for their data in Xero.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 max-h-[320px] overflow-y-auto pr-1">
        {MARKETPLACE_OPTIONS.map(mp => {
          const isSelected = selected.has(mp.code);
          return (
            <button
              key={mp.code}
              onClick={() => toggle(mp.code)}
              className={`relative flex items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/50 hover:border-primary/30 hover:bg-muted/30'
              }`}
            >
              <div className={`flex-shrink-0 h-9 w-9 rounded-lg flex items-center justify-center ${
                isSelected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {isSelected ? <CheckCircle2 className="h-5 w-5" /> : mp.icon}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{mp.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{mp.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-2 pt-1">
        <Button onClick={handleContinue} disabled={saving} className="w-full">
          {saving ? 'Setting up…' : selected.size > 0 ? `Continue with ${selected.size} marketplace${selected.size > 1 ? 's' : ''}` : 'Continue'}
        </Button>
        <button
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          I'll add marketplaces later →
        </button>
      </div>
    </div>
  );
}
