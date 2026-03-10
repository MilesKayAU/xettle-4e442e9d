import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock } from 'lucide-react';
import { MARKETPLACE_CATALOG, type UserMarketplace } from './MarketplaceSwitcher';

interface NextExpectedSettlementsProps {
  userMarketplaces: UserMarketplace[];
}

function getNextExpectedDate(code: string): string {
  const now = new Date();
  const catalog = MARKETPLACE_CATALOG.find(m => m.code === code);
  
  // Estimate based on typical settlement frequencies
  const freq = catalog?.code.includes('shopify') ? 3 : 
               catalog?.code.includes('bunnings') ? 15 :
               catalog?.code.includes('woolworths') ? 14 : 7;
  
  const next = new Date(now);
  next.setDate(now.getDate() + Math.max(1, freq - (now.getDate() % freq)));
  
  return next.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

export default function NextExpectedSettlements({ userMarketplaces }: NextExpectedSettlementsProps) {
  if (userMarketplaces.length === 0) return null;

  return (
    <Card className="border-border">
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Next Expected Settlements</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {userMarketplaces.map(m => {
            const def = MARKETPLACE_CATALOG.find(c => c.code === m.marketplace_code);
            return (
              <div key={m.marketplace_code} className="flex items-center gap-2 text-sm">
                <span>{def?.icon || '📋'}</span>
                <span className="text-muted-foreground">{def?.name || m.marketplace_name}</span>
                <span className="font-medium text-foreground">→ {getNextExpectedDate(m.marketplace_code)}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
