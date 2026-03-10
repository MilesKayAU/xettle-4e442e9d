/**
 * MarketplaceDiscovery — Shows detected sales channels from Shopify orders.
 * Allows user to confirm channels and classify unknown tags.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Sparkles, Tag } from 'lucide-react';
import type { BatchDetectionResult } from '@/utils/shopify-order-detector';

interface MarketplaceDiscoveryProps {
  detectionResult: BatchDetectionResult;
  onConfirm: (selectedCodes: string[]) => void;
  onClassifyUnknown: (tag: string, type: string) => void;
}

export default function MarketplaceDiscovery({
  detectionResult,
  onConfirm,
  onClassifyUnknown,
}: MarketplaceDiscoveryProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(detectionResult.marketplaces.map(m => m.code))
  );
  const [classifications, setClassifications] = useState<Record<string, string>>({});

  const totalOrders = detectionResult.marketplaces.reduce((s, m) => s + m.order_count, 0);
  const channelCount = detectionResult.marketplaces.length;

  const toggleMarketplace = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleClassify = (tag: string, type: string) => {
    setClassifications(prev => ({ ...prev, [tag]: type }));
    onClassifyUnknown(tag, type);
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected));
  };

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          We found your sales channels! 🎉
        </h3>
        <p className="text-sm text-muted-foreground">
          {totalOrders} orders across {channelCount} channel{channelCount !== 1 ? 's' : ''} in the last 90 days:
        </p>
      </div>

      {/* Marketplace list */}
      <div className="space-y-2">
        {detectionResult.marketplaces.map(mp => (
          <label
            key={mp.code}
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
              selected.has(mp.code)
                ? 'border-primary bg-primary/5'
                : 'border-border'
            }`}
            onClick={() => toggleMarketplace(mp.code)}
          >
            <Checkbox
              checked={selected.has(mp.code)}
              onCheckedChange={() => toggleMarketplace(mp.code)}
            />
            <span className="flex-1 text-sm font-medium">{mp.name}</span>
            <Badge variant="secondary" className="text-xs">
              {mp.order_count} order{mp.order_count !== 1 ? 's' : ''}
            </Badge>
          </label>
        ))}
      </div>

      {/* MCF notice */}
      {detectionResult.mcf_order_count > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                {detectionResult.mcf_order_count} order{detectionResult.mcf_order_count !== 1 ? 's' : ''} appear to be fulfilled via Amazon MCF (Cedcommerce).
              </p>
              <p className="text-muted-foreground mt-1">
                Amazon may have charged MCF fulfillment fees separately — check your Amazon account.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unknown tags classification */}
      {detectionResult.unknown_tags.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Unknown tags found:
            </p>
            {detectionResult.unknown_tags.map(tag => (
              <Card key={tag} className="border-dashed">
                <CardContent className="p-3 space-y-2">
                  <p className="text-sm">
                    Unknown tag: <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">'{tag}'</span>
                  </p>
                  <RadioGroup
                    value={classifications[tag] || ''}
                    onValueChange={(val) => handleClassify(tag, val)}
                    className="flex flex-wrap gap-3"
                  >
                    {[
                      { value: 'marketplace', label: 'Marketplace' },
                      { value: 'aggregator', label: 'Fulfillment software' },
                      { value: 'gateway', label: 'Payment gateway' },
                      { value: 'ignore', label: 'Ignore' },
                    ].map(opt => (
                      <div key={opt.value} className="flex items-center gap-1.5">
                        <RadioGroupItem value={opt.value} id={`${tag}-${opt.value}`} />
                        <Label htmlFor={`${tag}-${opt.value}`} className="text-xs cursor-pointer">
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Button
        onClick={handleConfirm}
        disabled={selected.size === 0}
        className="w-full gap-2"
      >
        Create {selected.size} marketplace tab{selected.size !== 1 ? 's' : ''} →
      </Button>
    </div>
  );
}
