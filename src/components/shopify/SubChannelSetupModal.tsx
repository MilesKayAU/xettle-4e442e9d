/**
 * SubChannelSetupModal — Setup flow for a detected Shopify sub-channel.
 * Lets user name the channel, select type, and choose settlement method.
 */

import { useState } from 'react';
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
import { Loader2, CheckCircle } from 'lucide-react';
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
  { value: 'ebay_au', label: 'eBay AU' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'facebook', label: 'Facebook / Instagram' },
  { value: 'etsy', label: 'Etsy' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'other', label: 'Other' },
];

export default function SubChannelSetupModal({
  channel, open, onClose, onComplete,
}: SubChannelSetupModalProps) {
  const defaultLabel = channel.source_name.charAt(0).toUpperCase() + channel.source_name.slice(1);
  const [label, setLabel] = useState(defaultLabel);
  const [marketplaceType, setMarketplaceType] = useState('');
  const [settlementType, setSettlementType] = useState<'separate_file' | 'shopify_payments'>('shopify_payments');
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

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Set up {channel.source_name} tracking
          </DialogTitle>
          <DialogDescription>
            {channel.order_count} order{channel.order_count !== 1 ? 's' : ''} found
            ({formatSubChannelRevenue(channel.total_revenue)})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Channel name */}
          <div className="space-y-2">
            <Label htmlFor="channel-name">Channel name</Label>
            <Input
              id="channel-name"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. eBay AU"
            />
          </div>

          {/* Marketplace type */}
          <div className="space-y-2">
            <Label>Marketplace type</Label>
            <Select value={marketplaceType} onValueChange={setMarketplaceType}>
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
