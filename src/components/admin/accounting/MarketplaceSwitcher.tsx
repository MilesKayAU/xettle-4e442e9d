import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Plus, Loader2, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface MarketplaceDefinition {
  code: string;
  name: string;
  icon: string;
  country: string;
  countryFlag: string;
  connectionMethods: Array<'sp_api' | 'manual_csv' | 'api_key'>;
  phase: 'live' | 'csv_ready' | 'coming_soon';
  description: string;
}

export const MARKETPLACE_CATALOG: MarketplaceDefinition[] = [
  {
    code: 'amazon_au',
    name: 'Amazon AU',
    icon: '📦',
    country: 'AU',
    countryFlag: '🇦🇺',
    connectionMethods: ['sp_api', 'manual_csv'],
    phase: 'live',
    description: 'Amazon Seller Central Australia — SP-API auto-fetch or manual TSV upload.',
  },
  {
    code: 'bunnings',
    name: 'Bunnings',
    icon: '🔨',
    country: 'AU',
    countryFlag: '🇦🇺',
    connectionMethods: ['manual_csv'],
    phase: 'csv_ready',
    description: 'Bunnings Marketplace — manual CSV upload. Mirakl API coming Phase 2.',
  },
  {
    code: 'kogan',
    name: 'Kogan',
    icon: '🛒',
    country: 'AU',
    countryFlag: '🇦🇺',
    connectionMethods: ['manual_csv'],
    phase: 'csv_ready',
    description: 'Kogan Marketplace — manual CSV upload.',
  },
  {
    code: 'woolworths',
    name: 'Woolworths',
    icon: '🛍️',
    country: 'AU',
    countryFlag: '🇦🇺',
    connectionMethods: ['manual_csv'],
    phase: 'csv_ready',
    description: 'Woolworths Everyday Market — manual CSV upload.',
  },
  {
    code: 'mydeal',
    name: 'MyDeal',
    icon: '🏷️',
    country: 'AU',
    countryFlag: '🇦🇺',
    connectionMethods: ['manual_csv'],
    phase: 'csv_ready',
    description: 'MyDeal by Woolworths — manual CSV upload.',
  },
];

export interface UserMarketplace {
  id: string;
  marketplace_code: string;
  marketplace_name: string;
  connection_type: string;
  connection_status: string;
  country_code: string;
}

interface MarketplaceSwitcherProps {
  selectedMarketplace: string;
  onMarketplaceChange: (code: string) => void;
  userMarketplaces: UserMarketplace[];
  onMarketplacesChanged: () => void;
}

export default function MarketplaceSwitcher({
  selectedMarketplace,
  onMarketplaceChange,
  userMarketplaces,
  onMarketplacesChanged,
}: MarketplaceSwitcherProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addingCode, setAddingCode] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selectedDef = MARKETPLACE_CATALOG.find(m => m.code === selectedMarketplace);
  const connectedCodes = new Set(userMarketplaces.map(m => m.marketplace_code));

  const handleAddMarketplace = async (def: MarketplaceDefinition) => {
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('marketplace_connections')
        .insert({
          user_id: user.id,
          marketplace_code: def.code,
          marketplace_name: def.name,
          country_code: def.country,
          connection_type: def.connectionMethods[0] === 'sp_api' ? 'sp_api' : 'manual_csv',
          connection_status: 'active',
        } as any);

      if (error) throw error;

      toast.success(`${def.name} added to your dashboard`);
      setAddDialogOpen(false);
      setAddingCode(null);
      onMarketplacesChanged();
      onMarketplaceChange(def.code);
    } catch (err: any) {
      toast.error(`Failed to add: ${err.message}`);
    } finally {
      setAdding(false);
    }
  };

  const availableToAdd = MARKETPLACE_CATALOG.filter(
    m => !connectedCodes.has(m.code) && m.phase !== 'coming_soon'
  );

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Connected marketplace pills */}
        {userMarketplaces.map((um) => {
          const def = MARKETPLACE_CATALOG.find(m => m.code === um.marketplace_code);
          const isActive = um.marketplace_code === selectedMarketplace;
          return (
            <button
              key={um.id}
              onClick={() => onMarketplaceChange(um.marketplace_code)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all text-sm
                ${isActive
                  ? 'border-primary bg-primary/10 text-foreground font-medium shadow-sm'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:border-muted-foreground/30 cursor-pointer'
                }`}
            >
              <span className="text-base">{def?.icon || '📋'}</span>
              <span>{def?.name || um.marketplace_name}</span>
              <CheckCircle2 className="h-3 w-3 text-green-600" />
            </button>
          );
        })}

        {/* Add marketplace button */}
        {availableToAdd.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:bg-muted hover:border-muted-foreground/50 transition-all cursor-pointer">
                <Plus className="h-3.5 w-3.5" />
                Add Marketplace
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {availableToAdd.map((def) => (
                <DropdownMenuItem
                  key={def.code}
                  onClick={() => {
                    setAddingCode(def.code);
                    setAddDialogOpen(true);
                  }}
                  className="flex items-center gap-2"
                >
                  <span className="text-base">{def.icon}</span>
                  <div className="flex-1">
                    <span className="font-medium">{def.name}</span>
                    <span className="text-xs text-muted-foreground ml-1">{def.countryFlag}</span>
                  </div>
                  {def.phase === 'csv_ready' && (
                    <Badge variant="outline" className="text-[10px] px-1.5">CSV</Badge>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                More marketplaces coming soon
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Add marketplace confirmation dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          {addingCode && (() => {
            const def = MARKETPLACE_CATALOG.find(m => m.code === addingCode);
            if (!def) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <span className="text-xl">{def.icon}</span>
                    Add {def.name}
                  </DialogTitle>
                  <DialogDescription>
                    {def.description}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-medium text-foreground">Connection method:</p>
                    {def.connectionMethods.includes('manual_csv') && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        Manual CSV/TSV upload
                      </div>
                    )}
                    {def.connectionMethods.includes('sp_api') && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        SP-API auto-fetch (Starter+)
                      </div>
                    )}
                  </div>
                  {def.phase === 'csv_ready' && (
                    <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-2">
                      ⚠ Settlement parsing for {def.name} is in early access. Upload your CSV files and we'll process them using our generic parser.
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                  <Button onClick={() => handleAddMarketplace(def)} disabled={adding}>
                    {adding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Add {def.name}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
