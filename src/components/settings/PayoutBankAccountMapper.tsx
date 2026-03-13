/**
 * PayoutBankAccountMapper — Maps settlement rails → Xero destination accounts for deposit matching.
 * Each rail can use the default destination account or an explicit override.
 * 
 * Reads payout_destination:* first, falls back to legacy payout_account:* on load.
 * Saves only payout_destination:* keys.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AlertTriangle, Banknote, CheckCircle2, HelpCircle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  PHASE_1_RAILS,
  DESTINATION_KEY_PREFIX,
  DESTINATION_DEFAULT_KEY,
  LEGACY_KEY_PREFIX,
  LEGACY_DEFAULT_KEY,
  toRailCode,
} from '@/constants/settlement-rails';

interface XeroBankAccount {
  account_id: string;
  name: string;
  currency_code: string;
}

export default function PayoutBankAccountMapper() {
  const [accounts, setAccounts] = useState<XeroBankAccount[]>([]);
  const [rails, setRails] = useState<Array<{ code: string; label: string }>>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string>('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [useDefault, setUseDefault] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingAccounts, setFetchingAccounts] = useState(false);
  const [invalidAccounts, setInvalidAccounts] = useState<Set<string>>(new Set());
  const [loadIssue, setLoadIssue] = useState<string>('');
  const [isRateLimited, setIsRateLimited] = useState(false);

  const applyFetchIssue = useCallback((issue?: string | null) => {
    const message = issue || '';
    setLoadIssue(message);
    setIsRateLimited(message.includes('429') || message.toLowerCase().includes('rate limit'));
  }, []);

  // Fetch Xero bank accounts + existing mappings + marketplace connections
  const loadData = useCallback(async () => {
    setLoading(true);
    applyFetchIssue('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        applyFetchIssue('Session not ready. Please sign in again and retry.');
        return;
      }

      // Parallel fetch: bank accounts, new destination settings, legacy settings, marketplace connections
      const [accountsResp, destSettingsResp, legacySettingsResp, connectionsResp] = await Promise.all([
        supabase.functions.invoke('fetch-xero-bank-accounts'),
        supabase.from('app_settings').select('key, value').like('key', `${DESTINATION_KEY_PREFIX}%`),
        supabase.from('app_settings').select('key, value').like('key', `${LEGACY_KEY_PREFIX}%`),
        supabase.from('marketplace_connections').select('marketplace_code, marketplace_name').eq('connection_status', 'active'),
      ]);

      // Bank accounts
      const payload = (accountsResp.data || {}) as {
        accounts?: XeroBankAccount[];
        error?: string;
        warning?: string;
      };
      const fetchedAccounts: XeroBankAccount[] = payload.accounts || [];
      setAccounts(fetchedAccounts);

      const issue = accountsResp.error?.message || payload.error || payload.warning || '';
      applyFetchIssue(issue);

      if (payload.warning && fetchedAccounts.length > 0) {
        toast.warning('Using cached bank accounts while Xero rate limits requests');
      }

      const validIds = new Set(fetchedAccounts.map(a => a.account_id));

      // Build new-first / legacy-fallback mappings
      const destSettings = destSettingsResp.data || [];
      const legacySettings = legacySettingsResp.data || [];

      // Index new keys
      const newMap = new Map<string, string>();
      for (const row of destSettings) {
        newMap.set(row.key, row.value || '');
      }

      // Index legacy keys (normalised to rail codes)
      const legacyMap = new Map<string, string>();
      for (const row of legacySettings) {
        if (row.key === LEGACY_DEFAULT_KEY) {
          legacyMap.set('_default', row.value || '');
        } else if (row.key.startsWith(LEGACY_KEY_PREFIX)) {
          const rawCode = row.key.slice(LEGACY_KEY_PREFIX.length);
          legacyMap.set(toRailCode(rawCode), row.value || '');
        }
      }

      // Resolve default
      let defaultVal = newMap.get(DESTINATION_DEFAULT_KEY) || '';
      if (!defaultVal && legacyMap.has('_default')) {
        defaultVal = legacyMap.get('_default') || '';
      }

      // Resolve per-rail overrides
      const overrideMap: Record<string, string> = {};
      const invalid = new Set<string>();

      if (defaultVal && !validIds.has(defaultVal)) invalid.add('_default');

      // Check all rails for overrides (new keys first, legacy fallback)
      for (const rail of PHASE_1_RAILS) {
        const newKey = `${DESTINATION_KEY_PREFIX}${rail.code}`;
        const newVal = newMap.get(newKey);
        if (newVal) {
          overrideMap[rail.code] = newVal;
          if (!validIds.has(newVal)) invalid.add(rail.code);
        } else if (legacyMap.has(rail.code)) {
          const legVal = legacyMap.get(rail.code) || '';
          if (legVal) {
            overrideMap[rail.code] = legVal;
            if (!validIds.has(legVal)) invalid.add(rail.code);
          }
        }
      }

      setDefaultAccountId(defaultVal);
      setOverrides(overrideMap);
      setInvalidAccounts(invalid);

      // Build rail list: canonical rails + any connected marketplaces not already in the list
      const connections = connectionsResp.data || [];
      const canonicalCodes = new Set(PHASE_1_RAILS.map(r => r.code));
      const extraRails: Array<{ code: string; label: string }> = [];
      for (const c of connections) {
        const railCode = toRailCode(c.marketplace_code);
        if (!canonicalCodes.has(railCode as any)) {
          extraRails.push({ code: railCode, label: c.marketplace_name });
        }
      }
      const allRails = [...PHASE_1_RAILS, ...extraRails];
      setRails(allRails);

      // Set useDefault for rails without explicit override
      const finalUseDefault: Record<string, boolean> = {};
      for (const rail of allRails) {
        finalUseDefault[rail.code] = !(rail.code in overrideMap);
      }
      setUseDefault(finalUseDefault);

    } catch (err: any) {
      const message = err?.message || 'Failed to load destination account settings';
      applyFetchIssue(message);
      toast.error(`Failed to load destination account settings: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [applyFetchIssue]);

  useEffect(() => { loadData(); }, [loadData]);

  const refreshAccounts = useCallback(async () => {
    setFetchingAccounts(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        applyFetchIssue('Session not ready. Please sign in again and retry.');
        return;
      }
      const resp = await supabase.functions.invoke('fetch-xero-bank-accounts');

      const payload = (resp.data || {}) as {
        accounts?: XeroBankAccount[];
        error?: string;
        warning?: string;
      };
      const fetchedAccounts: XeroBankAccount[] = payload.accounts || [];
      setAccounts(fetchedAccounts);

      const issue = resp.error?.message || payload.error || payload.warning || '';
      applyFetchIssue(issue);

      // Re-validate existing mappings
      const validIds = new Set(fetchedAccounts.map(a => a.account_id));
      const invalid = new Set<string>();
      if (defaultAccountId && !validIds.has(defaultAccountId)) invalid.add('_default');
      for (const [code, id] of Object.entries(overrides)) {
        if (id && !validIds.has(id)) invalid.add(code);
      }
      setInvalidAccounts(invalid);

      if (payload.warning && fetchedAccounts.length > 0) {
        toast.warning('Using cached bank accounts while Xero rate limits requests');
      } else if (issue) {
        toast.error(issue);
      } else {
        toast.success(`Found ${fetchedAccounts.length} bank accounts`);
      }
    } catch (err: any) {
      const message = err?.message || 'Failed to refresh bank accounts';
      applyFetchIssue(message);
      toast.error(message);
    } finally {
      setFetchingAccounts(false);
    }
  }, [defaultAccountId, overrides, applyFetchIssue]);

  const saveMappings = useCallback(async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build upsert rows — save ONLY payout_destination:* keys
      const rows: Array<{ user_id: string; key: string; value: string }> = [];

      // Default
      if (defaultAccountId) {
        rows.push({ user_id: user.id, key: DESTINATION_DEFAULT_KEY, value: defaultAccountId });
      }

      // Per-rail overrides (only save explicit overrides, not "use default" ones)
      for (const rail of rails) {
        if (!useDefault[rail.code] && overrides[rail.code]) {
          rows.push({
            user_id: user.id,
            key: `${DESTINATION_KEY_PREFIX}${rail.code}`,
            value: overrides[rail.code],
          });
        }
      }

      // Delete overrides that switched back to "use default"
      const keysToDelete: string[] = [];
      for (const rail of rails) {
        if (useDefault[rail.code]) {
          keysToDelete.push(`${DESTINATION_KEY_PREFIX}${rail.code}`);
        }
      }

      if (keysToDelete.length > 0) {
        await supabase.from('app_settings')
          .delete()
          .eq('user_id', user.id)
          .in('key', keysToDelete);
      }

      // Upsert all mappings
      if (rows.length > 0) {
        const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'user_id,key' });
        if (error) throw error;
      }

      toast.success('Destination account mappings saved');

      // Trigger bank feed sync in the background
      try {
        toast.info('Syncing bank feed…', { id: 'bank-sync' });
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          const syncResp = await supabase.functions.invoke('fetch-xero-bank-transactions', {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'x-action': 'self',
            },
            body: { action: 'self' },
          });
          if (syncResp.error) {
            toast.error(`Bank feed sync failed: ${syncResp.error.message}`, { id: 'bank-sync' });
          } else if (syncResp.data?.skipped) {
            toast.info('Bank feed already up to date', { id: 'bank-sync' });
            window.dispatchEvent(new Event('xettle:refresh-outstanding'));
          } else {
            const count = syncResp.data?.bank_rows_upserted || syncResp.data?.upserted || 0;
            toast.success(`Bank feed synced — ${count} transaction${count !== 1 ? 's' : ''} cached`, { id: 'bank-sync' });
            window.dispatchEvent(new Event('xettle:refresh-outstanding'));
          }
        }
      } catch (syncErr: any) {
        toast.error(`Bank feed sync failed: ${syncErr.message}`, { id: 'bank-sync' });
      }
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [defaultAccountId, overrides, useDefault, rails]);

  const getAccountLabel = (id: string) => {
    const acc = accounts.find(a => a.account_id === id);
    return acc ? `${acc.name} (${acc.currency_code})` : 'Unknown account';
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Loading destination accounts…</span>
        </CardContent>
      </Card>
    );
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="h-4 w-4" />
            Destination Accounts
          </CardTitle>
          <CardDescription>
            {isRateLimited
              ? 'Xero is rate-limiting requests right now. Please wait a minute, then retry.'
              : loadIssue || 'Connect Xero to see your bank accounts.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" size="sm" onClick={refreshAccounts} disabled={fetchingAccounts}>
            {fetchingAccounts ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Retry
          </Button>
          {loadIssue && !isRateLimited && (
            <p className="text-xs text-muted-foreground">Tip: reconnect Xero in Settings if this keeps happening.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4" />
              Settlement Rail → Destination Account
            </CardTitle>
            <CardDescription>
              Select which bank or clearing account each settlement rail pays into. This controls which deposits are matched during reconciliation.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={refreshAccounts} disabled={fetchingAccounts}>
            {fetchingAccounts ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Default destination account */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Default destination account</Label>
          <Select value={defaultAccountId} onValueChange={setDefaultAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Select default destination account…" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(acc => (
                <SelectItem key={acc.account_id} value={acc.account_id}>
                  {acc.name}
                  <Badge variant="outline" className="ml-2 text-xs">{acc.currency_code}</Badge>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {invalidAccounts.has('_default') && (
            <div className="flex items-center gap-1 text-sm text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Selected account no longer exists in Xero
            </div>
          )}
        </div>

        {/* Per-rail overrides */}
        {rails.length > 0 && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Rail overrides</Label>
            {rails.map(rail => {
              const isUsingDefault = useDefault[rail.code] !== false;
              const currentOverride = overrides[rail.code] || '';
              const isInvalid = invalidAccounts.has(rail.code);

              return (
                <div key={rail.code} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{rail.label}</span>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`default-${rail.code}`} className="text-xs text-muted-foreground">
                        Use default
                      </Label>
                      <Switch
                        id={`default-${rail.code}`}
                        checked={isUsingDefault}
                        onCheckedChange={(checked) => {
                          setUseDefault(prev => ({ ...prev, [rail.code]: checked }));
                        }}
                      />
                    </div>
                  </div>

                  {isUsingDefault ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {defaultAccountId ? `Using: ${getAccountLabel(defaultAccountId)}` : 'No default set'}
                    </div>
                  ) : (
                    <>
                      <Select
                        value={currentOverride}
                        onValueChange={(val) => setOverrides(prev => ({ ...prev, [rail.code]: val }))}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select destination account…" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map(acc => (
                            <SelectItem key={acc.account_id} value={acc.account_id}>
                              {acc.name}
                              <Badge variant="outline" className="ml-2 text-xs">{acc.currency_code}</Badge>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isInvalid && (
                        <div className="flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          Selected account no longer exists in Xero
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Help accordion */}
        <Accordion type="single" collapsible>
          <AccordionItem value="help">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-1">
                <HelpCircle className="h-3.5 w-3.5" />
                What is a settlement rail?
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>A <strong>settlement rail</strong> is the payment path a marketplace uses to send you money.</p>
                <p>The <strong>destination account</strong> is the Xero bank account (or PayPal, Wise, clearing account) where those funds land.</p>
                <p>For example, Amazon AU might deposit into your main bank account, while Shopify Payments goes to a separate PayPal account. Set each rail to point at the right destination so reconciliation knows where to look.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Save button */}
        <Button onClick={saveMappings} disabled={saving || !defaultAccountId} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Save destination mappings
        </Button>
      </CardContent>
    </Card>
  );
}
