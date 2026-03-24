import { PackageOpen, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InventoryEmptyStateProps {
  platform: string;
  message?: string;
  onNavigateToSettings?: () => void;
}

export default function InventoryEmptyState({ platform, message, onNavigateToSettings }: InventoryEmptyStateProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center space-y-4">
      <PackageOpen className="h-12 w-12 text-muted-foreground/40 mx-auto" />
      <h3 className="text-lg font-semibold text-foreground">
        {platform} Inventory Not Available
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        {message || `Connect your ${platform} account in Settings → API Connections to see your inventory here.`}
      </p>
      {onNavigateToSettings && (
        <Button variant="outline" size="sm" onClick={onNavigateToSettings}>
          <LinkIcon className="h-4 w-4 mr-2" />
          Go to Settings
        </Button>
      )}
    </div>
  );
}
