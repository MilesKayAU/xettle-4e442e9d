/**
 * RailPostingSettings — Per-rail auto-post configuration UI.
 *
 * Scoped by user_id (acting as org proxy — one user = one org).
 * This is an org-level accounting workflow setting, not a personal preference.
 * When multi-user orgs are added, this will be scoped by org_id.
 *
 * Shows each connected marketplace rail with:
 *   - support tier badge (Supported / Experimental / Unsupported)
 *   - manual/auto toggle (gated by tier)
 *   - bank match checkbox
 *   - Draft vs Authorised invoice status selector (gated by tier)
 *   - Tax mode selector
 *   - Auto-repost after rollback toggle (advanced)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAiPageContext } from '@/ai/context/useAiPageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Zap, Shield, AlertTriangle, RefreshCw, ChevronDown, FileCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PHASE_1_RAILS, isBankMatchRequired } from '@/constants/settlement-rails';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { computeSupportTier, getAutomationEligibility, type TaxMode, type TaxProfile } from '@/policy/supportPolicy';
import { getOrgTaxProfile, acknowledgeRailSupport } from '@/actions/scopeConsent';
import SupportTierBadge from '@/components/shared/SupportTierBadge';

interface RailSetting {
  rail: string;
  posting_mode: 'manual' | 'auto';
  require_bank_match: boolean;
  auto_post_enabled_at: string | null;
  invoice_status: 'DRAFT' | 'AUTHORISED';
  auto_repost_after_rollback: boolean;
  tax_mode: TaxMode;
  support_acknowledged_at: string | null;
}

interface FailedSettlement {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  bank_deposit: number | null;
  posting_error: string | null;
}

export default function RailPostingSettings() {
  const [settings, setSettings] = useState<Map<string, RailSetting>>(new Map());
  const [connectedRails, setConnectedRails] = useState<string[]>([]);
  const [failedSettlements, setFailedSettlements] = useState<FailedSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmRail, setConfirmRail] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [taxProfile, setTaxProfile] = useState<TaxProfile>('AU_GST');

  useAiPageContext(() => {
    const railSummary = connectedRails.map(rail => {
      const s = settings.get(rail);
      return {
        rail,
        posting_mode: s?.posting_mode ?? 'manual',
        invoice_status: s?.invoice_status ?? 'DRAFT',
        tax_mode: s?.tax_mode ?? 'AU_GST_STANDARD',
        require_bank_match: s?.require_bank_match ?? true,
      };
    });
    return {
      routeId: 'rail_posting_settings',
      pageTitle: 'Rail Posting Settings',
      primaryEntities: { rails: connectedRails },
      pageStateSummary: {
        connected_rail_count: connectedRails.length,
        auto_rails: railSummary.filter(r => r.posting_mode === 'auto').length,
        manual_rails: railSummary.filter(r => r.posting_mode === 'manual').length,
        failed_settlement_count: failedSettlements.length,
        tax_profile: taxProfile,
        rail_settings: railSummary.slice(0, 10),
      },
      capabilities: ['toggle_auto_post', 'retry_failed'],
    };
  });

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, connectionsRes, failedRes, orgTaxProfile] = await Promise.all([
        supabase.from('rail_posting_settings').select('*'),
        supabase.from('marketplace_connections').select('marketplace_code').neq('connection_status', 'suggested'),
        supabase.from('settlements')
          .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, posting_error')
          .eq('posting_state', 'failed')
          .eq('is_hidden', false)
          .order('period_start', { ascending: false }),
        getOrgTaxProfile(),
      ]);

      setTaxProfile(orgTaxProfile);

      if (settingsRes.data) {
        const map = new Map<string, RailSetting>();
        for (const s of settingsRes.data) {
          map.set(s.rail, {
            rail: s.rail,
            posting_mode: s.posting_mode as 'manual' | 'auto',
            require_bank_match: s.require_bank_match,
            auto_post_enabled_at: s.auto_post_enabled_at,
            invoice_status: s.invoice_status === 'AUTHORISED' ? 'AUTHORISED' : 'DRAFT',
            auto_repost_after_rollback: s.auto_repost_after_rollback ?? false,
            tax_mode: ((s as any).tax_mode as TaxMode) || 'AU_GST_STANDARD',
            support_acknowledged_at: (s as any).support_acknowledged_at || null,
          });
        }
        setSettings(map);
      }

      if (connectionsRes.data) {
        setConnectedRails(connectionsRes.data.map((c: any) => c.marketplace_code));
      }

      if (failedRes.data) {
        setFailedSettlements(failedRes.data as FailedSettlement[]);
      }
    } catch (err) {
      console.error('Failed to load rail settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const getSettingForRail = (rail: string): RailSetting => {
    return settings.get(rail) || {
      rail,
      posting_mode: 'manual',
      require_bank_match: isBankMatchRequired(rail),
      auto_post_enabled_at: null,
      invoice_status: 'DRAFT',
      auto_repost_after_rollback: false,
      tax_mode: 'AU_GST_STANDARD',
      support_acknowledged_at: null,
    };
  };

  const getTierForRail = (rail: string) => {
    return computeSupportTier({ rail, taxProfile });
  };

  const handleToggleAutoPost = async (rail: string, enable: boolean) => {
    const tier = getTierForRail(rail);
    const setting = getSettingForRail(rail);

    if (enable) {
      const eligibility = getAutomationEligibility({
        tier,
        taxMode: setting.tax_mode,
        supportAcknowledgedAt: setting.support_acknowledged_at,
        isAutopost: true,
      });

      if (!eligibility.autopostAllowed) {
        toast.error(eligibility.blockers[0] || 'Auto-post not available for this rail.');
        return;
      }

      setConfirmRail(rail);
      return;
    }
    await saveRailSetting(rail, { posting_mode: 'manual' });
  };

  const handleConfirmAutoPost = async () => {
    if (!confirmRail) return;
    const tier = getTierForRail(confirmRail);
    const updates: Partial<RailSetting> & { auto_post_enabled_at?: string } = {
      posting_mode: 'auto',
      auto_post_enabled_at: new Date().toISOString(),
    };

    // Force DRAFT for experimental rails
    if (tier === 'EXPERIMENTAL') {
      updates.invoice_status = 'DRAFT';
    }

    await saveRailSetting(confirmRail, updates);
    setConfirmRail(null);
  };

  const handleToggleBankMatch = async (rail: string, required: boolean) => {
    await saveRailSetting(rail, { require_bank_match: required });
  };

  const handleChangeInvoiceStatus = async (rail: string, status: 'DRAFT' | 'AUTHORISED') => {
    const tier = getTierForRail(rail);
    if (status === 'AUTHORISED' && tier !== 'SUPPORTED') {
      toast.error('Authorised mode is only available for fully supported (AU-validated) rails.');
      return;
    }
    await saveRailSetting(rail, { invoice_status: status });
  };

  const handleChangeTaxMode = async (rail: string, mode: TaxMode) => {
    await saveRailSetting(rail, { tax_mode: mode });
  };

  const handleToggleAutoRepost = async (rail: string, enabled: boolean) => {
    await saveRailSetting(rail, { auto_repost_after_rollback: enabled });
  };

  const handleAcknowledgeRail = async (rail: string) => {
    const result = await acknowledgeRailSupport(rail);
    if (result.success) {
      toast.success(`Acknowledged experimental support for ${getRailLabel(rail)}`);
      loadData();
    } else {
      toast.error(result.error || 'Failed to acknowledge');
    }
  };

  const saveRailSetting = async (rail: string, updates: Partial<RailSetting> & { auto_post_enabled_at?: string }) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;

    const current = getSettingForRail(rail);
    const newSetting = { ...current, ...updates };

    const { error } = await supabase
      .from('rail_posting_settings')
      .upsert({
        user_id: userData.user.id,
        rail,
        posting_mode: newSetting.posting_mode,
        require_bank_match: newSetting.require_bank_match,
        auto_post_enabled_at: updates.auto_post_enabled_at || current.auto_post_enabled_at || null,
        auto_post_enabled_by: updates.posting_mode === 'auto' ? userData.user.id : null,
        invoice_status: newSetting.invoice_status,
        auto_repost_after_rollback: newSetting.auto_repost_after_rollback,
        tax_mode: newSetting.tax_mode,
        support_acknowledged_at: newSetting.support_acknowledged_at,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'user_id,rail' });

    if (error) {
      toast.error('Failed to save setting');
      console.error(error);
      return;
    }

    setSettings(prev => {
      const next = new Map(prev);
      next.set(rail, newSetting as RailSetting);
      return next;
    });

    if ('posting_mode' in updates) {
      toast.success(
        newSetting.posting_mode === 'auto'
          ? `Auto-post enabled for ${getRailLabel(rail)}`
          : `Auto-post disabled for ${getRailLabel(rail)}`
      );
    } else if ('invoice_status' in updates) {
      toast.success(`${getRailLabel(rail)} invoices will be created as ${updates.invoice_status}`);
    } else if ('tax_mode' in updates) {
      toast.success(`Tax mode updated for ${getRailLabel(rail)}`);
    } else if ('auto_repost_after_rollback' in updates) {
      toast.success(updates.auto_repost_after_rollback ? 'Auto-repost after rollback enabled' : 'Auto-repost after rollback disabled');
    }
  };

  const handleRetry = async (settlementId: string) => {
    setRetrying(prev => new Set(prev).add(settlementId));
    try {
      const { triggerAutoPost } = await import('@/actions/xeroPush');
      await triggerAutoPost(settlementId);

      toast.success('Retry queued');
      setTimeout(loadData, 2000);
    } catch {
      toast.error('Retry failed');
    } finally {
      setRetrying(prev => {
        const next = new Set(prev);
        next.delete(settlementId);
        return next;
      });
    }
  };

  // Only show rails that are in PHASE_1_RAILS or connected
  const allRails = PHASE_1_RAILS.map(r => r.code as string);
  const visibleRails = allRails.filter(r =>
    connectedRails.includes(r) || settings.has(r)
  );

  if (loading) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Organisation Posting Mode
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Configure how settlements are posted to Xero per marketplace rail.
            Auto-post sends validated settlements automatically — it never bypasses validation.
            These settings apply to all users in your organisation.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {visibleRails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No marketplace connections found. Connect a marketplace to configure posting.
            </p>
          ) : (
            <div className="space-y-3">
              {visibleRails.map(rail => {
                const setting = getSettingForRail(rail);
                const isAuto = setting.posting_mode === 'auto';
                const defaultBankMatch = isBankMatchRequired(rail);
                const tier = getTierForRail(rail);
                const eligibility = getAutomationEligibility({
                  tier,
                  taxMode: setting.tax_mode,
                  supportAcknowledgedAt: setting.support_acknowledged_at,
                  isAutopost: isAuto,
                });

                return (
                  <div
                    key={rail}
                    className={cn(
                      "p-3 rounded-lg border transition-colors",
                      isAuto ? "border-primary/30 bg-primary/5" : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{getRailLabel(rail)}</span>
                          <SupportTierBadge tier={tier} />
                          {isAuto && (
                            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                              <Zap className="h-2.5 w-2.5 mr-0.5" /> Auto
                            </Badge>
                          )}
                          {setting.invoice_status === 'AUTHORISED' && (
                            <Badge variant="outline" className="text-[10px] border-amber-400/60 text-amber-700">
                              <FileCheck className="h-2.5 w-2.5 mr-0.5" /> Authorised
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {isAuto ? 'Auto' : 'Manual'}
                        </span>
                        <Switch
                          checked={isAuto}
                          onCheckedChange={(checked) => handleToggleAutoPost(rail, checked)}
                          disabled={!eligibility.autopostAllowed && !isAuto}
                        />
                      </div>
                    </div>

                    {/* Tier warning for non-supported rails */}
                    {tier !== 'SUPPORTED' && (
                      <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <span>
                            {tier === 'EXPERIMENTAL'
                              ? 'Experimental rail — auto-post creates DRAFT only. AUTHORISED blocked.'
                              : 'Unsupported rail — auto-post blocked. Manual DRAFT push only after acknowledgement.'}
                          </span>
                          {!setting.support_acknowledged_at && (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-[10px] ml-1"
                              onClick={() => handleAcknowledgeRail(rail)}
                            >
                              Acknowledge →
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Sub-settings row */}
                    <div className="flex items-center gap-4 mt-2 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={setting.require_bank_match}
                          onCheckedChange={(checked) => handleToggleBankMatch(rail, !!checked)}
                          className="h-3.5 w-3.5"
                        />
                        Require payout confirmation
                      </label>
                      {!defaultBankMatch && !setting.require_bank_match && (
                        <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                          <Shield className="h-2.5 w-2.5" /> Settlement verifies payout
                        </span>
                      )}

                      {/* Invoice status selector */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Invoice as:</span>
                        <Select
                          value={setting.invoice_status}
                          onValueChange={(v) => handleChangeInvoiceStatus(rail, v as 'DRAFT' | 'AUTHORISED')}
                          disabled={!eligibility.authorisedAllowed && setting.invoice_status === 'DRAFT'}
                        >
                          <SelectTrigger className="h-6 w-[110px] text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DRAFT">Draft (safe)</SelectItem>
                            <SelectItem value="AUTHORISED" disabled={!eligibility.authorisedAllowed}>
                              Authorised {!eligibility.authorisedAllowed ? '(blocked)' : ''}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Tax mode selector */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Tax:</span>
                        <Select
                          value={setting.tax_mode}
                          onValueChange={(v) => handleChangeTaxMode(rail, v as TaxMode)}
                        >
                          <SelectTrigger className="h-6 w-[150px] text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="AU_GST_STANDARD">AU GST Standard</SelectItem>
                            <SelectItem value="EXPORT_NO_GST">Export (No GST)</SelectItem>
                            <SelectItem value="REVIEW_EACH_SETTLEMENT">Review each</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Authorised mode warning */}
                    {setting.invoice_status === 'AUTHORISED' && tier === 'SUPPORTED' && (
                      <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>
                          Authorised invoices are immediately live in Xero. Only enabled when all safety gates pass
                          (reconciliation matched, mappings complete, contact mapped, attachment created, tax validated).
                        </span>
                      </div>
                    )}

                    {/* Auto-post enabled date */}
                    {isAuto && setting.auto_post_enabled_at && (
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        Auto-posting since {new Date(setting.auto_post_enabled_at).toLocaleDateString()} — only settlements created after this date are auto-posted.
                        {eligibility.autopostDraftOnly && ' (DRAFT only for this tier)'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Advanced toggles */}
          {visibleRails.length > 0 && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1 h-7 px-2">
                  <ChevronDown className={cn("h-3 w-3 transition-transform", advancedOpen && "rotate-180")} />
                  Advanced
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2">
                {visibleRails.map(rail => {
                  const setting = getSettingForRail(rail);
                  return (
                    <div key={`adv-${rail}`} className="flex items-center justify-between p-2 rounded border border-border text-xs">
                      <div>
                        <span className="font-medium">{getRailLabel(rail)}</span>
                        <span className="text-muted-foreground ml-2">— Auto-repost after rollback</span>
                      </div>
                      <Switch
                        checked={setting.auto_repost_after_rollback}
                        onCheckedChange={(checked) => handleToggleAutoRepost(rail, checked)}
                      />
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground px-1">
                  When enabled, voided settlements reset to auto-post queue. When disabled (default), voided settlements require manual push.
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      {/* Auto-post failed section */}
      {failedSettlements.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Auto-post Failed
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              These settlements failed to auto-post. Review errors and retry.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {failedSettlements.map(s => (
                <div key={s.id} className="flex items-center justify-between p-2.5 rounded-md border border-destructive/20 bg-destructive/5 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs">{getRailLabel(s.marketplace)}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.period_start} → {s.period_end}
                      </span>
                      {s.bank_deposit != null && (
                        <span className="text-xs text-muted-foreground">
                          ${Math.abs(s.bank_deposit).toFixed(2)}
                        </span>
                      )}
                    </div>
                    {s.posting_error && (
                      <p className="text-[10px] text-destructive/80 mt-0.5 truncate max-w-md">
                        {s.posting_error}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    disabled={retrying.has(s.id)}
                    onClick={() => handleRetry(s.id)}
                  >
                    {retrying.has(s.id) ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation dialog */}
      <AlertDialog open={!!confirmRail} onOpenChange={() => setConfirmRail(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable auto-post for {confirmRail ? getRailLabel(confirmRail) : ''}?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Auto-post will send settlements to Xero automatically once they pass all validations.
              </p>
              {confirmRail && getTierForRail(confirmRail) === 'EXPERIMENTAL' && (
                <p className="font-medium text-amber-700">
                  ⚠️ This is an experimental rail — auto-post will create DRAFT invoices only.
                </p>
              )}
              <p className="font-medium text-foreground">
                Only settlements created after enabling will be auto-posted — your historical data is safe.
              </p>
              <p className="text-xs">
                This setting applies to your entire organisation. Auto-post does not bypass any validation checks — it only removes the manual "Send to Xero" click.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAutoPost}>
              <Zap className="h-3.5 w-3.5 mr-1" />
              Enable auto-post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function getRailLabel(rail: string): string {
  const found = PHASE_1_RAILS.find(r => r.code === rail);
  if (found) return found.label;
  return rail.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
