import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ExternalLink, Unplug, RefreshCw, Lock, KeyRound } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseSettlementTSV, type ParserOptions } from '@/utils/settlement-parser';

interface AmazonConnectionPanelProps {
  onSettlementsAutoFetched?: () => void;
  onRequestSettings?: () => void;
  isPaid?: boolean;
  gstRate?: number;
  syncCutoffDate?: string;
}

export default function AmazonConnectionPanel({ onSettlementsAutoFetched, onRequestSettings, isPaid = false, gstRate = 10, syncCutoffDate }: AmazonConnectionPanelProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualSellerId, setManualSellerId] = useState('');
  const [savingToken, setSavingToken] = useState(false);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'status' },
      });
      if (!error && data) {
        setConnected(data.connected);
        setConnection(data.connection);
        if (data.connection?.updated_at) {
          setLastSync(data.connection.updated_at);
        }
        // Pre-fill seller ID from existing connection
        if (data.connection?.selling_partner_id) {
          setManualSellerId(data.connection.selling_partner_id);
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // Get the OAuth URL from the edge function
      const currentOrigin = window.location.origin;
      const redirectUri = `${currentOrigin}/amazon/callback`;
      
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'authorize' },
        body: { redirect_uri: redirectUri },
      });

      if (error) throw error;
      if (data?.pending) {
        toast.error('SP-API credentials not yet configured');
        return;
      }
      if (data?.authUrl) {
        // Store state for CSRF validation
        if (data.state) {
          sessionStorage.setItem('amazon_oauth_state', data.state);
        }
        window.location.href = data.authUrl;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (err: any) {
      toast.error(`Failed to start Amazon OAuth: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect your Amazon account? You can reconnect anytime.')) return;
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'disconnect' },
      });
      if (error) throw error;
      setConnected(false);
      setConnection(null);
      setLastSync(null);
      toast.success('Amazon account disconnected');
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleFetchNow = async () => {
    if (!syncCutoffDate) {
      toast.error('Sync cutoff date required', {
        description: 'Set a "Don\'t sync before" date in Settings first.',
      });
      if (onRequestSettings) onRequestSettings();
      return;
    }
    setFetching(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Step 1: List available reports (last 90 days only)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      
      const { data, error } = await supabase.functions.invoke('fetch-amazon-settlements', {
        headers: { 'x-action': 'list' },
        body: { startDate: startDate.toISOString() },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const allReports = data?.reports || [];
      if (allReports.length === 0) {
        toast.info('No settlement reports found in the last 90 days');
        return;
      }

      // Step 2: Check which settlements already exist
      const { data: existingData } = await supabase
        .from('settlements')
        .select('settlement_id')
        .eq('user_id', user.id);
      const existingIds = new Set((existingData || []).map(s => s.settlement_id));
      console.log(`[Amazon Fetch] ${allReports.length} reports from API, ${existingIds.size} already in DB`);

      // Filter out reports we can skip early (by reportId matching settlement_id pattern)
      // Process oldest first (reverse the API's newest-first order), take up to 5 new ones
      const reversed = [...allReports].reverse();
      const reports = reversed.slice(0, 5);
      toast.success(`Found ${allReports.length} report(s). Processing ${reports.length} (oldest first)...`);

      // Step 3: Download and parse each report (with delay for rate limiting)
      let importedCount = 0;
      let skippedCount = 0;
      let cutoffCount = 0;
      const parserOpts: ParserOptions = { gstRate };

      for (let i = 0; i < reports.length; i++) {
        const report = reports[i];
        if (!report.reportDocumentId) continue;

        // Wait 8 seconds between downloads to respect Amazon rate limits
        if (i > 0) await new Promise(r => setTimeout(r, 8000));

        try {
          const { data: dlData, error: dlError } = await supabase.functions.invoke('fetch-amazon-settlements', {
            headers: { 'x-action': 'download' },
            body: { reportDocumentId: report.reportDocumentId },
          });

          if (dlError || dlData?.error) {
            console.error('Failed to download report:', report.reportId, dlData?.error || dlError);
            continue;
          }

          const content = dlData?.content;
          if (!content) continue;

          // Parse the TSV content
          let parsed;
          try {
            parsed = parseSettlementTSV(content, parserOpts);
          } catch (parseErr: any) {
            console.error('Failed to parse report:', report.reportId, parseErr.message);
            toast.error(`Failed to parse report ${report.reportId}: ${parseErr.message}`);
            continue;
          }

          // Check for duplicates
          console.log(`[Amazon Fetch] Parsed settlement ${parsed.header.settlementId} (${parsed.header.periodStart} → ${parsed.header.periodEnd})`);
          if (existingIds.has(parsed.header.settlementId)) {
            skippedCount++;
            console.info(`[Amazon Fetch] Skipping duplicate settlement ${parsed.header.settlementId}`);
            continue;
          }

          // Check if settlement is before cutoff date → auto-mark as already in Xero
          const isBeforeCutoff = syncCutoffDate && parsed.header.periodEnd && parsed.header.periodEnd < syncCutoffDate;

          // Save to database with source='api'
          const { header, summary, lines, unmapped } = parsed;
          const splitMonth = parsed.splitMonth;

          const { error: settError } = await supabase.from('settlements').insert({
            user_id: user.id,
            settlement_id: header.settlementId,
            marketplace: 'AU',
            period_start: header.periodStart,
            period_end: header.periodEnd,
            deposit_date: header.depositDate,
            sales_principal: summary.salesPrincipal,
            sales_shipping: summary.salesShipping,
            promotional_discounts: summary.promotionalDiscounts,
            seller_fees: summary.sellerFees,
            fba_fees: summary.fbaFees,
            storage_fees: summary.storageFees,
            refunds: summary.refunds,
            reimbursements: summary.reimbursements,
            other_fees: summary.otherFees,
            net_ex_gst: summary.netExGst,
            gst_on_income: summary.gstOnIncome,
            gst_on_expenses: summary.gstOnExpenses,
            bank_deposit: summary.bankDeposit,
            reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
            status: isBeforeCutoff ? 'synced_external' : 'saved',
            source: 'api',
            is_split_month: splitMonth.isSplitMonth,
            split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
            split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
            parser_version: parsed.header.settlementId ? `${parsed.splitMonth ? 'v1.7.0' : 'v1.7.0'}` : 'v1.7.0',
          } as any);
          if (settError) throw settError;

          // Insert lines in chunks
          if (lines.length > 0) {
            const lineRows = lines.map(l => ({
              user_id: user.id,
              settlement_id: header.settlementId,
              transaction_type: l.transactionType,
              amount_type: l.amountType,
              amount_description: l.amountDescription,
              accounting_category: l.accountingCategory,
              amount: l.amount,
              order_id: l.orderId || null,
              sku: l.sku || null,
              posted_date: l.postedDate || null,
              marketplace_name: l.marketplaceName || null,
            }));
            for (let j = 0; j < lineRows.length; j += 500) {
              const chunk = lineRows.slice(j, j + 500);
              const { error: lineErr } = await supabase.from('settlement_lines').insert(chunk);
              if (lineErr) throw lineErr;
            }
          }

          // Insert unmapped
          if (unmapped.length > 0) {
            const unmappedRows = unmapped.map(u => ({
              user_id: user.id,
              settlement_id: header.settlementId,
              transaction_type: u.transactionType,
              amount_type: u.amountType,
              amount_description: u.amountDescription,
              amount: u.amount,
              raw_row: u.rawRow,
            }));
            const { error: unmappedErr } = await supabase.from('settlement_unmapped').insert(unmappedRows);
            if (unmappedErr) throw unmappedErr;
          }

          existingIds.add(parsed.header.settlementId);
          importedCount++;
          if (isBeforeCutoff) cutoffCount++;
        } catch (dlErr: any) {
          console.error('Download/parse error:', dlErr);
          toast.error(`Error processing report: ${dlErr.message}`);
        }
      }

      const parts = [];
      if (importedCount > 0) parts.push(`${importedCount} imported`);
      if (cutoffCount > 0) parts.push(`${cutoffCount} auto-marked as already in Xero (before cutoff)`);
      if (skippedCount > 0) parts.push(`${skippedCount} duplicates skipped`);
      toast.success(`Done! ${parts.join(', ')}. Check the Auto-Imported tab.`);
      
      if (importedCount > 0) {
        onSettlementsAutoFetched?.();
      }

      setLastSync(new Date().toISOString());
    } catch (err: any) {
      toast.error(`Fetch failed: ${err.message}`);
    } finally {
      setFetching(false);
    }
  };

  const handleSaveManualToken = async () => {
    if (!manualToken.trim() || !manualSellerId.trim()) {
      toast.error('Please enter both Seller ID and Refresh Token');
      return;
    }
    setSavingToken(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('amazon_tokens')
        .upsert({
          user_id: user.id,
          selling_partner_id: manualSellerId.trim(),
          marketplace_id: 'A39IBJ37TRP1C6',
          region: 'fe',
          refresh_token: manualToken.trim(),
          access_token: null,
          expires_at: null,
        } as any, { onConflict: 'user_id,selling_partner_id' });

      if (error) throw error;

      toast.success('Amazon token saved successfully');
      setManualToken('');
      setShowManualToken(false);
      await checkStatus();
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSavingToken(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Checking Amazon connection...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-lg">📦</span>
              Amazon Seller Central
            </CardTitle>
            <CardDescription className="text-xs">
              Connect your Amazon account to auto-import settlement reports via SP-API.
            </CardDescription>
          </div>
          {connected ? (
            <Badge className="bg-green-100 text-green-800 gap-1">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground gap-1">
              <XCircle className="h-3 w-3" /> Not Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected && connection ? (
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Seller ID:</span>
                <span className="font-mono font-medium">{connection.selling_partner_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Marketplace:</span>
                <span className="font-mono">{connection.marketplace_id === 'A39IBJ37TRP1C6' ? 'Amazon AU' : connection.marketplace_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Region:</span>
                <span className="font-mono uppercase">{connection.region}</span>
              </div>
              {lastSync && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last sync:</span>
                  <span className="text-xs">{new Date(lastSync).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant={!syncCutoffDate ? "destructive" : "outline"}
                size="sm"
                onClick={handleFetchNow}
                disabled={fetching}
                className="gap-1.5"
                title={!syncCutoffDate ? 'Set a sync cutoff date in Settings first' : undefined}
              >
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {fetching ? 'Fetching...' : !syncCutoffDate ? '⚠ Set Cutoff Date' : 'Fetch Now'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        ) : !isPaid ? (
          <div className="space-y-3">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground flex items-start gap-2">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Paid Feature</p>
                <p className="text-xs mt-0.5">
                  Auto-import settlement reports directly from Amazon Seller Central. Upgrade to a paid plan to unlock this feature.
                </p>
              </div>
            </div>
            <Button size="sm" disabled className="gap-1.5 opacity-60">
              <ExternalLink className="h-3.5 w-3.5" />
              Connect Amazon (Paid Plan)
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground">
              <p className="text-xs">
                Connect your Seller Central account to auto-import settlement reports — no more manual CSV downloads.
                Xettle requests <strong>read-only</strong> access to your Finance & Accounting data.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={connecting}
                className="gap-1.5"
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                {connecting ? 'Redirecting...' : 'Connect Amazon'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowManualToken(!showManualToken)}
                className="gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Manual Token
              </Button>
            </div>
            {showManualToken && (
              <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
                <p className="text-xs text-muted-foreground font-medium">
                  Paste a refresh token from the SP-API Solution Provider Portal to connect without OAuth.
                </p>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="seller-id" className="text-xs">Selling Partner ID</Label>
                    <Input
                      id="seller-id"
                      placeholder="e.g. A1B2C3D4E5F6G7"
                      value={manualSellerId}
                      onChange={(e) => setManualSellerId(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label htmlFor="refresh-token" className="text-xs">Refresh Token</Label>
                    <Input
                      id="refresh-token"
                      type="password"
                      placeholder="Atzr|..."
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveManualToken}
                  disabled={savingToken || !manualToken.trim() || !manualSellerId.trim()}
                  className="gap-1.5"
                >
                  {savingToken ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Save & Connect
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              OAuth redirects to Amazon to authorize. Manual token is for testing with SP-API portal credentials.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}