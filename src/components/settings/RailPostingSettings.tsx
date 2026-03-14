/**
 * RailPostingSettings — Per-rail auto-post configuration UI.
 * Shows each connected marketplace rail with manual/auto toggle + bank match checkbox.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Zap, Shield, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PHASE_1_RAILS, isBankMatchRequired } from '@/constants/settlement-rails';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface RailSetting {
  rail: string;
  posting_mode: 'manual' | 'auto';
  require_bank_match: boolean;
  auto_post_enabled_at: string | null;
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

  const loadData = useCallback(async () => {
    try {
      const [settingsRes, connectionsRes, failedRes] = await Promise.all([
        supabase.from('rail_posting_settings').select('*'),
        supabase.from('marketplace_connections').select('marketplace_code').neq('connection_status', 'suggested'),
        supabase.from('settlements')
          .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, posting_error')
          .eq('posting_state', 'failed')
          .eq('is_hidden', false)
          .order('period_start', { ascending: false }),
      ]);

      if (settingsRes.data) {
        const map = new Map<string, RailSetting>();
        for (const s of settingsRes.data) {
          map.set(s.rail, {
            rail: s.rail,
            posting_mode: s.posting_mode as 'manual' | 'auto',
            require_bank_match: s.require_bank_match,
            auto_post_enabled_at: s.auto_post_enabled_at,
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
    };
  };

  const handleToggleAutoPost = async (rail: string, enable: boolean) => {
    if (enable) {
      setConfirmRail(rail);
      return;
    }
    await saveRailSetting(rail, { posting_mode: 'manual' });
  };

  const handleConfirmAutoPost = async () => {
    if (!confirmRail) return;
    await saveRailSetting(confirmRail, {
      posting_mode: 'auto',
      auto_post_enabled_at: new Date().toISOString(),
    });
    setConfirmRail(null);
  };

  const handleToggleBankMatch = async (rail: string, required: boolean) => {
    await saveRailSetting(rail, { require_bank_match: required });
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
        auto_post_enabled_at: updates.auto_post_enabled_at || current.auto_post_enabled_at,
        auto_post_enabled_by: updates.posting_mode === 'auto' ? userData.user.id : undefined,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,rail' });

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

    toast.success(
      newSetting.posting_mode === 'auto'
        ? `Auto-post enabled for ${getRailLabel(rail)}`
        : `Auto-post disabled for ${getRailLabel(rail)}`
    );
  };

  const handleRetry = async (settlementId: string) => {
    setRetrying(prev => new Set(prev).add(settlementId));
    try {
      // Reset posting_state to null so it can be picked up again
      await supabase
        .from('settlements')
        .update({ posting_state: null, posting_error: null })
        .eq('id', settlementId);

      // Trigger auto-post for this settlement
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        await supabase.functions.invoke('auto-post-settlement', {
          body: { settlement_id: settlementId, user_id: userData.user.id },
        });
      }

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
  const allRails = PHASE_1_RAILS.map(r => r.code);
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
            Rail Posting Mode
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Configure how settlements are posted to Xero per marketplace rail.
            Auto-post sends validated settlements automatically — it never bypasses validation.
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

                return (
                  <div
                    key={rail}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-colors",
                      isAuto ? "border-primary/30 bg-primary/5" : "border-border"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{getRailLabel(rail)}</span>
                        {isAuto && (
                          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                            <Zap className="h-2.5 w-2.5 mr-0.5" /> Auto
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                          <Checkbox
                            checked={setting.require_bank_match}
                            onCheckedChange={(checked) => handleToggleBankMatch(rail, !!checked)}
                            className="h-3.5 w-3.5"
                          />
                          Require bank match
                        </label>
                        {!defaultBankMatch && !setting.require_bank_match && (
                          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                            <Shield className="h-2.5 w-2.5" /> Settlement-confirmed
                          </span>
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
                      />
                    </div>
                  </div>
                );
              })}
            </div>
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
              <p className="font-medium text-foreground">
                Only enable after confirming your account mappings and tax settings are correct.
              </p>
              <p className="text-xs">
                Auto-post does not bypass any validation checks. It only removes the manual "Send to Xero" click.
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
