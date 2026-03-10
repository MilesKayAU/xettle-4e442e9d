/**
 * SubChannelBanner — Shows notification when new Shopify sub-channels are detected.
 * Prompts user to set up tracking or ignore each channel.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, X, ArrowRight } from 'lucide-react';
import type { DetectedSubChannel } from '@/utils/sub-channel-detection';
import { formatSubChannelRevenue, ignoreSubChannel } from '@/utils/sub-channel-detection';
import SubChannelSetupModal from './SubChannelSetupModal';
import { toast } from 'sonner';

interface SubChannelBannerProps {
  channels: DetectedSubChannel[];
  onSetupComplete: () => void;
}

export default function SubChannelBanner({ channels, onSetupComplete }: SubChannelBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [setupChannel, setSetupChannel] = useState<DetectedSubChannel | null>(null);

  const visibleChannels = channels.filter(c => !dismissed.has(c.source_name));

  if (visibleChannels.length === 0) return null;

  const handleIgnore = async (channel: DetectedSubChannel) => {
    await ignoreSubChannel(channel.source_name);
    setDismissed(prev => new Set(prev).add(channel.source_name));
    toast.info(`"${channel.source_name}" ignored — you can re-enable in Settings.`);
  };

  const handleSetupDone = () => {
    if (setupChannel) {
      setDismissed(prev => new Set(prev).add(setupChannel.source_name));
    }
    setSetupChannel(null);
    onSetupComplete();
  };

  return (
    <>
      <div className="space-y-2">
        {visibleChannels.map(channel => (
          <Card key={channel.source_name} className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center gap-3 p-4">
              <Search className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-foreground">
                  🔍 New sales channel detected:{' '}
                  <span className="font-semibold">{channel.source_name}</span>
                </p>
                <p className="text-muted-foreground mt-0.5">
                  We found {channel.order_count} order{channel.order_count !== 1 ? 's' : ''}{' '}
                  ({formatSubChannelRevenue(channel.total_revenue)}) coming through Shopify
                  tagged as <span className="font-medium">{channel.source_name}</span>.
                  Would you like to track this as a separate marketplace?
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleIgnore(channel)}
                  className="gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  Ignore
                </Button>
                <Button
                  size="sm"
                  onClick={() => setSetupChannel(channel)}
                  className="gap-1"
                >
                  Set up {channel.source_name} tracking
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {setupChannel && (
        <SubChannelSetupModal
          channel={setupChannel}
          open={!!setupChannel}
          onClose={() => setSetupChannel(null)}
          onComplete={handleSetupDone}
        />
      )}
    </>
  );
}
