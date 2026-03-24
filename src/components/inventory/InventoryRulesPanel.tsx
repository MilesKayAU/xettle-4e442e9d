/**
 * Inventory Rules Panel — configurable stock sources for Universal tab.
 * Live preview: checkbox changes update parent state immediately.
 * Save persists to app_settings.
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Settings2, Save, ArrowRight, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { InventoryRules } from '@/hooks/useInventoryRules';

interface InventoryRulesPanelProps {
  rules: InventoryRules;
  onChange: (rules: InventoryRules) => void;
  onSave: (rules: InventoryRules) => Promise<void>;
  saving: boolean;
}

const PLATFORM_OPTIONS = [
  { id: 'shopify', label: 'Shopify', description: 'Primary webstore / warehouse' },
  { id: 'amazon_fba', label: 'Amazon FBA', description: 'Fulfilled by Amazon warehouse' },
  { id: 'amazon_fbm', label: 'Amazon FBM', description: 'Fulfilled by merchant (your warehouse)' },
  { id: 'kogan', label: 'Kogan', description: 'Kogan marketplace listings' },
  { id: 'ebay', label: 'eBay', description: 'eBay Australia listings' },
  { id: 'mirakl', label: 'Bunnings / Mirakl', description: 'Mirakl-powered marketplaces' },
];

const MIRROR_PLATFORMS = [
  { source: 'Kogan', mirrors: 'Shopify' },
  { source: 'eBay', mirrors: 'Shopify' },
  { source: 'Bunnings / Mirakl', mirrors: 'Shopify' },
];

export default function InventoryRulesPanel({ rules, onChange, onSave, saving }: InventoryRulesPanelProps) {
  const toggleSource = (id: string) => {
    const sources = rules.physical_sources.includes(id)
      ? rules.physical_sources.filter(s => s !== id)
      : [...rules.physical_sources, id];
    onChange({ ...rules, physical_sources: sources });
  };

  const toggleFbm = () => {
    onChange({ ...rules, fbm_from_shopify: !rules.fbm_from_shopify });
  };

  return (
    <Card className="border-border/60 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="h-4 w-4 text-primary" />
          Inventory Rules
          <Badge variant="outline" className="text-[10px] ml-1">Beta</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Configure which platforms hold real physical stock. Changes preview instantly — save to persist.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Physical Stock Sources */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
            Physical Stock Sources
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Only checked platforms are included in Total Real Stock. Uncheck platforms that mirror stock from another source to avoid double-counting.
              </TooltipContent>
            </Tooltip>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PLATFORM_OPTIONS.map(p => (
              <label
                key={p.id}
                className="flex items-start gap-2.5 p-2.5 rounded-md border border-border/40 hover:border-border/80 transition-colors cursor-pointer"
              >
                <Checkbox
                  checked={rules.physical_sources.includes(p.id)}
                  onCheckedChange={() => toggleSource(p.id)}
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-medium text-foreground">{p.label}</span>
                  <p className="text-[10px] text-muted-foreground leading-tight">{p.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* FBM Toggle */}
        <div className="flex items-center justify-between p-3 rounded-md border border-border/40 bg-muted/30">
          <div className="space-y-0.5">
            <Label className="text-xs font-medium cursor-pointer" htmlFor="fbm-toggle">
              Amazon FBM stock comes from Shopify warehouse
            </Label>
            <p className="text-[10px] text-muted-foreground">
              When enabled, FBM quantities are excluded from Total Real Stock to prevent double-counting with Shopify.
            </p>
          </div>
          <Switch
            id="fbm-toggle"
            checked={rules.fbm_from_shopify}
            onCheckedChange={toggleFbm}
          />
        </div>

        {/* Mirror Platforms — read only */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-foreground">Mirror Platforms</h4>
          <div className="space-y-1.5">
            {MIRROR_PLATFORMS.map(m => (
              <div key={m.source} className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                <span className="font-medium text-foreground/70">{m.source}</span>
                <ArrowRight className="h-3 w-3" />
                <span>{m.mirrors}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic px-2">
            Mirror platform mapping is read-only. Customizable in a future update.
          </p>
        </div>

        {/* Save */}
        <Button
          size="sm"
          onClick={() => onSave(rules)}
          disabled={saving}
          className="w-full"
        >
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saving ? 'Saving...' : 'Save Rules'}
        </Button>
      </CardContent>
    </Card>
  );
}
