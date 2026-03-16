import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, CheckCircle2, RefreshCw, Info, AlertTriangle, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type CoaValidation = 'valid' | 'missing' | 'inactive' | 'wrong_type';

interface CoaEntry {
  name: string;
  type: string;
  active: boolean;
}

interface XeroAccount {
  code: string;
  name: string;
  type: string;
  taxType: string;
  description: string;
}

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

/** Known marketplace labels that match MARKETPLACE_LABELS in settlement-engine */
const KNOWN_MARKETPLACES = [
  'Amazon AU', 'Shopify', 'Bunnings', 'eBay AU', 'Catch',
  'MyDeal', 'Kogan', 'Everyday Market', 'The Iconic', 'Etsy',
];

export default function AccountMapperCard() {
  const [state, setState] = useState<MapperState>('unmapped');
  const [mapping, setMapping] = useState<Record<string, MappingEntry>>({});
  const [editableMapping, setEditableMapping] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<string>('medium');
  const [notes, setNotes] = useState<string>('');
  const [accounts, setAccounts] = useState<XeroAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Marketplace split state
  const [splitByMarketplace, setSplitByMarketplace] = useState(false);
  const [activeMarketplaces, setActiveMarketplaces] = useState<string[]>([]);
  // CoA validation state
  const [coaMap, setCoaMap] = useState<Map<string, CoaEntry>>(new Map());
  // Per-marketplace use_global_mappings flags
  const [globalMappingFlags, setGlobalMappingFlags] = useState<Record<string, boolean>>({});

  // Load current state on mount
  useEffect(() => {
    loadCurrentState();
  }, []);

  const loadCurrentState = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Load cached Chart of Accounts for validation badges
      const { data: coaAccounts } = await supabase
        .from('xero_chart_of_accounts')
        .select('account_code, account_name, account_type, is_active')
        .eq('user_id', user.id);
      const newCoaMap = new Map<string, CoaEntry>();
      for (const acc of (coaAccounts || [])) {
        if (acc.account_code) {
          newCoaMap.set(acc.account_code, {
            name: acc.account_name,
            type: (acc.account_type || '').toUpperCase(),
            active: acc.is_active !== false,
          });
        }
      }
      setCoaMap(newCoaMap);

      // Load split toggle state
      const { data: splitSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_split_by_marketplace')
        .maybeSingle();
      const isSplit = splitSetting?.value === 'true';
      setSplitByMarketplace(isSplit);

      // Load active marketplace connections to know which channels to show
      const { data: connections } = await supabase
        .from('marketplace_connections')
        .select('marketplace_name')
        .eq('user_id', user.id)
        .eq('connection_status', 'connected');

      if (connections && connections.length > 0) {
        setActiveMarketplaces(connections.map(c => c.marketplace_name));
      } else {
        // Fallback: detect from settlements
        const { data: settlements } = await supabase
          .from('settlements')
          .select('marketplace')
          .eq('user_id', user.id)
          .not('status', 'in', '("duplicate_suppressed","already_recorded")');
        if (settlements) {
          const unique = [...new Set(settlements.map(s => s.marketplace).filter(Boolean))];
          // Map codes to labels
          const labels = unique.map(code => {
            const labelMap: Record<string, string> = {
              amazon_au: 'Amazon AU', bunnings: 'Bunnings', shopify_payments: 'Shopify',
              shopify_orders: 'Shopify', catch: 'Catch', mydeal: 'MyDeal',
              kogan: 'Kogan', woolworths: 'Everyday Market', ebay_au: 'eBay AU',
              etsy: 'Etsy', theiconic: 'The Iconic',
            };
            return labelMap[code || ''] || code || '';
          }).filter(Boolean);
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
              restored[cat] = { code: codes[cat], name: `Account ${codes[cat]}` };
            }
          }
          // Restore marketplace overrides
          for (const key of Object.keys(codes)) {
            if (key.includes(':')) {
              restored[key] = { code: codes[key], name: `Account ${codes[key]}` };
            }
          }
          setMapping(restored);

          // Restore editable mapping
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
      setAccounts(data.accounts || []);

      const editable: Record<string, string> = {};
      for (const [cat, entry] of Object.entries(data.mapping || {})) {
        editable[cat] = (entry as MappingEntry).code;
      }
      setEditableMapping(editable);
      setState('review');
    } catch (err: any) {
      toast.error(`AI mapper failed: ${err.message}`);
      setState('unmapped');
    }
  }, []);

  const handleSplitToggle = async (enabled: boolean) => {
    setSplitByMarketplace(enabled);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'accounting_split_by_marketplace',
        value: enabled ? 'true' : 'false',
      } as any, { onConflict: 'user_id,key' });

      // If disabling, strip marketplace-specific keys from editable mapping
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

  const handleConfirm = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build the final codes object
      const finalCodes: Record<string, string> = {};
      for (const cat of CATEGORIES) {
        finalCodes[cat] = editableMapping[cat] || mapping[cat]?.code || '';
      }

      // Include marketplace-specific overrides if split is enabled
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

      // Save to accounting_xero_account_codes
      const { error } = await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'accounting_xero_account_codes',
        value: JSON.stringify(finalCodes),
      } as any, { onConflict: 'user_id,key' });

      if (error) throw error;

      // Update mapper status
      await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'ai_mapper_status',
        value: 'confirmed',
      } as any, { onConflict: 'user_id,key' });

      // Update mapping display with potentially edited values
      const updatedMapping: Record<string, MappingEntry> = {};
      for (const cat of CATEGORIES) {
        const code = finalCodes[cat];
        const account = accounts.find(a => a.code === code);
        updatedMapping[cat] = {
          code,
          name: account?.name || mapping[cat]?.name || `Account ${code}`,
        };
      }
      // Include marketplace overrides in display mapping
      for (const key of Object.keys(finalCodes)) {
        if (key.includes(':')) {
          updatedMapping[key] = { code: finalCodes[key], name: `Account ${finalCodes[key]}` };
        }
      }
      setMapping(updatedMapping);
      setState('confirmed');
      toast.success('Account mapping saved — all Xero pushes will use these codes');
    } catch (err: any) {
      toast.error(`Failed to save mapping: ${err.message}`);
    }
  };

  /** Get marketplaces to display — active connections or detected from settlements */
  const getEffectiveMarketplaces = (): string[] => {
    if (activeMarketplaces.length > 0) return activeMarketplaces;
    return KNOWN_MARKETPLACES.slice(0, 3); // Safe default
  };

  const confidenceBadge = (level: string) => {
    if (level === 'high') return <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">✅ High</Badge>;
    if (level === 'medium') return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">⚠️ Medium</Badge>;
    return <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50">❌ Low</Badge>;
  };

  const REVENUE_CATEGORIES_SET = new Set(['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements']);
  const REVENUE_ACCOUNT_TYPES = new Set(['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS']);
  const EXPENSE_ACCOUNT_TYPES = new Set(['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS', 'CURRLIAB', 'LIABILITY']);

  /** Validate a single account code against the cached CoA */
  const validateCode = (code: string | undefined, category: string): CoaValidation => {
    if (!code || coaMap.size === 0) return 'valid'; // No CoA data — skip validation
    const entry = coaMap.get(code);
    if (!entry) return 'missing';
    if (!entry.active) return 'inactive';
    const isRevenue = REVENUE_CATEGORIES_SET.has(category);
    const validTypes = isRevenue ? REVENUE_ACCOUNT_TYPES : EXPENSE_ACCOUNT_TYPES;
    if (!validTypes.has(entry.type)) return 'wrong_type';
    return 'valid';
  };

  /** Render a validation badge next to a mapping */
  const renderValidationBadge = (code: string | undefined, category: string) => {
    if (!code || coaMap.size === 0) return null;
    const status = validateCode(code, category);
    if (status === 'valid') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    if (status === 'missing') return (
      <span className="flex items-center gap-1 text-[10px] text-red-600">
        <XCircle className="h-3.5 w-3.5 shrink-0" /> Missing
      </span>
    );
    if (status === 'inactive') return (
      <span className="flex items-center gap-1 text-[10px] text-red-600">
        <XCircle className="h-3.5 w-3.5 shrink-0" /> Inactive
      </span>
    );
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-600">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Wrong type
      </span>
    );
  };

  /** Render an account code selector (dropdown or text input) */
  const renderAccountSelector = (key: string, placeholder?: string) => {
    if (accounts.length > 0) {
      return (
        <Select
          value={editableMapping[key] || mapping[key]?.code || ''}
          onValueChange={(v) => setEditableMapping(prev => ({ ...prev, [key]: v }))}
        >
          <SelectTrigger className="h-7 text-xs w-24">
            <SelectValue placeholder={placeholder || 'Select'} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.code} value={a.code} className="text-xs">
                {a.code} — {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <input
        className="h-7 w-20 text-xs border rounded px-1.5 font-mono bg-background"
        placeholder={placeholder}
        value={editableMapping[key] || mapping[key]?.code || ''}
        onChange={(e) => setEditableMapping(prev => ({ ...prev, [key]: e.target.value }))}
      />
    );
  };

  /** Render marketplace override rows for a splittable category */
  const renderMarketplaceOverrides = (baseCat: string) => {
    if (!splitByMarketplace) return null;
    const marketplaces = getEffectiveMarketplaces();
    if (marketplaces.length === 0) return null;

    return marketplaces.map(mp => {
      const key = `${baseCat}:${mp}`;
      const baseCode = editableMapping[baseCat] || mapping[baseCat]?.code || '';
      return (
        <tr key={key} className="border-b last:border-b-0 bg-muted/20">
          <td className="p-2 pl-6">
            <div className="text-xs text-muted-foreground">↳ {mp} {baseCat}</div>
          </td>
          <td className="p-2">
            <span className="text-xs text-muted-foreground">
              Fallback: <span className="font-mono">{baseCode}</span>
            </span>
          </td>
          <td className="p-2">
            {renderAccountSelector(key, baseCode)}
          </td>
        </tr>
      );
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

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
        <CardContent>
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
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Account Mapper
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            Review the AI-suggested mapping below. Override any row you disagree with.
            {confidenceBadge(confidence)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium">Category</th>
                  <th className="text-left p-2 font-medium">Suggested Account</th>
                  <th className="text-center p-2 font-medium w-20">Override</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => {
                  const entry = mapping[cat];
                  const isSplittable = (SPLITTABLE_CATEGORIES as readonly string[]).includes(cat);
                  return (
                    <React.Fragment key={cat}>
                      <tr className="border-b last:border-b-0">
                        <td className="p-2">
                          <div className="font-medium">{cat}</div>
                          <div className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</div>
                        </td>
                        <td className="p-2">
                          <span className="font-mono text-xs">{entry?.code}</span>
                          <span className="text-muted-foreground ml-1 text-xs">— {entry?.name}</span>
                        </td>
                        <td className="p-2">
                          {renderAccountSelector(cat)}
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
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {CATEGORIES.map((cat) => {
            const entry = mapping[cat];
            const code = entry?.code;
            return (
              <div key={cat} className="flex items-center justify-between py-1 border-b border-border/50 gap-2">
                <span className="text-muted-foreground">{cat}</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono">{code || '—'}</span>
                  {renderValidationBadge(code, cat)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Show marketplace overrides if any */}
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

        <TrackingCategoryPrompt />
        <Button variant="outline" size="sm" onClick={runMapper} className="gap-2">
          <RefreshCw className="h-3 w-3" />
          Re-run AI mapper
        </Button>
      </CardContent>
    </Card>
  );
}

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
