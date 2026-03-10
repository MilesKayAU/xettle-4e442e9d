/**
 * MultiMarketplaceSplitCard — Confirmation UI for files containing multiple marketplaces.
 * 
 * Shows a preview card: "We detected 3 marketplaces in this file: BigW (22 orders, $534.94)..."
 * User can reassign groups or confirm the split before saving.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2, AlertTriangle, Layers, ArrowRight,
} from 'lucide-react';
import type { MarketplaceGroup, MultiMarketplaceSplitResult } from '@/utils/multi-marketplace-splitter';
import { getMarketplaceDisplayName, saveSplitFingerprint } from '@/utils/multi-marketplace-splitter';

// Known marketplace codes for the reassign dropdown
const REASSIGN_OPTIONS = [
  { code: 'bigw', label: 'Big W' },
  { code: 'everyday_market', label: 'Everyday Market' },
  { code: 'mydeal', label: 'MyDeal' },
  { code: 'catch', label: 'Catch' },
  { code: 'kmart', label: 'Kmart' },
  { code: 'myer', label: 'Myer' },
  { code: 'bunnings', label: 'Bunnings' },
  { code: 'target', label: 'Target' },
  { code: 'ebay_au', label: 'eBay AU' },
  { code: 'amazon_au', label: 'Amazon AU' },
  { code: 'shopify_payments', label: 'Shopify Payments' },
  { code: 'kogan', label: 'Kogan' },
  { code: 'theiconic', label: 'THE ICONIC' },
  { code: 'etsy', label: 'Etsy' },
];

interface MultiMarketplaceSplitCardProps {
  filename: string;
  splitResult: MultiMarketplaceSplitResult;
  headers: string[];
  onConfirm: (groups: MarketplaceGroup[], rememberFormat: boolean) => void;
  onCancel: () => void;
}

function formatAUD(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const GROUP_COLORS = [
  'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-lime-600', 'bg-orange-500',
];

export default function MultiMarketplaceSplitCard({
  filename,
  splitResult,
  headers,
  onConfirm,
  onCancel,
}: MultiMarketplaceSplitCardProps) {
  const [groups, setGroups] = useState<MarketplaceGroup[]>(splitResult.groups);
  const [rememberFormat, setRememberFormat] = useState(true);
  const hasUnmapped = splitResult.unmappedValues.length > 0;

  const handleReassign = (groupIdx: number, newCode: string) => {
    setGroups(prev => {
      const updated = [...prev];
      updated[groupIdx] = {
        ...updated[groupIdx],
        marketplaceCode: newCode,
        displayName: getMarketplaceDisplayName(newCode),
      };
      return updated;
    });
  };

  const totalRows = groups.reduce((s, g) => s + g.rowCount, 0);
  const totalNet = groups.reduce((s, g) => s + g.netTotal, 0);

  return (
    <Card className="border-primary/40 bg-primary/[0.03] ring-1 ring-primary/20">
      <CardContent className="py-4 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Multi-marketplace file detected
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-medium">{filename}</span> contains {groups.length} marketplaces 
              ({totalRows} rows, {formatAUD(totalNet)} net).
              We'll create {groups.length} separate settlements.
            </p>
            {splitResult.splitColumn && (
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Split by column: <span className="font-mono">{splitResult.splitColumn}</span>
              </p>
            )}
          </div>
        </div>

        {/* Marketplace groups */}
        <div className="space-y-2">
          {groups.map((g, idx) => {
            const color = GROUP_COLORS[idx % GROUP_COLORS.length];
            const isUnmapped = splitResult.unmappedValues.includes(g.rawValue);
            return (
              <div
                key={g.rawValue}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-all ${
                  isUnmapped
                    ? 'bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800'
                    : 'bg-background/80 border border-border/50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`h-6 w-6 rounded ${color} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
                    {g.rawValue.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isUnmapped ? (
                        <Select
                          value={g.marketplaceCode}
                          onValueChange={(val) => handleReassign(idx, val)}
                        >
                          <SelectTrigger className="h-6 text-xs w-40 border-amber-300">
                            <SelectValue placeholder="Assign marketplace" />
                          </SelectTrigger>
                          <SelectContent>
                            {REASSIGN_OPTIONS.map(opt => (
                              <SelectItem key={opt.code} value={opt.code} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs font-semibold text-foreground">{g.displayName}</span>
                      )}
                      {isUnmapped && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-400 text-amber-600">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                          Unknown
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      "{g.rawValue}" — {g.rowCount} row{g.rowCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-semibold tabular-nums ${g.netTotal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {formatAUD(g.netTotal)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">net</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Remember checkbox + actions */}
        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={rememberFormat}
              onCheckedChange={(checked) => setRememberFormat(checked === true)}
            />
            <span className="text-xs text-muted-foreground">Remember this format</span>
          </label>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => onConfirm(groups, rememberFormat)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Split into {groups.length} settlements
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
