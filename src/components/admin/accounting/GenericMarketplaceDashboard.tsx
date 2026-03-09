import { MARKETPLACE_CATALOG, type UserMarketplace } from './MarketplaceSwitcher';
import SmartUploadFlow from './SmartUploadFlow';

interface GenericMarketplaceDashboardProps {
  marketplace: UserMarketplace;
  onMarketplacesChanged?: () => void;
}

export default function GenericMarketplaceDashboard({ marketplace, onMarketplacesChanged }: GenericMarketplaceDashboardProps) {
  const def = MARKETPLACE_CATALOG.find(m => m.code === marketplace.marketplace_code);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">{def?.icon || '📋'}</span>
          {def?.name || marketplace.marketplace_name} Settlements
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload settlement data, reconcile, and sync to Xero.
        </p>
      </div>

      <SmartUploadFlow onMarketplacesChanged={onMarketplacesChanged} />
    </div>
  );
}
