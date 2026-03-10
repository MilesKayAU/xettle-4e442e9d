/**
 * UnknownEntityDialog — Classification dialog for unknown tags found in Shopify orders.
 * 
 * Shows when the parser/SmartUpload detects tags not in the registry or entity_library.
 * Users classify each unknown tag to tell Xettle how to handle it.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { AlertTriangle, HelpCircle, Loader2, Store, Truck, CreditCard, Settings, SkipForward, Info } from 'lucide-react';
import { toast } from 'sonner';
import type { UnknownEntity } from '@/utils/entity-detection';
import { saveEntityClassification, type EntityClassification } from '@/utils/entity-detection';

// ─── Types ──────────────────────────────────────────────────────────────────

type ClassificationType = 'marketplace' | 'software' | 'gateway' | 'aggregator' | 'skip';

interface ClassificationChoice {
  value: ClassificationType;
  label: string;
  description: string;
  icon: React.ReactNode;
  entityType: EntityClassification['entityType'];
  accountingImpact: EntityClassification['accountingImpact'];
}

const CLASSIFICATION_OPTIONS: ClassificationChoice[] = [
  {
    value: 'marketplace',
    label: 'Marketplace',
    description: 'I sell here, they pay me',
    icon: <Store className="h-4 w-4" />,
    entityType: 'marketplace',
    accountingImpact: 'revenue',
  },
  {
    value: 'aggregator',
    label: 'Fulfilment software',
    description: 'Routes my orders (e.g. CedCommerce, Mirakl)',
    icon: <Truck className="h-4 w-4" />,
    entityType: 'aggregator',
    accountingImpact: 'neutral',
  },
  {
    value: 'gateway',
    label: 'Payment gateway',
    description: 'How customers pay (e.g. Afterpay, Zip)',
    icon: <CreditCard className="h-4 w-4" />,
    entityType: 'gateway',
    accountingImpact: 'gateway_fee',
  },
  {
    value: 'software',
    label: 'Other software',
    description: 'No accounting impact',
    icon: <Settings className="h-4 w-4" />,
    entityType: 'software',
    accountingImpact: 'neutral',
  },
  {
    value: 'skip',
    label: 'Skip',
    description: 'Ignore this tag',
    icon: <SkipForward className="h-4 w-4" />,
    entityType: 'other',
    accountingImpact: 'neutral',
  },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface UnknownEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unknowns: UnknownEntity[];
  /** Called after all classifications are saved. Returns which tags were classified as marketplaces. */
  onClassified: (results: Array<{ name: string; type: ClassificationType }>) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function UnknownEntityDialog({
  open,
  onOpenChange,
  unknowns,
  onClassified,
}: UnknownEntityDialogProps) {
  const [classifications, setClassifications] = useState<Record<string, ClassificationType>>({});
  const [saving, setSaving] = useState(false);

  const setChoice = (tagName: string, value: ClassificationType) => {
    setClassifications(prev => ({ ...prev, [tagName]: value }));
  };

  const allClassified = unknowns.every(u => classifications[u.name]);

  const handleSave = async (shareGlobally: boolean) => {
    setSaving(true);
    const results: Array<{ name: string; type: ClassificationType }> = [];
    let errors = 0;

    for (const unknown of unknowns) {
      const choice = classifications[unknown.name];
      if (!choice) continue;

      const option = CLASSIFICATION_OPTIONS.find(o => o.value === choice);
      if (!option) continue;

      const classification: EntityClassification = {
        entityName: unknown.name,
        entityType: option.entityType,
        accountingImpact: option.accountingImpact,
        detectionField: unknown.field,
        shareGlobally,
      };

      const result = await saveEntityClassification(classification);
      if (result.success) {
        results.push({ name: unknown.name, type: choice });
      } else {
        errors++;
        console.error(`Failed to save classification for "${unknown.name}":`, result.error);
      }
    }

    setSaving(false);

    if (errors > 0) {
      toast.error(`${errors} classification${errors > 1 ? 's' : ''} failed to save.`);
    }

    const marketplaces = results.filter(r => r.type === 'marketplace');
    const aggregators = results.filter(r => r.type === 'aggregator');

    if (marketplaces.length > 0) {
      toast.success(`${marketplaces.map(m => m.name).join(', ')} added as marketplace${marketplaces.length > 1 ? 's' : ''} — tabs will be created automatically.`);
    }
    if (aggregators.length > 0) {
      // Check for CedCommerce MCF
      const hasCed = aggregators.some(a => 
        a.name.toLowerCase().includes('cedcommerce') || a.name.toLowerCase().includes('ced commerce')
      );
      if (hasCed) {
        toast.info(
          'CedCommerce MCF detected — orders fulfilled via Amazon MCF may incur fulfilment charges in your Amazon account.',
          { duration: 8000 }
        );
      }
    }

    onClassified(results);
    onOpenChange(false);
    setClassifications({});
  };

  if (unknowns.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            Help us understand your store setup
          </DialogTitle>
          <DialogDescription>
            We found {unknowns.length} unfamiliar tag{unknowns.length > 1 ? 's' : ''} in your orders. 
            Tell us what they are so we can handle them correctly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {unknowns.map((unknown, idx) => (
            <div key={unknown.name}>
              {idx > 0 && <Separator className="mb-4" />}
              <div className="space-y-3">
                {/* Tag header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-sm px-3 py-1">
                      {unknown.name}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {unknown.orderCount} order{unknown.orderCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Sample orders */}
                {unknown.sampleOrders.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Found on: {unknown.sampleOrders.join(', ')}
                    {unknown.orderCount > unknown.sampleOrders.length && ` and ${unknown.orderCount - unknown.sampleOrders.length} more`}
                  </p>
                )}

                {/* Classification radio group */}
                <div className="pl-1">
                  <p className="text-xs font-medium text-foreground mb-2">What is this?</p>
                  <RadioGroup
                    value={classifications[unknown.name] || ''}
                    onValueChange={(val) => setChoice(unknown.name, val as ClassificationType)}
                    className="space-y-1.5"
                  >
                    {CLASSIFICATION_OPTIONS.map(option => (
                      <div
                        key={option.value}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                          classifications[unknown.name] === option.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-muted-foreground/30'
                        }`}
                        onClick={() => setChoice(unknown.name, option.value)}
                      >
                        <RadioGroupItem value={option.value} id={`${unknown.name}-${option.value}`} />
                        <Label
                          htmlFor={`${unknown.name}-${option.value}`}
                          className="flex items-center gap-2 cursor-pointer flex-1"
                        >
                          <span className="text-muted-foreground">{option.icon}</span>
                          <div>
                            <span className="text-sm font-medium">{option.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">— {option.description}</span>
                          </div>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                {/* Contextual info for marketplace selection */}
                {classifications[unknown.name] === 'marketplace' && (
                  <div className="flex items-start gap-2 bg-primary/5 rounded-md px-3 py-2 ml-1">
                    <Info className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-primary">
                      A new marketplace tab will be created for <strong>{unknown.name}</strong> and orders with this tag will be grouped there.
                    </p>
                  </div>
                )}

                {/* CedCommerce MCF note */}
                {classifications[unknown.name] === 'aggregator' && 
                 (unknown.name.toLowerCase().includes('cedcommerce') || unknown.name.toLowerCase().includes('mcf')) && (
                  <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2 ml-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      These orders were fulfilled via Amazon MCF — check your Amazon account for MCF fulfilment charges.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={() => handleSave(false)}
            disabled={!allClassified || saving}
            className="w-full gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save for my account only
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave(true)}
            disabled={!allClassified || saving}
            className="w-full gap-2 text-xs"
          >
            Save + share with all Xettle users
          </Button>
          {!allClassified && (
            <p className="text-[11px] text-muted-foreground text-center">
              Please classify all {unknowns.length} tag{unknowns.length > 1 ? 's' : ''} before saving
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
