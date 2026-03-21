// ══════════════════════════════════════════════════════════════
// BEFORE adding new utility logic here, check src/utils/index.ts
// for existing capabilities. Key utils: coa-intelligence.ts,
// xero-mapping-readiness.ts, bookkeeper-readiness.ts
// ══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { analyseCoA, type RegistryEntry, type ProcessorEntry, type CoaAccount as CoaIntelAccount } from '@/utils/coa-intelligence';
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
  getMarketplaceCoverage,
  type CachedXeroAccount,
} from '@/actions';
import { generateNextCode, getAccountTypeForCategory, getRangeForType, detectCodePattern, generateCodeFromPattern, type PatternAccount } from '@/policy/accountCodePolicy';
import { ACTIVE_CONNECTION_STATUSES } from '@/constants/connection-status';
import { normalizeKeyLabel } from '@/utils/marketplace-codes';
import { Save, Upload, Copy } from 'lucide-react';
import CloneCoaDialog from './CloneCoaDialog';
import CoaAuditPanel from './CoaAuditPanel';
import XeroCoaSyncModal, { type SyncPreviewRow } from './XeroCoaSyncModal';

type CoaValidation = 'valid' | 'missing' | 'inactive' | 'wrong_type' | 'reuse_existing';

interface MappingEntry {
  code: string;
  name: string;
}

type MapperState = 'unmapped' | 'scanning' | 'review' | 'confirmed';

const CATEGORIES = [
  'Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements',
  'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees',
] as const;

/** Categories that support per-marketplace overrides */
const SPLITTABLE_CATEGORIES = ['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees'] as const;

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'Sales': 'Gross product sales revenue',
  'Shipping': 'Shipping revenue charged to customers',
  'Promotional Discounts': 'Vouchers & promotions reducing sale price',
  'Refunds': 'Product & shipping refunds to customers',
  'Reimbursements': 'Marketplace reimbursements (not taxable)',
  'Seller Fees': 'Referral & selling fees charged by marketplace',
  'FBA Fees': 'Fulfilment, pick & pack, delivery fees',
  'Storage Fees': 'Warehouse & inventory storage fees',
  'Advertising Costs': 'Sponsored products, PPC ads & campaign spend',
  'Other Fees': 'Miscellaneous marketplace charges',
};

const KNOWN_MARKETPLACES = [
  'Amazon AU', 'Amazon USA', 'Amazon JP', 'Amazon SG', 'Amazon UK',
  'Shopify', 'Bunnings', 'eBay AU', 'Catch',
  'MyDeal', 'Kogan', 'Everyday Market', 'The Iconic', 'Etsy', 'BigW',
];

const REVENUE_CATEGORIES_SET = new Set(['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements']);
const REVENUE_ACCOUNT_TYPES = new Set(['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS']);
const EXPENSE_ACCOUNT_TYPES = new Set(['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS', 'CURRLIAB', 'LIABILITY']);
const SUPPORTED_TAX_PROFILES = ['AU_GST', 'EXPORT_NO_GST'] as const;

function normalizeTaxProfileValue(value: string | null | undefined): (typeof SUPPORTED_TAX_PROFILES)[number] | null {
  if (!value) return null;

  const trimmed = value.trim();
  const legacyMap: Record<string, (typeof SUPPORTED_TAX_PROFILES)[number]> = {
    AU_GST: 'AU_GST',
    GST_REGISTERED: 'AU_GST',
    AU_GST_STANDARD: 'AU_GST',
    EXPORT_NO_GST: 'EXPORT_NO_GST',
    NO_GST: 'EXPORT_NO_GST',
    NOT_GST_REGISTERED: 'EXPORT_NO_GST',
  };

  return legacyMap[trimmed] ?? null;
}

function formatLastSyncedLabel(value: string | null): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return `${parsed.toLocaleDateString()} ${parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function AccountMapperCard() {
  const queryClient = useQueryClient();
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
  const [searchKeyword, setSearchKeyword] = useState('');

  // Marketplace split state
  const [splitByMarketplace, setSplitByMarketplace] = useState(false);
  const [activeMarketplaces, setActiveMarketplaces] = useState<string[]>([]);
  const [globalMappingFlags, setGlobalMappingFlags] = useState<Record<string, boolean>>({});
  const [registryEntries, setRegistryEntries] = useState<RegistryEntry[]>([]);
  const [processorEntries, setProcessorEntries] = useState<ProcessorEntry[]>([]);

  // Clone COA state
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneTarget, setCloneTarget] = useState('');
  const [taxProfile, setTaxProfile] = useState<string | null>(null);

  // Overwrite confirmation state
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const [overwriteChanges, setOverwriteChanges] = useState<Array<{ category: string; oldCode: string; newCode: string }>>([]);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<(() => Promise<void>) | null>(null);

  // Sync modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  // Excluded marketplace:category combos (persisted to app_settings)
  const [excludedMappings, setExcludedMappings] = useState<Set<string>>(new Set());
  const [excludedMarketplaces, setExcludedMarketplaces] = useState<Set<string>>(new Set());
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(new Set());

  // Ignored marketplaces — hidden from clone banner & gap detection site-wide
  const [ignoredMarketplaces, setIgnoredMarketplaces] = useState<Set<string>>(new Set());

  // Confirmed (saved) codes for comparison
  const [confirmedCodes, setConfirmedCodes] = useState<Record<string, string>>({});

  // Build CoA lookup maps
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

  const coaNameToCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of coaAccounts) {
      if (acc.account_code && acc.account_name) {
        map.set(acc.account_name.toLowerCase().trim(), acc.account_code);
      }
    }
    return map;
  }, [coaAccounts]);

  // ─── Gap detection: find uncovered marketplaces (via canonical action) ──
  const { uncoveredMarketplaces, coveredMarketplaces, coverageDetails } = useMemo(() => {
    if (!splitByMarketplace || coaAccounts.length === 0 || activeMarketplaces.length === 0) {
      return { uncoveredMarketplaces: [] as string[], coveredMarketplaces: [] as string[], coverageDetails: [] as { marketplace: string; status: string; matchCount: number }[] };
    }

    const coverage = getMarketplaceCoverage(activeMarketplaces, coaAccounts);
    return {
      uncoveredMarketplaces: coverage.uncovered,
      coveredMarketplaces: [...coverage.covered, ...coverage.partial],
      coverageDetails: coverage.details,
    };
  }, [splitByMarketplace, coaAccounts, activeMarketplaces]);

  // ─── COA-based suggestions via coa-intelligence scanner ─────────
  const coaSuggestions = useMemo(() => {
    if (!splitByMarketplace || coaAccounts.length === 0) return new Map<string, { code: string; name: string; isGapFill?: boolean }>();

    // Map coa-intelligence lowercase categories → AccountMapper display names
    const CATEGORY_DISPLAY_MAP: Record<string, string> = {
      sales: 'Sales',
      seller_fees: 'Seller Fees',
      fba_fees: 'FBA Fees',
      storage_fees: 'Storage Fees',
      advertising: 'Advertising Costs',
      refunds: 'Refunds',
      shipping: 'Shipping',
      other_fees: 'Other Fees',
      reimbursements: 'Reimbursements',
      promotional_discounts: 'Promotional Discounts',
    };

    // Build CoaAccount[] compatible with coa-intelligence
    const coaInput: CoaIntelAccount[] = coaAccounts.map(a => ({
      account_code: a.account_code,
      account_name: a.account_name,
      account_type: a.account_type || null,
      tax_type: null,
    }));

    const signals = analyseCoA(coaInput, registryEntries, processorEntries);

    // Build marketplace_code → canonical key label lookup
    const codeToKeyLabel = new Map<string, string>();
    for (const entry of registryEntries) {
      codeToKeyLabel.set(entry.marketplace_code, normalizeKeyLabel(entry.marketplace_code));
    }

    const suggestions = new Map<string, { code: string; name: string; isGapFill?: boolean }>();

    for (const s of signals.mapping_suggestions) {
      const displayCategory = CATEGORY_DISPLAY_MAP[s.category];
      if (!displayCategory) continue;

      const keyLabel = codeToKeyLabel.get(s.marketplace_code) || normalizeKeyLabel(s.marketplace_code);
      if (!activeMarketplaces.includes(keyLabel)) continue;

      const key = `${displayCategory}:${keyLabel}`;
      if (!suggestions.has(key)) {
        suggestions.set(key, { code: s.account_code, name: s.account_name });
      }
    }

    // ─── Pattern-aware, Revenue/Expense-partitioned gap fill ─────────
    // 1. Detect the customer's existing code pattern from AI suggestions
    // 2. Use generateCodeFromPattern to extend each category's neighbourhood
    // 3. Fall back to sequential range-based generation if no pattern detected
    const allExistingCodes = coaAccounts.map(a => a.account_code).filter(Boolean) as string[];
    const globalClaimed = new Set<string>();

    // First pass: register all codes from AI suggestions into globalClaimed
    // and build PatternAccount[] for pattern detection
    const patternAccounts: PatternAccount[] = [];
    for (const [key, entry] of suggestions) {
      if (entry.code) {
        globalClaimed.add(entry.code);
        const [category] = key.split(':');
        patternAccounts.push({
          code: entry.code,
          category,
          type: getAccountTypeForCategory(category),
        });
      }
    }

    // Detect the customer's COA numbering pattern from existing mapped accounts
    const codePattern = detectCodePattern(patternAccounts);

    // Process categories grouped by Revenue then Expense to keep ranges separate
    const categoryEntries = Object.entries(CATEGORY_DISPLAY_MAP);
    const revenueCategories = categoryEntries.filter(([, displayCat]) => REVENUE_CATEGORIES_SET.has(displayCat));
    const expenseCategories = categoryEntries.filter(([, displayCat]) => !REVENUE_CATEGORIES_SET.has(displayCat));

    for (const group of [revenueCategories, expenseCategories]) {
      for (const [, displayCat] of group) {
        for (const mp of activeMarketplaces) {
          const key = `${displayCat}:${mp}`;
          if (suggestions.has(key)) continue;

          const accountType = getAccountTypeForCategory(displayCat);
          let codeStr: string;

          if (codePattern) {
            // Pattern-aware: extend the category's neighbourhood
            codeStr = generateCodeFromPattern({
              pattern: codePattern,
              category: displayCat,
              accountType,
              existingCodes: allExistingCodes,
              batchClaimed: globalClaimed,
            });
          } else {
            // No pattern detected: fall back to sequential within correct range
            codeStr = generateNextCode({
              existingCodes: allExistingCodes,
              accountType,
              batchClaimed: globalClaimed,
            });
          }

          globalClaimed.add(codeStr);
          suggestions.set(key, {
            code: codeStr,
            name: `${mp} ${displayCat}`,
            isGapFill: true,
          });
        }
      }
    }

    return suggestions;
  }, [splitByMarketplace, coaAccounts, activeMarketplaces, registryEntries, processorEntries]);

  // User-selected marketplaces for COA cloning
  const [selectedForClone, setSelectedForClone] = useState<Set<string>>(new Set());

  // ─── Clone COA banner renderer ───────────────────────────────────
  const renderCloneBanner = () => {
    if (!splitByMarketplace || !isAdmin || activeMarketplaces.length === 0 || coaAccounts.length === 0) return null;

    // Only show clone options for truly uncovered marketplaces, excluding ignored ones
    const uncoveredDetails = coverageDetails.filter(d => d.status === 'uncovered' && !ignoredMarketplaces.has(d.marketplace));

    // If everything has at least some accounts (or is ignored), don't show the clone banner
    if (uncoveredDetails.length === 0 && ignoredMarketplaces.size === 0) return null;
    if (uncoveredDetails.length === 0) {
      // Show a small restore link if there are ignored marketplaces
      return (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          <span>{ignoredMarketplaces.size} marketplace{ignoredMarketplaces.size !== 1 ? 's' : ''} ignored.</span>
          <button
            onClick={() => {
              setIgnoredMarketplaces(new Set());
              saveExclusions(excludedMappings, excludedMarketplaces, excludedCategories, new Set());
            }}
            className="text-primary hover:underline"
          >
            Restore all
          </button>
        </div>
      );
    }

    // No-template-available: nothing covered at all (can't clone from anything)
    if (coveredMarketplaces.length === 0) {
      return (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          <AlertDescription className="text-xs text-amber-900">
            No marketplace account structures detected in your COA yet.
            Create accounts manually for at least one marketplace to use as a template.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>
            {uncoveredDetails.length} marketplace{uncoveredDetails.length !== 1 ? 's have' : ' has'} no
            Xero accounts yet. Select to clone from an existing template.
          </span>
          {ignoredMarketplaces.size > 0 && (
            <span className="text-[10px]">
              ({ignoredMarketplaces.size} ignored —{' '}
              <button
                onClick={() => {
                  setIgnoredMarketplaces(new Set());
                  saveExclusions(excludedMappings, excludedMarketplaces, excludedCategories, new Set());
                }}
                className="text-primary hover:underline"
              >
                restore
              </button>
              )
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {uncoveredDetails.map(detail => {
            const isSelected = selectedForClone.has(detail.marketplace);

            return (
              <label
                key={detail.marketplace}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-amber-200 bg-amber-50/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    const next = new Set(selectedForClone);
                    if (e.target.checked) next.add(detail.marketplace);
                    else next.delete(detail.marketplace);
                    setSelectedForClone(next);
                  }}
                  className="rounded border-muted-foreground/30 h-3.5 w-3.5"
                />
                <span className="font-medium truncate">{detail.marketplace}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleIgnoreMarketplace(detail.marketplace);
                    toast.success(`${detail.marketplace} ignored — won't appear here again`);
                  }}
                  className="ml-auto shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                  title={`Ignore ${detail.marketplace} — hide from this list`}
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </label>
            );
          })}
        </div>
        {selectedForClone.size > 0 && (
          <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
            <span className="text-xs">
              Clone COA structure for <strong>{[...selectedForClone].join(', ')}</strong>?
            </span>
            <div className="flex gap-1.5 shrink-0">
              {[...selectedForClone].map(mp => (
                <Button
                  key={mp}
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => {
                    settingsPin.requirePin(() => {
                      setCloneTarget(mp);
                      setCloneDialogOpen(true);
                    });
                  }}
                >
                  <Copy className="h-3 w-3" />
                  {selectedForClone.size > 1 ? mp : 'Clone COA'}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderOverwriteConfirmDialog = () => (
    <Dialog open={overwriteConfirmOpen} onOpenChange={(v) => { if (!v) { setOverwriteConfirmOpen(false); setPendingConfirmAction(null); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-amber-500" />
            Update Internal Routing
          </DialogTitle>
          <DialogDescription>
            The following account codes will change in Xettle's internal mapping. This does <strong>not</strong> modify anything in Xero — it only controls which existing Xero accounts future settlements are posted to. All codes have been verified against your live Chart of Accounts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {overwriteChanges.map((change, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-3 py-2 text-xs">
              <span className="font-medium">{change.category}</span>
              <span className="font-mono">
                <span className="text-muted-foreground">{change.oldCode}</span>
                <span className="mx-1.5">→</span>
                <span className="font-semibold text-foreground">{change.newCode}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Previously pushed settlements are not affected. Only new pushes will use the updated codes.</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { setOverwriteConfirmOpen(false); setPendingConfirmAction(null); }}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              setOverwriteConfirmOpen(false);
              if (pendingConfirmAction) await pendingConfirmAction();
              setPendingConfirmAction(null);
            }}
          >
            Update {overwriteChanges.length} mapping{overwriteChanges.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const renderCloneDialog = () => (
    <CloneCoaDialog
      open={cloneDialogOpen}
      onOpenChange={setCloneDialogOpen}
      targetMarketplace={cloneTarget}
      coveredMarketplaces={coveredMarketplaces}
      coaAccounts={coaAccounts}
      taxProfile={taxProfile}
      onComplete={async (createdCodes) => {
        const [accounts, lastSynced] = await Promise.all([
          getCachedXeroAccounts(),
          getCoaLastSyncedAt(),
        ]);
        setCoaAccounts(accounts);
        setCoaLastSynced(lastSynced);
        const updated = { ...editableMapping };
        for (const [category, code] of Object.entries(createdCodes)) {
          const key = `${category}:${cloneTarget}`;
          updated[key] = code;
        }
        setEditableMapping(updated);
      }}
    />
  );

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

      // Load tax profile (check both keys for backward compat)
      const { data: taxSetting } = await supabase
        .from('app_settings')
        .select('value, key')
        .eq('user_id', user.id)
        .in('key', ['tax_profile', 'org_tax_profile'])
        .order('key', { ascending: true });
      const taxVal = taxSetting?.find(s => s.key === 'tax_profile')?.value
        || taxSetting?.find(s => s.key === 'org_tax_profile')?.value
        || null;
      setTaxProfile(normalizeTaxProfileValue(taxVal));
      // Load cached COA + last sync in parallel
      const [accounts, lastSynced, { data: registryRows }, { data: processorRows }] = await Promise.all([
        getCachedXeroAccounts(),
        getCoaLastSyncedAt(),
        supabase.from('marketplace_registry').select('marketplace_code, marketplace_name, detection_keywords').eq('is_active', true),
        supabase.from('payment_processor_registry').select('processor_code, processor_name, detection_keywords').eq('is_active', true),
      ]);
      setCoaAccounts(accounts);
      setCoaLastSynced(lastSynced);
      setRegistryEntries((registryRows || []) as RegistryEntry[]);
      setProcessorEntries((processorRows || []) as ProcessorEntry[]);

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
        .select('marketplace_name, marketplace_code, settings')
        .eq('user_id', user.id)
        .in('connection_status', ACTIVE_CONNECTION_STATUSES);

      if (connections && connections.length > 0) {
        // Normalize marketplace names to canonical key labels for consistent override keys
        const normalizedNames = [...new Set(connections.map(c => normalizeKeyLabel(c.marketplace_code || c.marketplace_name)))];
        setActiveMarketplaces(normalizedNames);
        const flags: Record<string, boolean> = {};
        for (const c of connections) {
          const settings = (c.settings || {}) as Record<string, any>;
          const keyLabel = normalizeKeyLabel(c.marketplace_code || c.marketplace_name);
          flags[keyLabel] = settings.use_global_mappings !== false;
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
          // Use normalizeKeyLabel for consistent key generation
          const labels = unique.map(code => normalizeKeyLabel(code || '')).filter(Boolean);
          setActiveMarketplaces([...new Set(labels)]);
        }
      }

      // Load excluded mappings
      const { data: excludedSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'coa_excluded_mappings')
        .maybeSingle();

      if (excludedSetting?.value) {
        try {
          const parsed = JSON.parse(excludedSetting.value);
          if (parsed.keys) setExcludedMappings(new Set(parsed.keys));
          if (parsed.marketplaces) setExcludedMarketplaces(new Set(parsed.marketplaces));
          if (parsed.categories) setExcludedCategories(new Set(parsed.categories));
          if (parsed.ignoredMarketplaces) setIgnoredMarketplaces(new Set(parsed.ignoredMarketplaces));
        } catch { /* ignore */ }
      }

      // Check if confirmed mapping exists
      const { data: confirmedSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_xero_account_codes')
        .maybeSingle();

      // Also check for draft mapping
      const { data: draftSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_xero_account_codes_draft')
        .maybeSingle();

      let confirmedCodesMap: Record<string, string> = {};
      let draftCodesMap: Record<string, string> = {};

      if (confirmedSetting?.value) {
        try {
          confirmedCodesMap = JSON.parse(confirmedSetting.value);
          setConfirmedCodes(confirmedCodesMap);
        } catch {
          confirmedCodesMap = {};
        }
      }

      if (draftSetting?.value) {
        try {
          draftCodesMap = JSON.parse(draftSetting.value);
        } catch {
          draftCodesMap = {};
        }
      }

      // In review mode, draft should override confirmed so unsaved marketplace-specific fixes are visible.
      const codes = Object.keys(draftCodesMap).length > 0
        ? { ...confirmedCodesMap, ...draftCodesMap }
        : confirmedCodesMap;

      if (Object.keys(codes).length > 0) {
        const restored: Record<string, MappingEntry> = {};
        for (const cat of CATEGORIES) {
          if (codes[cat]) {
            const coaEntry = accounts.find(a => a.account_code === codes[cat]);
            restored[cat] = { code: codes[cat], name: coaEntry?.account_name || `Account ${codes[cat]}` };
          }
        }
        // Normalize override keys on load for backward compatibility
        // e.g. "Sales:Shopify Payments" → "Sales:Shopify"
        for (const key of Object.keys(codes)) {
          if (key.includes(':')) {
            const [cat, rawMp] = key.split(':');
            const normalizedMp = normalizeKeyLabel(rawMp);
            const normalizedKey = `${cat}:${normalizedMp}`;
            const coaEntry = accounts.find(a => a.account_code === codes[key]);
            restored[normalizedKey] = { code: codes[key], name: coaEntry?.account_name || `Account ${codes[key]}` };
          }
        }
        setMapping(restored);

        const editable: Record<string, string> = {};
        for (const [k, v] of Object.entries(codes)) {
          if (k.includes(':')) {
            const [cat, rawMp] = k.split(':');
            const normalizedKey = `${cat}:${normalizeKeyLabel(rawMp)}`;
            editable[normalizedKey] = v as string;
          } else {
            editable[k] = v as string;
          }
        }
        setEditableMapping(editable);
        setState('review');
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

  const handleSaveDraft = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const draftCodes: Record<string, string> = {};
      for (const cat of CATEGORIES) {
        draftCodes[cat] = editableMapping[cat] || mapping[cat]?.code || '';
      }
      if (splitByMarketplace) {
        for (const mp of getEffectiveMarketplaces()) {
          for (const cat of SPLITTABLE_CATEGORIES) {
            const key = `${cat}:${mp}`;
            if (editableMapping[key]) {
              draftCodes[key] = editableMapping[key];
            }
          }
        }
      }

      const { saveDraftMappings } = await import('@/actions/accountMappings');
      const result = await saveDraftMappings(draftCodes);
      if (!result.success) throw new Error(result.error);

      toast.success('Draft saved locally — come back anytime to finish');
    } catch (err: any) {
      toast.error(`Failed to save draft: ${err.message}`);
    }
  };

  const buildFinalCodes = () => {
    const finalCodes: Record<string, string> = {};
    for (const cat of CATEGORIES) {
      if (excludedCategories.has(cat)) continue;
      finalCodes[cat] = editableMapping[cat] || mapping[cat]?.code || '';
    }
    if (splitByMarketplace) {
      for (const mp of getEffectiveMarketplaces()) {
        if (excludedMarketplaces.has(mp)) continue;
        for (const cat of SPLITTABLE_CATEGORIES) {
          if (excludedCategories.has(cat)) continue;
          const key = `${cat}:${mp}`;
          if (excludedMappings.has(key)) continue;
          if (editableMapping[key]) {
            finalCodes[key] = editableMapping[key];
          }
        }
      }
    }
    return finalCodes;
  };

  const executeConfirmAfterValidation = async (finalCodes: Record<string, string>, freshAccounts: CachedXeroAccount[]) => {
    try {
      const { confirmMappings } = await import('@/actions/accountMappings');
      const result = await confirmMappings(finalCodes);
      if (!result.success) throw new Error(result.error);

      const updatedMapping: Record<string, MappingEntry> = {};
      for (const cat of CATEGORIES) {
        const code = finalCodes[cat];
        const coaEntry = freshAccounts.find(a => a.account_code === code);
        updatedMapping[cat] = {
          code,
          name: coaEntry?.account_name || mapping[cat]?.name || `Account ${code}`,
        };
      }
      for (const key of Object.keys(finalCodes)) {
        if (key.includes(':')) {
          const coaEntry = freshAccounts.find(a => a.account_code === finalCodes[key]);
          updatedMapping[key] = { code: finalCodes[key], name: coaEntry?.account_name || `Account ${finalCodes[key]}` };
        }
      }
      setMapping(updatedMapping);
      setConfirmedCodes(finalCodes);
      setState('confirmed');
      toast.success('Account mapping confirmed — all codes verified against live Xero COA');
      queryClient.invalidateQueries({ queryKey: ['dashboard-task-counts'] });
    } catch (err: any) {
      toast.error(`Failed to save mapping: ${err.message}`);
    }
  };

  const handleConfirm = async () => {
    settingsPin.requirePin(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }

      const finalCodes = buildFinalCodes();

      // ─── Pre-validate all codes against live Xero COA ────────────────
      toast.info('Verifying accounts against live Xero data…');
      const refreshResult = await refreshXeroCOA();
      if (!refreshResult.success) {
        toast.error(`Cannot verify with Xero: ${refreshResult.error}. Please try again.`);
        return;
      }
      const [freshAccounts, freshSyncedAt] = await Promise.all([
        getCachedXeroAccounts(),
        getCoaLastSyncedAt(),
      ]);
      setCoaAccounts(freshAccounts);
      setCoaLastSynced(freshSyncedAt);

      const freshCoaSet = new Set(freshAccounts.map(a => a.account_code).filter(Boolean));
      const invalidCodes: string[] = [];
      for (const [key, code] of Object.entries(finalCodes)) {
        if (code && !freshCoaSet.has(code)) {
          invalidCodes.push(`${key} → ${code}`);
        }
      }
      if (invalidCodes.length > 0) {
        toast.error(
          `${invalidCodes.length} code${invalidCodes.length > 1 ? 's' : ''} not found in Xero. ` +
          `Create them first or choose existing accounts.`,
          { duration: 6000 }
        );
        return;
      }

      // Detect overwrites of existing confirmed codes
      const changes: Array<{ category: string; oldCode: string; newCode: string }> = [];
      for (const [key, newCode] of Object.entries(finalCodes)) {
        const oldCode = confirmedCodes[key];
        if (oldCode && newCode && oldCode !== newCode) {
          changes.push({ category: key, oldCode, newCode });
        }
      }

      if (changes.length > 0) {
        // Show overwrite confirmation — codes already validated above
        setOverwriteChanges(changes);
        setPendingConfirmAction(() => () => executeConfirmAfterValidation(finalCodes, freshAccounts));
        setOverwriteConfirmOpen(true);
      } else {
        // No overwrites — save directly (codes already validated)
        await executeConfirmAfterValidation(finalCodes, freshAccounts);
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
    // Apply per-marketplace override suggestions from AI + COA scan
    if (splitByMarketplace) {
      for (const mp of getEffectiveMarketplaces()) {
        for (const cat of SPLITTABLE_CATEGORIES) {
          const key = `${cat}:${mp}`;
          if (!updated[key]) {
            // Try AI mapping first, then COA suggestion
            const aiCode = mapping[key]?.code;
            const coaCode = coaSuggestions.get(key)?.code;
            if (aiCode) {
              updated[key] = aiCode;
            } else if (coaCode) {
              updated[key] = coaCode;
            }
          }
        }
      }
    }
    setEditableMapping(updated);
    toast.success('Applied suggestions to all unmapped categories');
  };

  /** Persist exclusion settings */
  const saveExclusions = useCallback(async (keys: Set<string>, mps: Set<string>, cats?: Set<string>, ignored?: Set<string>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('app_settings').upsert(
      { user_id: user.id, key: 'coa_excluded_mappings', value: JSON.stringify({ keys: [...keys], marketplaces: [...mps], categories: cats ? [...cats] : [], ignoredMarketplaces: ignored ? [...ignored] : [] }) },
      { onConflict: 'user_id,key' }
    );
  }, []);

  const toggleExcludeMapping = useCallback((key: string) => {
    setExcludedMappings(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveExclusions(next, excludedMarketplaces, excludedCategories, ignoredMarketplaces);
      return next;
    });
  }, [excludedMarketplaces, excludedCategories, ignoredMarketplaces, saveExclusions]);

  const toggleExcludeMarketplace = useCallback((mp: string) => {
    setExcludedMarketplaces(prev => {
      const next = new Set(prev);
      if (next.has(mp)) next.delete(mp); else next.add(mp);
      saveExclusions(excludedMappings, next, excludedCategories, ignoredMarketplaces);
      return next;
    });
  }, [excludedMappings, excludedCategories, ignoredMarketplaces, saveExclusions]);

  const toggleExcludeCategory = useCallback((cat: string) => {
    setExcludedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      saveExclusions(excludedMappings, excludedMarketplaces, next, ignoredMarketplaces);
      return next;
    });
  }, [excludedMappings, excludedMarketplaces, ignoredMarketplaces, saveExclusions]);

  const toggleIgnoreMarketplace = useCallback((mp: string) => {
    setIgnoredMarketplaces(prev => {
      const next = new Set(prev);
      if (next.has(mp)) next.delete(mp); else next.add(mp);
      saveExclusions(excludedMappings, excludedMarketplaces, excludedCategories, next);
      return next;
    });
  }, [excludedMappings, excludedMarketplaces, excludedCategories, saveExclusions]);

  const getEffectiveMarketplaces = (): string[] => {
    if (activeMarketplaces.length > 0) return activeMarketplaces;
    return KNOWN_MARKETPLACES.slice(0, 3);
  };

  /**
   * Compute sync preview rows by comparing the current mapping against
   * the cached Xero COA. Returns rows with new/changed/unchanged status.
   */
  const computeSyncPreviewRows = (): SyncPreviewRow[] => {
    const rows: SyncPreviewRow[] = [];
    const seen = new Set<string>();

    // Build a name→code lookup so we can detect name-already-exists scenarios
    const coaNameToCode = new Map<string, string>();
    for (const a of coaAccounts) {
      if (a.account_name && a.account_code) {
        coaNameToCode.set(a.account_name.toLowerCase().trim(), a.account_code);
      }
    }

    const addRow = (code: string, name: string, category: string, marketplace?: string) => {
      if (!code || seen.has(code)) return;
      seen.add(code);

      const xeroEntry = coaMap.get(code);
      const accountType = getAccountTypeForCategory(category);
      const coaFull = coaAccounts.find(a => a.account_code === code);
      const taxType = coaFull?.tax_type || undefined;

      if (!xeroEntry) {
        // Code doesn't exist in Xero — but does the NAME already exist under a different code?
        const existingCode = coaNameToCode.get(name.toLowerCase().trim());
        if (existingCode && existingCode !== code) {
          // Name already exists in Xero under a different code — treat as already synced
          const existingEntry = coaMap.get(existingCode);
          rows.push({
            code: existingCode,
            name,
            type: existingEntry?.type || accountType,
            category,
            marketplace,
            status: 'unchanged',
            tax_type: coaAccounts.find(a => a.account_code === existingCode)?.tax_type || undefined,
          });
        } else {
          rows.push({ code, name, type: accountType, category, marketplace, status: 'new', tax_type: taxType });
        }
      } else if (xeroEntry.name !== name || xeroEntry.type !== accountType) {
        rows.push({
          code, name, type: accountType, category, marketplace,
          status: 'changed',
          xeroName: xeroEntry.name,
          xeroType: xeroEntry.type,
          tax_type: taxType,
        });
      } else {
        rows.push({ code, name, type: accountType, category, marketplace, status: 'unchanged', tax_type: taxType });
      }
    };

    // Base categories
    for (const cat of CATEGORIES) {
      const code = editableMapping[cat] || mapping[cat]?.code;
      if (code) {
        const coaEntry = coaMap.get(code);
        addRow(code, coaEntry?.name || mapping[cat]?.name || `${cat} AU`, cat);
      }
    }

    // Marketplace overrides (skip excluded)
    if (splitByMarketplace) {
      for (const mp of getEffectiveMarketplaces()) {
        if (excludedMarketplaces.has(mp)) continue;
        for (const cat of SPLITTABLE_CATEGORIES) {
          if (excludedCategories.has(cat)) continue;
          const key = `${cat}:${mp}`;
          if (excludedMappings.has(key)) continue;
          const code = editableMapping[key] || mapping[key]?.code;
          if (code) {
            const coaEntry = coaMap.get(code);
            const suggestion = coaSuggestions.get(key);
            addRow(code, coaEntry?.name || suggestion?.name || `${mp} ${cat}`, cat, mp);
          }
        }
      }
    }

    // Sort: new first, then changed, then unchanged
    const order: Record<string, number> = { new: 0, changed: 1, unchanged: 2 };
    rows.sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
    return rows;
  };


    const confidenceBadge = (level: string) => {
    if (level === 'medium') return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">⚠️ Medium</Badge>;
    return <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50">❌ Low</Badge>;
  };

  const validateCode = (code: string | undefined, category: string, expectedName?: string): CoaValidation => {
    if (!code || coaMap.size === 0) return 'valid';
    const entry = coaMap.get(code);
    if (!entry) {
      if (expectedName) {
        const existingCode = coaNameToCodeMap.get(expectedName.toLowerCase().trim());
        if (existingCode && existingCode !== code) return 'reuse_existing';
      }
      return 'missing';
    }
    if (!entry.active) return 'inactive';
    const isRevenue = REVENUE_CATEGORIES_SET.has(category);
    const validTypes = isRevenue ? REVENUE_ACCOUNT_TYPES : EXPENSE_ACCOUNT_TYPES;
    if (!validTypes.has(entry.type)) return 'wrong_type';
    return 'valid';
  };

  const renderValidationBadge = (code: string | undefined, category: string, expectedName?: string) => {
    if (!code || coaMap.size === 0) return null;
    const status = validateCode(code, category, expectedName);
    if (status === 'valid') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    if (status === 'reuse_existing') return (
      <span className="flex items-center gap-1 text-[10px] text-amber-600">
        <Info className="h-3.5 w-3.5 shrink-0" /> Use existing
      </span>
    );
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

  const renderStatusBadge = (code: string | undefined, category: string, expectedName?: string) => {
    if (!code) return <Badge variant="outline" className="text-destructive border-destructive/30 text-[10px]">Unmapped</Badge>;
    const status = validateCode(code, category, expectedName);
    if (status === 'valid') return <Badge variant="outline" className="text-emerald-700 border-emerald-300 text-[10px]">Mapped</Badge>;
    if (status === 'reuse_existing') return <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">Use existing</Badge>;
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

    // Sort marketplaces by their account code so rows display in numeric order (200, 201, 203…)
    const sortedMarketplaces = [...marketplaces].sort((a, b) => {
      const codeA = editableMapping[`${baseCat}:${a}`] || coaSuggestions.get(`${baseCat}:${a}`)?.code || mapping[`${baseCat}:${a}`]?.code || '';
      const codeB = editableMapping[`${baseCat}:${b}`] || coaSuggestions.get(`${baseCat}:${b}`)?.code || mapping[`${baseCat}:${b}`]?.code || '';
      const numA = parseFloat(codeA) || 9999;
      const numB = parseFloat(codeB) || 9999;
      return numA - numB;
    });

    return sortedMarketplaces.map(mp => {
      const key = `${baseCat}:${mp}`;
      const isExcluded = excludedMappings.has(key) || excludedMarketplaces.has(mp);

      // Filter by search keyword at sub-row level
      if (searchKeyword.trim()) {
        const lowerSearch = searchKeyword.toLowerCase().trim();
        const rowLabel = `${mp} ${baseCat}`.toLowerCase();
        const code = editableMapping[key] || mapping[key]?.code || coaSuggestions.get(key)?.code || '';
        const name = mapping[key]?.name || coaSuggestions.get(key)?.name || '';
        if (!rowLabel.includes(lowerSearch) && !code.toLowerCase().includes(lowerSearch) && !name.toLowerCase().includes(lowerSearch)) {
          return null;
        }
      }

      // Skip excluded rows entirely if in filter mode
      if (isExcluded) {
        return (
          <tr key={key} className="border-b last:border-b-0 bg-muted/10 opacity-40">
            <td className="p-2 pl-6">
              <div className="text-xs text-muted-foreground line-through">↳ {mp} {baseCat}</div>
            </td>
            <td className="p-2" colSpan={2}>
              <span className="text-[10px] text-muted-foreground">Excluded from mapping</span>
            </td>
            <td className="p-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 gap-0.5"
                onClick={() => {
                  if (excludedMarketplaces.has(mp)) {
                    toggleExcludeMarketplace(mp);
                  } else {
                    toggleExcludeMapping(key);
                  }
                }}
              >
                <Plus className="h-2.5 w-2.5" /> Restore
              </Button>
            </td>
          </tr>
        );
      }

      const baseCode = editableMapping[baseCat] || mapping[baseCat]?.code || '';
      const coaSuggestion = coaSuggestions.get(key); // COA-scanned suggestion
      // Auto-apply gap-fill suggestion to editable mapping if no override set yet
      if (coaSuggestion?.code && !editableMapping[key]) {
        // Use a microtask to avoid setState during render
        queueMicrotask(() => {
          setEditableMapping(prev => {
            if (prev[key]) return prev; // already set
            return { ...prev, [key]: coaSuggestion.code };
          });
        });
      }
      const overrideCode = editableMapping[key] || coaSuggestion?.code || '';
      const aiSuggestion = mapping[key]; // AI-suggested per-rail mapping
      const isGapFill = coaSuggestion?.isGapFill === true;
      const suggestion = aiSuggestion || (coaSuggestion ? { code: coaSuggestion.code, name: coaSuggestion.name } : null);
      return (
        <tr key={key} className="border-b last:border-b-0 bg-muted/20 group/row">
          <td className="p-2 pl-6">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">↳ {mp} {baseCat}</span>
              <button
                onClick={() => toggleExcludeMapping(key)}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title={`Exclude ${mp} ${baseCat} from mapping`}
              >
                <XCircle className="h-3 w-3" />
              </button>
            </div>
          </td>
          <td className="p-2">
            {suggestion?.code ? (
              <span className="text-xs">
                <span className="font-mono">{suggestion.code}</span>
                <span className="text-muted-foreground ml-1">— {suggestion.name}</span>
                {isGapFill && (
                  <Badge variant="outline" className="ml-1.5 text-[9px] border-amber-300 text-amber-700">
                    Create if missing
                  </Badge>
                )}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Fallback: <span className="font-mono">{baseCode}</span>
              </span>
            )}
          </td>
          <td className="p-2">
            {renderStatusBadge(overrideCode || baseCode, baseCat, suggestion?.name)}
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
    const expectedName = mapping[cat]?.name;
    return !code || !['valid', 'reuse_existing'].includes(validateCode(code, cat, expectedName));
  }).length;

  // Count codes that truly need creation in Xero (exclude name-clash rows that should reuse an existing code)
  const notInXeroCount = coaMap.size > 0
    ? Object.entries(editableMapping).filter(([key, code]) => {
        if (!code || coaMap.has(code)) return false;
        const expectedName = mapping[key]?.name || coaSuggestions.get(key)?.name;
        return validateCode(code, key.split(':')[0], expectedName) === 'missing';
      }).length
    : 0;

  const renderPinDialog = () => (
    <SettingsPinDialog
      open={settingsPin.showDialog}
      onVerify={settingsPin.verifyPin}
      onSuccess={settingsPin.unlock}
      onCancel={settingsPin.cancelDialog}
    />
  );

  // ─── Tax profile selector ────────────────────────────────────────
  const handleSaveTaxProfile = useCallback(async (value: string) => {
    const normalizedValue = normalizeTaxProfileValue(value);
    if (!normalizedValue) {
      toast.error('Unsupported tax profile');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setTaxProfile(normalizedValue);
    await supabase.from('app_settings').upsert(
      { user_id: user.id, key: 'tax_profile', value: normalizedValue },
      { onConflict: 'user_id,key' }
    );
    queryClient.invalidateQueries({ queryKey: ['dashboard-task-counts'] });
    toast.success(`Tax profile set to ${normalizedValue === 'AU_GST' ? 'GST Registered' : 'Not GST Registered'}`);
  }, [queryClient]);

  const renderTaxProfileSelector = () => {
    const selectedTaxProfile = normalizeTaxProfileValue(taxProfile);

    return (
      <div id="tax-profile-selector" className="flex items-center gap-3 bg-muted/30 rounded-md px-3 py-2.5 border border-border/50">
        <div className="flex-1">
          <div className="text-sm font-medium">Tax profile</div>
          <div className="text-xs text-muted-foreground">Set your organisation's GST registration status</div>
        </div>
        <Select value={selectedTaxProfile ?? undefined} onValueChange={handleSaveTaxProfile}>
          <SelectTrigger className="w-[200px] h-8 text-xs">
            <SelectValue placeholder="Select tax profile…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AU_GST">GST Registered (AU)</SelectItem>
            <SelectItem value="EXPORT_NO_GST">Not GST Registered</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  };


  // ─── Shared COA refresh strip ──────────────────────────────────────
  const renderCoaRefreshStrip = () => {
    const lastSyncedLabel = formatLastSyncedLabel(coaLastSynced);

    return (
      <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
        <div className="flex items-center gap-2">
          <span>
            {coaAccounts.length > 0
              ? `${coaAccounts.length} Xero accounts cached`
              : 'No Xero accounts cached'}
          </span>
          {lastSyncedLabel && (
            <span className="text-[10px]">
              · Last refreshed {lastSyncedLabel}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefreshCoa} disabled={refreshingCoa} className="h-6 text-xs gap-1">
          {refreshingCoa ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh from Xero
        </Button>
      </div>
    );
  };

  // ─── UNMAPPED STATE ──────────────────────────────────────────────
  if (state === 'unmapped') {
    return (
      <>
      {renderPinDialog()}
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
          {renderTaxProfileSelector()}
          {renderCoaRefreshStrip()}
          <Button onClick={runMapper} className="gap-2">
            <Sparkles className="h-4 w-4" />
            Auto-detect accounts
          </Button>
        </CardContent>
      </Card>
      </>
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
    const lowerSearch = searchKeyword.toLowerCase().trim();
    const categoriesToShow = CATEGORIES.filter(cat => {
      if (showOnlyMissing) {
        const code = editableMapping[cat] || mapping[cat]?.code;
        if (code && validateCode(code, cat) === 'valid') return false;
      }
      if (lowerSearch) {
        // Match on category name, description, or any marketplace sub-row label/code/name
        const catMatch = cat.toLowerCase().includes(lowerSearch) ||
          (CATEGORY_DESCRIPTIONS[cat] || '').toLowerCase().includes(lowerSearch);
        if (catMatch) return true;
        // Check marketplace overrides
        if (splitByMarketplace) {
          for (const mp of getEffectiveMarketplaces()) {
            const key = `${cat}:${mp}`;
            const rowLabel = `${mp} ${cat}`.toLowerCase();
            const code = editableMapping[key] || mapping[key]?.code || coaSuggestions.get(key)?.code || '';
            const name = mapping[key]?.name || coaSuggestions.get(key)?.name || '';
            if (rowLabel.includes(lowerSearch) || code.toLowerCase().includes(lowerSearch) || name.toLowerCase().includes(lowerSearch)) return true;
          }
        }
        return false;
      }
      return true;
    });

    return (
      <>
      {renderPinDialog()}
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
          {renderTaxProfileSelector()}
          {renderCoaRefreshStrip()}
          {isAdmin && coaAccounts.length > 0 && <CoaAuditPanel />}
          {renderCloneBanner()}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by keyword (e.g. Catch, FBA, Advertising, 321…)"
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
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

          {/* Split by marketplace toggle & filters */}
          {getEffectiveMarketplaces().length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2">
                <Switch
                  id="split-marketplace"
                  checked={splitByMarketplace}
                  onCheckedChange={handleSplitToggle}
                />
                <Label htmlFor="split-marketplace" className="text-xs text-muted-foreground cursor-pointer">
                  Split by marketplace — map each category per channel (Sales, Fees, Refunds, etc.)
                </Label>
              </div>

              {splitByMarketplace && (
                <div className="rounded-lg border border-border/50 px-3 py-2.5 space-y-3">
                  {/* Marketplace filter */}
                  {getEffectiveMarketplaces().length > 1 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium flex items-center gap-1.5">
                          <Filter className="h-3 w-3" />
                          Filter marketplaces
                        </Label>
                        {excludedMarketplaces.size > 0 && (
                          <button
                            onClick={() => {
                              setExcludedMarketplaces(new Set());
                              saveExclusions(excludedMappings, new Set(), excludedCategories, ignoredMarketplaces);
                            }}
                            className="text-[10px] text-primary hover:underline"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {getEffectiveMarketplaces().map(mp => {
                          const isExcluded = excludedMarketplaces.has(mp);
                          return (
                            <button
                              key={mp}
                              onClick={() => toggleExcludeMarketplace(mp)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] border transition-colors ${
                                isExcluded
                                  ? 'bg-destructive/10 border-destructive/30 text-destructive line-through'
                                  : 'bg-background border-border text-foreground hover:bg-accent'
                              }`}
                            >
                              {isExcluded ? <XCircle className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
                              {mp}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category filter */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Filter className="h-3 w-3" />
                        Filter categories
                      </Label>
                      {excludedCategories.size > 0 && (
                        <button
                          onClick={() => {
                            setExcludedCategories(new Set());
                            saveExclusions(excludedMappings, excludedMarketplaces, new Set(), ignoredMarketplaces);
                          }}
                          className="text-[10px] text-primary hover:underline"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIES.map(cat => {
                        const isExcluded = excludedCategories.has(cat);
                        return (
                          <button
                            key={cat}
                            onClick={() => toggleExcludeCategory(cat)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] border transition-colors ${
                              isExcluded
                                ? 'bg-destructive/10 border-destructive/30 text-destructive line-through'
                                : 'bg-background border-border text-foreground hover:bg-accent'
                            }`}
                          >
                            {isExcluded ? <XCircle className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Ignored marketplaces (site-wide) */}
                  {ignoredMarketplaces.size > 0 && (
                    <div className="space-y-1.5 border-t pt-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium flex items-center gap-1.5">
                          <XCircle className="h-3 w-3" />
                          Ignored marketplaces (hidden site-wide)
                        </Label>
                        <button
                          onClick={() => {
                            setIgnoredMarketplaces(new Set());
                            saveExclusions(excludedMappings, excludedMarketplaces, excludedCategories, new Set());
                          }}
                          className="text-[10px] text-primary hover:underline"
                        >
                          Restore all
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[...ignoredMarketplaces].map(mp => (
                          <button
                            key={mp}
                            onClick={() => toggleIgnoreMarketplace(mp)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] border bg-muted/50 border-border text-muted-foreground hover:bg-accent transition-colors"
                          >
                            <XCircle className="h-2.5 w-2.5" />
                            {mp}
                            <span className="text-primary ml-0.5">restore</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(excludedMarketplaces.size > 0 || excludedCategories.size > 0) && (
                    <p className="text-[10px] text-muted-foreground">
                      {excludedMarketplaces.size > 0 && `${excludedMarketplaces.size} marketplace${excludedMarketplaces.size > 1 ? 's' : ''} excluded`}
                      {excludedMarketplaces.size > 0 && excludedCategories.size > 0 && ', '}
                      {excludedCategories.size > 0 && `${excludedCategories.size} categor${excludedCategories.size > 1 ? 'ies' : 'y'} excluded`}
                      {' — excluded items won\'t be included in Xero sync.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

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
                {categoriesToShow.length === 0 && showOnlyMissing ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-sm text-muted-foreground">
                      <div className="flex flex-col items-center gap-1">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span>All base categories mapped</span>
                        <button
                          onClick={() => setShowOnlyMissing(false)}
                          className="text-xs text-primary underline underline-offset-2 hover:text-primary/80"
                        >
                          Show all categories
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  categoriesToShow.map((cat) => {
                    const entry = mapping[cat];
                    const currentCode = editableMapping[cat] || entry?.code || '';
                    const isSplittable = (SPLITTABLE_CATEGORIES as readonly string[]).includes(cat);
                    return (
                      <React.Fragment key={cat}>
                        {excludedCategories.has(cat) ? (
                          <tr className="border-b last:border-b-0 bg-muted/10 opacity-40">
                            <td className="p-2">
                              <div className="font-medium line-through">{cat}</div>
                              <div className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</div>
                            </td>
                            <td className="p-2" colSpan={2}>
                              <span className="text-[10px] text-muted-foreground">Entire category excluded</span>
                            </td>
                            <td className="p-2">
                              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 gap-0.5" onClick={() => toggleExcludeCategory(cat)}>
                                <Plus className="h-2.5 w-2.5" /> Restore
                              </Button>
                            </td>
                          </tr>
                        ) : (
                          <>
                            <tr className="border-b last:border-b-0">
                              <td className="p-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium">{cat}</span>
                                  {splitByMarketplace && isSplittable && (
                                    <button
                                      onClick={() => toggleExcludeCategory(cat)}
                                      className="text-muted-foreground hover:text-destructive transition-colors"
                                      title={`Exclude all ${cat} rows`}
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
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
                                {renderStatusBadge(currentCode, cat, entry?.name)}
                              </td>
                              <td className="p-2">
                                {renderAccountSelector(cat, cat)}
                              </td>
                            </tr>
                            {isSplittable && renderMarketplaceOverrides(cat)}
                          </>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Filter panel moved above table */}

          {notes && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{notes}</p>
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-center">
            <Button variant="outline" onClick={handleSaveDraft} className="gap-2">
              <Save className="h-4 w-4" />
              Save Draft
            </Button>
            <Button onClick={handleConfirm} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Confirm Mapping
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { const scrollY = window.scrollY; runMapper().then(() => window.scrollTo(0, scrollY)); }} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Re-run
            </Button>
          </div>

          {notInXeroCount > 0 && coaAccounts.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-xs text-amber-800 dark:text-amber-200 flex-1">
                {notInXeroCount} account code{notInXeroCount > 1 ? 's are' : ' is'} genuinely missing in Xero and can be created automatically. Name clashes or wrong-type accounts need you to pick the existing account instead.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 border-amber-300 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
                onClick={async () => {
                  toast.info('Refreshing COA from Xero…');
                  const result = await refreshXeroCOA();
                  if (!result.success) { toast.error(`COA refresh failed: ${result.error}`); return; }
                  const [freshAccounts, freshSynced] = await Promise.all([getCachedXeroAccounts(), getCoaLastSyncedAt()]);
                  setCoaAccounts(freshAccounts);
                  setCoaLastSynced(freshSynced);
                  setSyncModalOpen(true);
                }}
              >
                <Upload className="h-3 w-3" />
                Create in Xero
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            <strong>Save Draft</strong> saves locally without locking. <strong>Confirm Mapping</strong> verifies all codes exist in Xero, then locks them for future pushes. This only changes Xettle's internal routing — your Xero accounts are not modified.
          </p>
        </CardContent>
      </Card>
      {renderCloneDialog()}
      {renderOverwriteConfirmDialog()}
      {syncModalOpen && (
        <XeroCoaSyncModal
          open={syncModalOpen}
          onOpenChange={setSyncModalOpen}
          previewRows={computeSyncPreviewRows()}
          coaAccounts={coaAccounts}
          onSyncComplete={async () => {
            await refreshXeroCOA();
            const [accounts, lastSynced] = await Promise.all([getCachedXeroAccounts(), getCoaLastSyncedAt()]);
            setCoaAccounts(accounts);
            setCoaLastSynced(lastSynced);
            queryClient.invalidateQueries({ queryKey: ['dashboard-task-counts'] });
          }}
        />
      )}
      </>
    );
  }

  // ─── CONFIRMED STATE ─────────────────────────────────────────────
  const marketplaceOverrideKeys = Object.keys(mapping).filter(k => k.includes(':'));

  return (
    <>
    {renderPinDialog()}
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
        {isAdmin && coaAccounts.length > 0 && <CoaAuditPanel />}
        {renderCloneBanner()}

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
                  {renderValidationBadge(code, cat, entry?.name)}
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
                      {renderValidationBadge(code, cat || 'Sales', mapping[key]?.name)}
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
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setState('review')} className="gap-2">
            <Search className="h-3 w-3" />
            Edit mappings
          </Button>
          <Button variant="outline" size="sm" onClick={() => { const scrollY = window.scrollY; runMapper().then(() => window.scrollTo(0, scrollY)); }} className="gap-2">
            <RefreshCw className="h-3 w-3" />
            Re-run AI mapper
          </Button>
          {coaAccounts.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={async () => {
                toast.info('Refreshing COA from Xero…');
                const result = await refreshXeroCOA();
                if (!result.success) {
                  toast.error(`COA refresh failed: ${result.error}`);
                  return;
                }
                const [freshAccounts, freshSynced] = await Promise.all([
                  getCachedXeroAccounts(),
                  getCoaLastSyncedAt(),
                ]);
                setCoaAccounts(freshAccounts);
                setCoaLastSynced(freshSynced);
                setSyncModalOpen(true);
              }}
            >
              <Upload className="h-3 w-3" />
              Sync Accounts to Xero
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
    {renderCloneDialog()}
    {renderOverwriteConfirmDialog()}
    <XeroCoaSyncModal
      open={syncModalOpen}
      onOpenChange={setSyncModalOpen}
      previewRows={computeSyncPreviewRows()}
      coaAccounts={coaAccounts}
      onSyncComplete={async () => {
        await refreshXeroCOA();
        const [accounts, lastSynced] = await Promise.all([
          getCachedXeroAccounts(),
          getCoaLastSyncedAt(),
        ]);
        setCoaAccounts(accounts);
        setCoaLastSynced(lastSynced);
        queryClient.invalidateQueries({ queryKey: ['dashboard-task-counts'] });
      }}
    />
    </>
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

  // Suggest next available code via centralized policy (no ad-hoc generation)
  const suggestNextCode = (): string => {
    return generateNextCode({
      existingCodes,
      accountType: suggestedType,
    });
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
