/**
 * SubChannelSetupModal — Setup flow for a detected Shopify sub-channel.
 * Lets user name the channel, select type, and choose settlement method.
 * Pre-fills known marketplaces and handles numeric channel IDs.
 */

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import type { DetectedSubChannel } from '@/utils/sub-channel-detection';
import { saveSubChannel, formatSubChannelRevenue } from '@/utils/sub-channel-detection';
import { toast } from 'sonner';

interface SubChannelSetupModalProps {
  channel: DetectedSubChannel;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const MARKETPLACE_TYPES = [
  { value: 'mydeal', label: 'MyDeal' },
  { value: 'bunnings', label: 'Bunnings' },
  { value: 'bigw', label: 'Big W' },
  { value: 'everyday_market', label: 'Everyday Market' },
  { value: 'catch', label: 'Catch' },
  { value: 'ebay_au', label: 'eBay AU' },
  { value: 'kogan', label: 'Kogan' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'facebook', label: 'Facebook / Instagram' },
  { value: 'etsy', label: 'Etsy' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'other', label: 'Other' },
];

function isNumericChannelId(name: string): boolean {
  return /^\d{6,}$/.test(name.trim());
}

export default function SubChannelSetupModal({
  channel, open, onClose, onComplete,
}: SubChannelSetupModalProps) {
  const isNumeric = channel.is_numeric_id || isNumericChannelId(channel.source_name);

  // Confident tag-based detection: we know what this is
  const isConfidentDetection = channel.detection_method === 'tag' && !!channel.suggested_label;

  // Pre-fill from suggested values or derive from source_name
  const defaultLabel = channel.suggested_label
    || (isNumeric ? '' : channel.source_name.charAt(0).toUpperCase() + channel.source_name.slice(1));
  const defaultType = channel.suggested_code || '';

  const [label, setLabel] = useState(defaultLabel);
  const [marketplaceType, setMarketplaceType] = useState(defaultType);
  const [settlementType, setSettlementType] = useState<'separate_file' | 'shopify_payments'>('separate_file');
  const [saving, setSaving] = useState(false);

  const marketplaceCode = marketplaceType === 'other'
    ? channel.source_name.toLowerCase().replace(/[^a-z0-9]/g, '_')
    : marketplaceType || channel.source_name.toLowerCase().replace(/[^a-z0-9]/g, '_');

  const handleSave = async () => {
    if (!label.trim()) {
      toast.error('Please enter a channel name.');
      return;
    }

    setSaving(true);
    const result = await saveSubChannel({
      source_name: channel.source_name,
      marketplace_label: label.trim(),
      marketplace_code: marketplaceCode,
      settlement_type: settlementType,
      order_count: channel.order_count,
      total_revenue: channel.total_revenue,
    });

    // ── Register in marketplace_registry so the system learns this marketplace ──
    if (result.success) {
      try {
        const nameClean = label.trim();
        const codeClean = marketplaceCode;
        // Build detection keywords from the label and source_name
        const keywords = [
          nameClean.toLowerCase(),
          ...(channel.source_name !== nameClean ? [channel.source_name.toLowerCase()] : []),
        ].filter(Boolean);

        await supabase.from('marketplace_registry').upsert({
          marketplace_code: codeClean,
          marketplace_name: nameClean,
          country: 'AU',
          type: 'marketplace',
          is_active: true,
          added_by: 'user',
          detection_keywords: keywords,
          shopify_source_names: [channel.source_name],
        }, { onConflict: 'marketplace_code' });
      } catch (err) {
        console.error('Non-fatal: failed to register marketplace in registry:', err);
      }
    }

    setSaving(false);

    if (result.success) {
      toast.success(`${label} tracking set up! ${
        settlementType === 'separate_file'
          ? 'A new marketplace tab has been created.'
          : 'Orders will be tagged in reporting.'
      }`);
      onComplete();
    } else {
      toast.error(result.error || 'Failed to save channel setup.');
    }
  };

  const displaySourceName = isNumeric
    ? `Channel ID: ${channel.source_name}`
    : channel.source_name;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Set up {channel.suggested_label || displaySourceName} tracking
          </DialogTitle>
          <DialogDescription>
            {channel.order_count} order{channel.order_count !== 1 ? 's' : ''} found
            ({formatSubChannelRevenue(channel.total_revenue)})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Confident tag-based detection: green confirmation */}
          {isConfidentDetection && (
            <div className="flex items-start gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3">
              <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                ✓ Identified as <span className="font-medium text-foreground">{channel.suggested_label}</span> based on order tags
              </p>
            </div>
          )}

          {/* Numeric ID helper — only show when NOT confidently detected */}
          {isNumeric && !isConfidentDetection && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                This source name is a Shopify channel ID. Select the matching marketplace below,
                or check your{' '}
                <a
                  href="https://admin.shopify.com/settings/sales_channels"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Shopify Sales Channels settings
                </a>
                {' '}to identify it.
              </p>
            </div>
          )}

          {/* Channel name */}
          <div className="space-y-2">
            <Label htmlFor="channel-name">Channel name</Label>
            <Input
              id="channel-name"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={isNumeric ? 'e.g. Big W, Everyday Market' : 'e.g. eBay AU'}
            />
          </div>

          {/* Marketplace type */}
          <div className="space-y-2">
            <Label>Marketplace type</Label>
            <Select value={marketplaceType} onValueChange={(v) => {
              setMarketplaceType(v);
              // Auto-fill label from marketplace selection
              const match = MARKETPLACE_TYPES.find(t => t.value === v);
              if (match && (!label || isNumeric)) {
                setLabel(match.label);
              }
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACE_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Settlement type */}
          <div className="space-y-2">
            <Label>How does this channel pay you?</Label>
            <RadioGroup
              value={settlementType}
              onValueChange={v => setSettlementType(v as any)}
              className="space-y-2"
            >
              <label className="flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="shopify_payments" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Pays through Shopify Payments</p>
                  <p className="text-xs text-muted-foreground">
                    No separate settlement file needed — orders are tagged in reporting only.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="separate_file" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">I upload a separate settlement file</p>
                  <p className="text-xs text-muted-foreground">
                    Creates a new marketplace tab for uploading {label || 'this channel'}'s settlement files.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {saving ? 'Saving...' : 'Set up tracking'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
