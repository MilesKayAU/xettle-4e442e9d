/**
 * PayoutBankAccountMapper — Maps marketplace → Xero bank account for deposit matching.
 * Each marketplace can use the default payout account or an explicit override.
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

interface XeroBankAccount {
  account_id: string;
  name: string;
  currency_code: string;
}

interface MarketplaceConnection {
  marketplace_code: string;
  marketplace_name: string;
}

const PAYOUT_KEY_PREFIX = 'payout_account:';
const DEFAULT_KEY = 'payout_account:_default';

export default function PayoutBankAccountMapper() {
  const [accounts, setAccounts] = useState<XeroBankAccount[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceConnection[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<string>('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [useDefault, setUseDefault] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingAccounts, setFetchingAccounts] = useState(false);
  const [invalidAccounts, setInvalidAccounts] = useState<Set<string>>(new Set());
  const [loadIssue, setLoadIssue] = useState<string>('');
  const [isRateLimited, setIsRateLimited] = useState(false);

  const applyFetchIssue = (issue?: string | null) => {
    const message = issue || '';
    setLoadIssue(message);
    setIsRateLimited(message.includes('429') || message.toLowerCase().includes('rate limit'));
  };

  // Fetch Xero bank accounts + existing mappings + marketplace connections
  const loadData = useCallback(async () => {
    setLoading(true);
    applyFetchIssue('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      // Parallel fetch: bank accounts, settings, marketplace connections
      const [accountsResp, settingsResp, connectionsResp] = await Promise.all([
        supabase.functions.invoke('fetch-xero-bank-accounts', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        supabase.from('app_settings').select('key, value').like('key', 'payout_account:%'),
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

      // Existing mappings
      const settings = settingsResp.data || [];
      let defaultVal = '';
      const overrideMap: Record<string, string> = {};
      const invalid = new Set<string>();

      for (const row of settings) {
        const val = row.value || '';
        if (row.key === DEFAULT_KEY) {
          defaultVal = val;
          if (val && !validIds.has(val)) invalid.add('_default');
        } else if (row.key.startsWith(PAYOUT_KEY_PREFIX)) {
          const mktCode = row.key.slice(PAYOUT_KEY_PREFIX.length);
          if (mktCode !== '_default') {
            overrideMap[mktCode] = val;
            if (val && !validIds.has(val)) invalid.add(mktCode);
          }
        }
      }

      setDefaultAccountId(defaultVal);
      setOverrides(overrideMap);
      setInvalidAccounts(invalid);

      // Marketplace connections
      const connections: MarketplaceConnection[] = connectionsResp.data || [];
      setMarketplaces(connections);

      // Set useDefault for marketplaces without explicit override
      const finalUseDefault: Record<string, boolean> = {};
      for (const c of connections) {
        finalUseDefault[c.marketplace_code] = !(c.marketplace_code in overrideMap);
      }
      setUseDefault(finalUseDefault);

    } catch (err: any) {
      const message = err?.message || 'Failed to load bank account settings';
      applyFetchIssue(message);
      toast.error(`Failed to load bank account settings: ${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const refreshAccounts = useCallback(async () => {
    setFetchingAccounts(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const resp = await supabase.functions.invoke('fetch-xero-bank-accounts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

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
  }, [defaultAccountId, overrides]);

  const saveMappings = useCallback(async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Build upsert rows
      const rows: Array<{ user_id: string; key: string; value: string }> = [];

      // Default
      if (defaultAccountId) {
        rows.push({ user_id: user.id, key: DEFAULT_KEY, value: defaultAccountId });
      }

      // Per-marketplace overrides (only save explicit overrides, not "use default" ones)
      for (const mkt of marketplaces) {
        if (!useDefault[mkt.marketplace_code] && overrides[mkt.marketplace_code]) {
          rows.push({
            user_id: user.id,
            key: `${PAYOUT_KEY_PREFIX}${mkt.marketplace_code}`,
            value: overrides[mkt.marketplace_code],
          });
        }
      }

      // Delete overrides that switched back to "use default"
      const keysToDelete: string[] = [];
      for (const mkt of marketplaces) {
        if (useDefault[mkt.marketplace_code]) {
          keysToDelete.push(`${PAYOUT_KEY_PREFIX}${mkt.marketplace_code}`);
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

      toast.success('Payout account mappings saved');
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [defaultAccountId, overrides, useDefault, marketplaces]);

  const getAccountLabel = (id: string) => {
    const acc = accounts.find(a => a.account_id === id);
    return acc ? `${acc.name} (${acc.currency_code})` : 'Unknown account';
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Loading bank accounts…</span>
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
            Payout Bank Accounts
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
              Payout Bank Accounts
            </CardTitle>
            <CardDescription>
              Select which bank account each marketplace pays into. This controls which deposits are matched.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={refreshAccounts} disabled={fetchingAccounts}>
            {fetchingAccounts ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Default payout account */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Default payout account</Label>
          <Select value={defaultAccountId} onValueChange={setDefaultAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Select default bank account…" />
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
              Selected bank account no longer exists in Xero
            </div>
          )}
        </div>

        {/* Per-marketplace overrides */}
        {marketplaces.length > 0 && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Marketplace overrides</Label>
            {marketplaces.map(mkt => {
              const isUsingDefault = useDefault[mkt.marketplace_code] !== false;
              const currentOverride = overrides[mkt.marketplace_code] || '';
              const isInvalid = invalidAccounts.has(mkt.marketplace_code);

              return (
                <div key={mkt.marketplace_code} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{mkt.marketplace_name}</span>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`default-${mkt.marketplace_code}`} className="text-xs text-muted-foreground">
                        Use default
                      </Label>
                      <Switch
                        id={`default-${mkt.marketplace_code}`}
                        checked={isUsingDefault}
                        onCheckedChange={(checked) => {
                          setUseDefault(prev => ({ ...prev, [mkt.marketplace_code]: checked }));
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
                        onValueChange={(val) => setOverrides(prev => ({ ...prev, [mkt.marketplace_code]: val }))}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select bank account…" />
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
                          Selected bank account no longer exists in Xero
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
                How do I find this in Xero?
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>In Xero, go to <strong>Accounting → Bank accounts</strong>.</p>
                <p>The account you reconcile Amazon/Shopify/marketplace deposits in is the one to select here.</p>
                <p>If Amazon deposits go to your main bank and Shopify goes to PayPal, select different accounts for each marketplace.</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Save button */}
        <Button onClick={saveMappings} disabled={saving || !defaultAccountId} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Save payout account mappings
        </Button>
      </CardContent>
    </Card>
  );
}
