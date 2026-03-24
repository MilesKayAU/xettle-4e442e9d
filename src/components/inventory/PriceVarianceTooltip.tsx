import { AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PriceEntry {
  platform: string;
  price: number | null;
}

interface PriceVarianceTooltipProps {
  prices: PriceEntry[];
}

export default function PriceVarianceTooltip({ prices }: PriceVarianceTooltipProps) {
  const validPrices = prices.filter(p => p.price != null && p.price > 0);
  if (validPrices.length < 2) return null;

  const min = Math.min(...validPrices.map(p => p.price!));
  const max = Math.max(...validPrices.map(p => p.price!));
  const variance = min > 0 ? ((max - min) / min) : 0;

  if (variance <= 0.05) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center cursor-help">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium text-sm">Price variance detected ({(variance * 100).toFixed(0)}%)</p>
          {validPrices.map(p => (
            <div key={p.platform} className="flex justify-between gap-4 text-xs">
              <span className="text-muted-foreground">{p.platform}</span>
              <span className="font-mono">${p.price!.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
