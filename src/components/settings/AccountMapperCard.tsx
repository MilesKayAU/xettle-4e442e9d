import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Sparkles, CheckCircle2, RefreshCw, Info, AlertTriangle, XCircle, Search, ChevronsUpDown, Filter, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSettingsPin } from '@/hooks/use-settings-pin';
import SettingsPinDialog from '@/components/shared/SettingsPinDialog';
import {
  refreshXeroCOA,
  getCachedXeroAccounts,
  getCoaLastSyncedAt,
  createXeroAccounts,
  type CachedXeroAccount,
} from '@/actions';

type CoaValidation = 'valid' | 'missing' | 'inactive' | 'wrong_type';

interface MappingEntry {
  code: string;
  name: string;
}

type MapperState = 'unmapped' | 'scanning' | 'review' | 'confirmed';

const CATEGORIES = [
  'Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements',
  'Seller Fees', 'FBA Fees', 'Storage Fees', 'Other Fees',
] as const;

/** Categories that support per-marketplace overrides */
const SPLITTABLE_CATEGORIES = ['Sales', 'Shipping'] as const;

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'Sales': 'Gross product sales revenue',
  'Shipping': 'Shipping revenue charged to customers',
  'Promotional Discounts': 'Vouchers & promotions reducing sale price',
  'Refunds': 'Product & shipping refunds to customers',
  'Reimbursements': 'Marketplace reimbursements (not taxable)',
  'Seller Fees': 'Referral & selling fees charged by marketplace',
  'FBA Fees': 'Fulfilment, pick & pack, delivery fees',
  'Storage Fees': 'Warehouse & inventory storage fees',
  'Other Fees': 'Miscellaneous marketplace charges',
};

const KNOWN_MARKETPLACES = [
  'Amazon AU', 'Shopify', 'Bunnings', 'eBay AU', 'Catch',
  'MyDeal', 'Kogan', 'Everyday Market', 'The Iconic', 'Etsy',
];

const REVENUE_CATEGORIES_SET = new Set(['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements']);
const REVENUE_ACCOUNT_TYPES = new Set(['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS']);
const EXPENSE_ACCOUNT_TYPES = new Set(['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS', 'CURRLIAB', 'LIABILITY']);

export default function AccountMapperCard() {
  const [state, setState] = useState<MapperState>('unmapped');
  const [mapping, setMapping] = useState<Record<string, MappingEntry>>({});
  const [editableMapping, setEditableMapping] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<string>('medium');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const settingsPin = useSettingsPin();

  // Xero COA state
  const [coaAccounts, setCoaAccounts] = useState<CachedXeroAccount[]>([]);
  const [coaLastSynced, setCoaLastSynced] = useState<string | null>(null);
  const [refreshingCoa, setRefreshingCoa] = useState(false);
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);

  // Marketplace split state
  const [splitByMarketplace, setSplitByMarketplace] = useState(false);
  const [activeMarketplaces, setActiveMarketplaces] = useState<string[]>([]);
  const [globalMappingFlags, setGlobalMappingFlags] = useState<Record<string, boolean>>({});

  // Build CoA lookup map
  const coaMap = useMemo(() => {
    const map = new Map<string, { name: string; type: string; active: boolean }>();
    for (const acc of coaAccounts) {
      if (acc.account_code) {
        map.set(acc.account_code, {
          name: acc.account_name,
          type: (acc.account_type || '').toUpperCase(),
          active: acc.is_active !== false,
        });
      }
    }
    return map;
  }, [coaAccounts]);

  useEffect(() => {
    loadCurrentState();
  }, []);

  const loadCurrentState = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check admin role
      const { data: roleRow } = await supabase
        .from('user_roles' as any)
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();
      setIsAdmin(!!roleRow);

      // Load cached COA + last sync in parallel
      const [accounts, lastSynced] = await Promise.all([
        getCachedXeroAccounts(),
        getCoaLastSyncedAt(),
      ]);
      setCoaAccounts(accounts);
      setCoaLastSynced(lastSynced);

      // Load split toggle state
      const { data: splitSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_split_by_marketplace')
        .maybeSingle();
      const isSplit = splitSetting?.value === 'true';
      setSplitByMarketplace(isSplit);

      // Load active marketplace connections
      const { data: connections } = await supabase
        .from('marketplace_connections')
        .select('marketplace_name, settings')
        .eq('user_id', user.id)
        .eq('connection_status', 'connected');

      if (connections && connections.length > 0) {
        setActiveMarketplaces(connections.map(c => c.marketplace_name));
        const flags: Record<string, boolean> = {};
        for (const c of connections) {
          const settings = (c.settings || {}) as Record<string, any>;
          flags[c.marketplace_name] = settings.use_global_mappings !== false;
        }
        setGlobalMappingFlags(flags);
      } else {
        const { data: settlements } = await supabase
          .from('settlements')
          .select('marketplace')
          .eq('user_id', user.id)
          .not('status', 'in', '("duplicate_suppressed","already_recorded")');
        if (settlements) {
          const unique = [...new Set(settlements.map(s => s.marketplace).filter(Boolean))];
          const labelMap: Record<string, string> = {
            amazon_au: 'Amazon AU', bunnings: 'Bunnings', shopify_payments: 'Shopify',
            shopify_orders: 'Shopify', catch: 'Catch', mydeal: 'MyDeal',
            kogan: 'Kogan', woolworths: 'Everyday Market', ebay_au: 'eBay AU',
            etsy: 'Etsy', theiconic: 'The Iconic',
          };
          const labels = unique.map(code => labelMap[code || ''] || code || '').filter(Boolean);
          setActiveMarketplaces([...new Set(labels)]);
        }
      }

      // Check if confirmed mapping exists
      const { data: confirmedSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_xero_account_codes')
        .maybeSingle();

      if (confirmedSetting?.value) {
        try {
          const codes = JSON.parse(confirmedSetting.value);
          const restored: Record<string, MappingEntry> = {};
          for (const cat of CATEGORIES) {
            if (codes[cat]) {
              const coaEntry = accounts.find(a => a.account_code === codes[cat]);
              restored[cat] = { code: codes[cat], name: coaEntry?.account_name || `Account ${codes[cat]}` };
            }
          }
          for (const key of Object.keys(codes)) {
            if (key.includes(':')) {
              const coaEntry = accounts.find(a => a.account_code === codes[key]);
              restored[key] = { code: codes[key], name: coaEntry?.account_name || `Account ${codes[key]}` };
            }
          }
          setMapping(restored);
          const editable: Record<string, string> = {};
          for (const [k, v] of Object.entries(codes)) {
            editable[k] = v as string;
          }
          setEditableMapping(editable);
          setState('confirmed');
        } catch { /* fall through */ }
        setLoading(false);
        return;
      }

      // Check if suggested mapping exists
      const { data: suggestedSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'ai_mapper_suggested_mapping')
        .maybeSingle();

      if (suggestedSetting?.value) {
        try {
          const suggested = JSON.parse(suggestedSetting.value);
          setMapping(suggested.mapping || {});
          setConfidence(suggested.confidence || 'medium');
          setNotes(suggested.notes || '');
          const editable: Record<string, string> = {};
          for (const [cat, entry] of Object.entries(suggested.mapping || {})) {
            editable[cat] = (entry as MappingEntry).code;
          }
          setEditableMapping(editable);
          setState('review');
        } catch { /* fall through */ }
      }
    } catch (e) {
      console.error('Failed to load mapper state:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshCoa = useCallback(async () => {
    setRefreshingCoa(true);
    try {
      const result = await refreshXeroCOA();
      if (!result.success) {
        toast.error(`COA refresh failed: ${result.error}`);
        return;
      }
      const [accounts, lastSynced] = await Promise.all([
        getCachedXeroAccounts(),
        getCoaLastSyncedAt(),
      ]);
      setCoaAccounts(accounts);
      setCoaLastSynced(lastSynced);
      toast.success(`Refreshed ${result.accounts_count} accounts, ${result.tax_rates_count} tax rates`);
    } catch (err: any) {
      toast.error(`COA refresh failed: ${err.message}`);
    } finally {
      setRefreshingCoa(false);
    }
  }, []);

  const runMapper = useCallback(async () => {
    setState('scanning');
    try {
      const { data, error } = await supabase.functions.invoke('ai-account-mapper', {
        body: { action: 'scan_and_match' },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Mapping failed');

      setMapping(data.mapping || {});
      setConfidence(data.confidence || 'medium');
      setNotes(data.notes || '');

      // Refresh COA after AI mapper (it caches too)
      const [accounts, lastSynced] = await Promise.all([
        getCachedXeroAccounts(),
        getCoaLastSyncedAt(),
      ]);
      setCoaAccounts(accounts);
      setCoaLastSynced(lastSynced);

      const editable: Record<string, string> = {};
      for (const [cat, entry] of Object.entries(data.mapping || {})) {
        editable[cat] = (entry as MappingEntry).code;
      }
      setEditableMapping(editable);

      // Auto-enable split mode if AI found per-rail suggestions
      const hasOverrides = Object.keys(data.mapping || {}).some((k: string) => k.includes(':'));
      if (hasOverrides && !splitByMarketplace) {
        setSplitByMarketplace(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('app_settings').upsert({
            user_id: user.id,
            key: 'accounting_split_by_marketplace',
            value: 'true',
          } as any, { onConflict: 'user_id,key' });
        }
      }

      setState('review');
    } catch (err: any) {
      toast.error(`AI mapper failed: ${err.message}`);
      setState('unmapped');
    }
  }, [splitByMarketplace]);

  const handleSplitToggle = async (enabled: boolean) => {
    const doToggle = async () => {
      setSplitByMarketplace(enabled);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('app_settings').upsert({
          user_id: user.id,
          key: 'accounting_split_by_marketplace',
          value: enabled ? 'true' : 'false',
        } as any, { onConflict: 'user_id,key' });

        if (!enabled) {
          const cleaned = { ...editableMapping };
          for (const key of Object.keys(cleaned)) {
            if (key.includes(':')) delete cleaned[key];
          }
          setEditableMapping(cleaned);
        }
      } catch (e) {
        console.error('Failed to save split toggle:', e);
      }
    };
    settingsPin.requirePin(doToggle);
  };

  const handleConfirm = async () => {
    settingsPin.requirePin(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const finalCodes: Record<string, string> = {};
        for (const cat of CATEGORIES) {
          finalCodes[cat] = editableMapping[cat] || mapping[cat]?.code || '';
        }

        if (splitByMarketplace) {
          for (const mp of getEffectiveMarketplaces()) {
            for (const cat of SPLITTABLE_CATEGORIES) {
              const key = `${cat}:${mp}`;
              if (editableMapping[key]) {
                finalCodes[key] = editableMapping[key];
              }
            }
          }
        }

        const { error } = await supabase.from('app_settings').upsert({
          user_id: user.id,
          key: 'accounting_xero_account_codes',
          value: JSON.stringify(finalCodes),
        } as any, { onConflict: 'user_id,key' });
        if (error) throw error;

        await supabase.from('app_settings').upsert({
          user_id: user.id,
          key: 'ai_mapper_status',
          value: 'confirmed',
        } as any, { onConflict: 'user_id,key' });

        const updatedMapping: Record<string, MappingEntry> = {};
        for (const cat of CATEGORIES) {
          const code = finalCodes[cat];
          const coaEntry = coaAccounts.find(a => a.account_code === code);
          updatedMapping[cat] = {
            code,
            name: coaEntry?.account_name || mapping[cat]?.name || `Account ${code}`,
          };
        }
        for (const key of Object.keys(finalCodes)) {
          if (key.includes(':')) {
            const coaEntry = coaAccounts.find(a => a.account_code === finalCodes[key]);
            updatedMapping[key] = { code: finalCodes[key], name: coaEntry?.account_name || `Account ${finalCodes[key]}` };
          }
        }
        setMapping(updatedMapping);
        setState('confirmed');
        toast.success('Account mapping saved — all Xero pushes will use these codes');
      } catch (err: any) {
        toast.error(`Failed to save mapping: ${err.message}`);
      }
    });
  };

  const handleApplySuggestionsToMissing = () => {
    const updated = { ...editableMapping };
    // Apply global category suggestions
    for (const cat of CATEGORIES) {
      if (!updated[cat] && mapping[cat]?.code) {
        updated[cat] = mapping[cat].code;
      }
    }
    // Apply per-marketplace override suggestions from AI
    if (splitByMarketplace) {
      for (const mp of getEffectiveMarketplaces()) {
        for (const cat of SPLITTABLE_CATEGORIES) {
          const key = `${cat}:${mp}`;
          if (!updated[key] && mapping[key]?.code) {
            updated[key] = mapping[key].code;
          }
        }
      }
    }
    setEditableMapping(updated);
    toast.success('Applied suggestions to all unmapped categories');
  };

  const getEffectiveMarketplaces = (): string[] => {
    if (activeMarketplaces.length > 0) return activeMarketplaces;
    return KNOWN_MARKETPLACES.slice(0, 3);
  };

  const confidenceBadge = (level: string) => {
    if (level === 'high') return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">✅ High</Badge>;
    if (level === 'medium') return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">⚠️ Medium</Badge>;
    return <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50">❌ Low</Badge>;
  };

  const validateCode = (code: string | undefined, category: string): CoaValidation => {
    if (!code || coaMap.size === 0) return 'valid';
    const entry = coaMap.get(code);
    if (!entry) return 'missing';
    if (!entry.active) return 'inactive';
    const isRevenue = REVENUE_CATEGORIES_SET.has(category);
    const validTypes = isRevenue ? REVENUE_ACCOUNT_TYPES : EXPENSE_ACCOUNT_TYPES;
    if (!validTypes.has(entry.type)) return 'wrong_type';
    return 'valid';
  };

  const renderValidationBadge = (code: string | undefined, category: string) => {
    if (!code || coaMap.size === 0) return null;
    const status = validateCode(code, category);
    if (status === 'valid') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    if (status === 'missing') return (
      <span className="flex items-center gap-1 text-[10px] text-destructive">
        <XCircle className="h-3.5 w-3.5 shrink-0" /> Not in Xero
      </span>
    );
    if (status === 'inactive') return (
      <span className="flex items-center gap-1 text-[10px] text-destructive">
        <XCircle className="h-3.5 w-3.5 shrink-0" /> Inactive
      </span>
    );
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Wrong type
      </span>
    );
  };

  const renderStatusBadge = (code: string | undefined, category: string) => {
    if (!code) return <Badge variant="outline" className="text-destructive border-destructive/30 text-[10px]">Unmapped</Badge>;
    const status = validateCode(code, category);
    if (status === 'valid') return <Badge variant="outline" className="text-emerald-700 border-emerald-300 text-[10px]">Mapped</Badge>;
    if (status === 'missing') return <Badge variant="outline" className="text-destructive border-destructive/30 text-[10px]">Not in Xero</Badge>;
    if (status === 'inactive') return <Badge variant="outline" className="text-destructive border-destructive/30 text-[10px]">Inactive</Badge>;
    return <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">Wrong type</Badge>;
  };

  /** Searchable COA dropdown */
  const renderAccountSelector = (key: string, category: string, placeholder?: string) => {
    const currentValue = editableMapping[key] || mapping[key]?.code || '';
    const isRevenue = REVENUE_CATEGORIES_SET.has(category.split(':')[0]);

    // Filter accounts by type relevance
    const relevantAccounts = coaAccounts.filter(a => {
      if (!a.account_code) return false;
      const type = (a.account_type || '').toUpperCase();
      const validTypes = isRevenue ? REVENUE_ACCOUNT_TYPES : EXPENSE_ACCOUNT_TYPES;
      return validTypes.has(type);
    });

    const allAccounts = coaAccounts.filter(a => a.account_code);

    if (coaAccounts.length === 0) {
      // Fallback to text input
      return (
        <Input
          className="h-7 w-28 text-xs font-mono"
          placeholder={placeholder || 'Code'}
          value={currentValue}
          onChange={(e) => setEditableMapping(prev => ({ ...prev, [key]: e.target.value }))}
        />
      );
    }

    // Determine suggested account type for creation
    const suggestedType = isRevenue ? 'REVENUE' : 'EXPENSE';
    // Extract marketplace name from key if it's a split key like "Sales:Amazon AU"
    const keyParts = key.split(':');
    const marketplaceName = keyParts.length > 1 ? keyParts[1] : undefined;
    const baseCategory = keyParts[0];

    return (
      <AccountCombobox
        accounts={relevantAccounts}
        allAccounts={allAccounts}
        value={currentValue}
        onChange={(v) => setEditableMapping(prev => ({ ...prev, [key]: v }))}
        placeholder={placeholder}
        isAdmin={isAdmin}
        suggestedType={suggestedType}
        suggestedNameContext={marketplaceName ? `${marketplaceName} ${baseCategory}` : baseCategory}
        existingCodes={allAccounts.map(a => a.account_code || '').filter(Boolean)}
        onAccountCreated={async () => {
          // Refresh COA after account creation
          const [accounts, lastSynced] = await Promise.all([
            getCachedXeroAccounts(),
            getCoaLastSyncedAt(),
          ]);
          setCoaAccounts(accounts);
          setCoaLastSynced(lastSynced);
        }}
        onSelectCreated={(code) => {
          setEditableMapping(prev => ({ ...prev, [key]: code }));
        }}
      />
    );
  };

  const renderMarketplaceOverrides = (baseCat: string) => {
    if (!splitByMarketplace) return null;
    const marketplaces = getEffectiveMarketplaces();
    if (marketplaces.length === 0) return null;

    return marketplaces.map(mp => {
      const key = `${baseCat}:${mp}`;
      const baseCode = editableMapping[baseCat] || mapping[baseCat]?.code || '';
      const overrideCode = editableMapping[key] || '';
      const aiSuggestion = mapping[key]; // AI-suggested per-rail mapping
      return (
        <tr key={key} className="border-b last:border-b-0 bg-muted/20">
          <td className="p-2 pl-6">
            <div className="text-xs text-muted-foreground">↳ {mp} {baseCat}</div>
          </td>
          <td className="p-2">
            {aiSuggestion?.code ? (
              <span className="text-xs">
                <span className="font-mono">{aiSuggestion.code}</span>
                <span className="text-muted-foreground ml-1">— {aiSuggestion.name}</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Fallback: <span className="font-mono">{baseCode}</span>
              </span>
            )}
          </td>
          <td className="p-2">
            {renderStatusBadge(overrideCode || baseCode, baseCat)}
          </td>
          <td className="p-2">
            {renderAccountSelector(key, baseCat, baseCode)}
          </td>
        </tr>
      );
    });
  };

  // Count missing mappings
  const missingCount = CATEGORIES.filter(cat => {
    const code = editableMapping[cat] || mapping[cat]?.code;
    return !code || validateCode(code, cat) !== 'valid';
  }).length;

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // ─── Shared COA refresh strip ──────────────────────────────────────
  const renderCoaRefreshStrip = () => (
    <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
      <div className="flex items-center gap-2">
        <span>
          {coaAccounts.length > 0
            ? `${coaAccounts.length} Xero accounts cached`
            : 'No Xero accounts cached'}
        </span>
        {coaLastSynced && (
          <span className="text-[10px]">
            · Last refreshed {new Date(coaLastSynced).toLocaleDateString()} {new Date(coaLastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={handleRefreshCoa} disabled={refreshingCoa} className="h-6 text-xs gap-1">
        {refreshingCoa ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        Refresh from Xero
      </Button>
    </div>
  );

  // ─── UNMAPPED STATE ──────────────────────────────────────────────
  if (state === 'unmapped') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Account Mapper
          </CardTitle>
          <CardDescription>
            Automatically match your Xero chart of accounts to ecommerce settlement categories using AI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {renderCoaRefreshStrip()}
          <Button onClick={runMapper} className="gap-2">
            <Sparkles className="h-4 w-4" />
            Auto-detect accounts
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── SCANNING STATE ──────────────────────────────────────────────
  if (state === 'scanning') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            AI Account Mapper
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Reading your Xero chart of accounts...</p>
          <p className="text-xs text-muted-foreground">This takes a few seconds while AI matches your accounts.</p>
        </CardContent>
      </Card>
    );
  }

  // ─── REVIEW STATE ────────────────────────────────────────────────
  if (state === 'review') {
    const categoriesToShow = showOnlyMissing
      ? CATEGORIES.filter(cat => {
          const code = editableMapping[cat] || mapping[cat]?.code;
          return !code || validateCode(code, cat) !== 'valid';
        })
      : [...CATEGORIES];

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Account Mapper
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            Review the AI-suggested mapping below. Select accounts from your Xero COA.
            {confidenceBadge(confidence)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderCoaRefreshStrip()}

          {/* Top controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleApplySuggestionsToMissing} className="h-7 text-xs gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Apply suggestions to all missing
            </Button>
            <div className="flex items-center gap-1.5">
              <Switch
                id="show-missing"
                checked={showOnlyMissing}
                onCheckedChange={setShowOnlyMissing}
              />
              <Label htmlFor="show-missing" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                <Filter className="h-3 w-3" />
                Show only missing
              </Label>
            </div>
            {missingCount > 0 && (
              <Badge variant="outline" className="text-destructive border-destructive/30 text-[10px]">
                {missingCount} unmapped — will block posting
              </Badge>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium">Category</th>
                  <th className="text-left p-2 font-medium">Suggested</th>
                  <th className="text-center p-2 font-medium w-20">Status</th>
                  <th className="text-left p-2 font-medium">Xero Account</th>
                </tr>
              </thead>
              <tbody>
                {categoriesToShow.map((cat) => {
                  const entry = mapping[cat];
                  const currentCode = editableMapping[cat] || entry?.code || '';
                  const isSplittable = (SPLITTABLE_CATEGORIES as readonly string[]).includes(cat);
                  return (
                    <React.Fragment key={cat}>
                      <tr className="border-b last:border-b-0">
                        <td className="p-2">
                          <div className="font-medium">{cat}</div>
                          <div className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</div>
                        </td>
                        <td className="p-2">
                          {entry?.code ? (
                            <span className="text-xs">
                              <span className="font-mono">{entry.code}</span>
                              <span className="text-muted-foreground ml-1">— {entry.name}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {renderStatusBadge(currentCode, cat)}
                        </td>
                        <td className="p-2">
                          {renderAccountSelector(cat, cat)}
                        </td>
                      </tr>
                      {isSplittable && renderMarketplaceOverrides(cat)}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Split by marketplace toggle */}
          {getEffectiveMarketplaces().length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2">
              <Switch
                id="split-marketplace"
                checked={splitByMarketplace}
                onCheckedChange={handleSplitToggle}
              />
              <Label htmlFor="split-marketplace" className="text-xs text-muted-foreground cursor-pointer">
                Split revenue by marketplace — map Sales & Shipping accounts per channel
              </Label>
            </div>
          )}

          {notes && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{notes}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleConfirm} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Confirm & Save
            </Button>
            <Button variant="outline" onClick={runMapper} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Re-run
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── CONFIRMED STATE ─────────────────────────────────────────────
  const marketplaceOverrideKeys = Object.keys(mapping).filter(k => k.includes(':'));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          AI Account Mapper
        </CardTitle>
        <CardDescription>
          Account mapping confirmed. All Xero pushes use these codes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {renderCoaRefreshStrip()}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {CATEGORIES.map((cat) => {
            const entry = mapping[cat];
            const code = entry?.code;
            const coaEntry = code ? coaMap.get(code) : undefined;
            return (
              <div key={cat} className="flex items-center justify-between py-1 border-b border-border/50 gap-2">
                <span className="text-muted-foreground">{cat}</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono">{code || '—'}</span>
                  {coaEntry && <span className="text-muted-foreground truncate max-w-[100px]">{coaEntry.name}</span>}
                  {renderValidationBadge(code, cat)}
                </span>
              </div>
            );
          })}
        </div>

        {marketplaceOverrideKeys.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">Marketplace overrides</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {marketplaceOverrideKeys.map(key => {
                const [cat, mp] = key.split(':');
                const code = mapping[key]?.code;
                return (
                  <div key={key} className="flex items-center justify-between py-1 border-b border-border/50 gap-2">
                    <span className="text-muted-foreground">{mp} {cat}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono">{code || '—'}</span>
                      {renderValidationBadge(code, cat || 'Sales')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {getEffectiveMarketplaces().length > 1 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Per-marketplace mapping mode</p>
            <div className="space-y-2">
              {getEffectiveMarketplaces().map(mp => (
                <div key={mp} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium">{mp}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {globalMappingFlags[mp] !== false
                        ? 'Uses global account mappings as fallback'
                        : 'Requires explicit mappings — no fallback to global'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`global-${mp}`} className="text-[10px] text-muted-foreground">
                      Use global
                    </Label>
                    <Switch
                      id={`global-${mp}`}
                      checked={globalMappingFlags[mp] !== false}
                      onCheckedChange={async (checked) => {
                        const newFlags = { ...globalMappingFlags, [mp]: checked };
                        setGlobalMappingFlags(newFlags);
                        try {
                          const { data: { user } } = await supabase.auth.getUser();
                          if (!user) return;
                          await supabase
                            .from('marketplace_connections')
                            .update({ settings: { use_global_mappings: checked } } as any)
                            .eq('user_id', user.id)
                            .eq('marketplace_name', mp);
                          toast.success(`${mp}: ${checked ? 'global mappings enabled' : 'explicit mappings required'}`);
                        } catch (e) {
                          console.error('Failed to save use_global_mappings:', e);
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {missingCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{missingCount} category{missingCount > 1 ? 'ies' : 'y'} unmapped or invalid — this will block Compare and posting</span>
          </div>
        )}

        <TrackingCategoryPrompt />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setState('review')} className="gap-2">
            <Search className="h-3 w-3" />
            Edit mappings
          </Button>
          <Button variant="outline" size="sm" onClick={runMapper} className="gap-2">
            <RefreshCw className="h-3 w-3" />
            Re-run AI mapper
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Searchable Account Combobox ──────────────────────────────────────────────

function AccountCombobox({
  accounts,
  allAccounts,
  value,
  onChange,
  placeholder,
  isAdmin = false,
  suggestedType = 'REVENUE',
  suggestedNameContext = '',
  existingCodes = [],
  onAccountCreated,
  onSelectCreated,
}: {
  accounts: CachedXeroAccount[];
  allAccounts: CachedXeroAccount[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isAdmin?: boolean;
  suggestedType?: string;
  suggestedNameContext?: string;
  existingCodes?: string[];
  onAccountCreated?: () => Promise<void>;
  onSelectCreated?: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const displayAccounts = showAll ? allAccounts : accounts;
  const selectedAccount = allAccounts.find(a => a.account_code === value);

  // Suggest next available code based on existing codes in the type range
  const suggestNextCode = (): string => {
    const numericCodes = existingCodes
      .map(c => parseInt(c, 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
    
    // Find codes in the relevant range
    const rangeStart = suggestedType === 'REVENUE' || suggestedType === 'OTHERINCOME' ? 200 : 400;
    const rangeEnd = rangeStart + 199;
    const codesInRange = numericCodes.filter(c => c >= rangeStart && c <= rangeEnd);
    
    if (codesInRange.length === 0) return String(rangeStart);
    return String(Math.max(...codesInRange) + 1);
  };

  const suggestedName = suggestedNameContext
    ? `${suggestedNameContext} AU`
    : '';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-7 w-[200px] justify-between text-xs font-normal"
          >
            {value ? (
              <span className="truncate">
                <span className="font-mono">{value}</span>
                {selectedAccount && <span className="text-muted-foreground ml-1">— {selectedAccount.account_name}</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder || 'Select account…'}</span>
            )}
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search by code or name…" className="text-xs" />
            <CommandList>
              <CommandEmpty>
                <div className="py-3 text-center text-xs text-muted-foreground space-y-2">
                  <p>No matching account found in Xero</p>
                  {isAdmin ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        setOpen(false);
                        setCreateDialogOpen(true);
                      }}
                    >
                      <Plus className="h-3 w-3" />
                      Create in Xero…
                    </Button>
                  ) : (
                    <p className="text-[10px]">Create this account in Xero manually, then Refresh</p>
                  )}
                </div>
              </CommandEmpty>
              <CommandGroup heading={showAll ? 'All accounts' : 'Relevant accounts'}>
                {displayAccounts.map((acc) => (
                  <CommandItem
                    key={acc.xero_account_id}
                    value={`${acc.account_code} ${acc.account_name}`}
                    onSelect={() => {
                      onChange(acc.account_code || '');
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <span className="font-mono mr-2 text-foreground">{acc.account_code}</span>
                    <span className="truncate text-muted-foreground">{acc.account_name}</span>
                    <Badge variant="outline" className="ml-auto text-[9px] shrink-0">{acc.account_type}</Badge>
                    {acc.account_code === value && <CheckCircle2 className="ml-1 h-3 w-3 text-emerald-500 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>
              {!showAll && allAccounts.length > accounts.length && (
                <div className="p-2 border-t">
                  <Button variant="ghost" size="sm" className="w-full h-6 text-xs" onClick={() => setShowAll(true)}>
                    Show all {allAccounts.length} accounts
                  </Button>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {isAdmin && (
        <CreateAccountDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          suggestedCode={suggestNextCode()}
          suggestedName={suggestedName}
          suggestedType={suggestedType}
          onCreated={async (code) => {
            if (onAccountCreated) await onAccountCreated();
            if (onSelectCreated) onSelectCreated(code);
            onChange(code);
          }}
        />
      )}
    </>
  );
}

// ─── Create Account Dialog ───────────────────────────────────────────────────

function CreateAccountDialog({
  open,
  onOpenChange,
  suggestedCode,
  suggestedName,
  suggestedType,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestedCode: string;
  suggestedName: string;
  suggestedType: string;
  onCreated: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState(suggestedCode);
  const [name, setName] = useState(suggestedName);
  const [type, setType] = useState(suggestedType);
  const [creating, setCreating] = useState(false);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setCode(suggestedCode);
      setName(suggestedName);
      setType(suggestedType);
    }
  }, [open, suggestedCode, suggestedName, suggestedType]);

  const handleCreate = async () => {
    if (!code || !name || !type) {
      toast.error('Code, name, and type are required');
      return;
    }
    setCreating(true);
    try {
      const result = await createXeroAccounts([{ code, name, type }]);
      if (!result.success) {
        toast.error(`Failed: ${result.error}`);
        return;
      }
      if (result.errors && result.errors.length > 0) {
        toast.error(`Xero error: ${result.errors[0].error}`);
        return;
      }
      toast.success(`Created account ${code} — ${name} in Xero`);
      onOpenChange(false);
      await onCreated(code);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Create Account in Xero</DialogTitle>
          <DialogDescription className="text-xs">
            This will create a new account in your Xero Chart of Accounts.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-xs">
            This will create a new account in your Xero Chart of Accounts. This cannot be undone from Xettle.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Account Code</Label>
            <Input
              className="h-8 text-sm font-mono mt-1"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 214"
            />
          </div>
          <div>
            <Label className="text-xs">Account Name</Label>
            <Input
              className="h-8 text-sm mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BigW Sales AU"
            />
          </div>
          <div>
            <Label className="text-xs">Account Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-8 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="REVENUE">Revenue</SelectItem>
                <SelectItem value="DIRECTCOSTS">Direct Costs</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
                <SelectItem value="OTHERINCOME">Other Income</SelectItem>
                <SelectItem value="OVERHEADS">Overheads</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !code || !name} className="gap-1">
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create & Map
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tracking Category Prompt ────────────────────────────────────────────────

function TrackingCategoryPrompt() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'xero_tracking_enabled')
        .maybeSingle();
      setEnabled(data?.value === 'true');
    };
    check();
  }, []);

  const handleEnable = async () => {
    setToggling(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'xero_tracking_enabled',
        value: 'true',
      } as any, { onConflict: 'user_id,key' });
      setEnabled(true);
      toast.success('Tracking Categories enabled');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setToggling(false);
    }
  };

  if (enabled === null) return null;

  if (enabled) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Tracking Categories: Enabled ✓
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between text-xs bg-muted/50 border rounded-md px-3 py-2">
      <span className="text-muted-foreground">📊 Enable Tracking Categories for per-channel P&L</span>
      <Button variant="outline" size="sm" onClick={handleEnable} disabled={toggling} className="h-6 text-xs px-2">
        {toggling ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enable'}
      </Button>
    </div>
  );
}
