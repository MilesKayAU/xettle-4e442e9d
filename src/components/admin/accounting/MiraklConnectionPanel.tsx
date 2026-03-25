import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, Loader2, Unplug, RefreshCw, Link2, Info, Settings2, AlertTriangle, Flag } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const KNOWN_MARKETPLACES = [
  { code: 'bunnings', label: 'Bunnings', baseUrl: 'https://marketplace.bunnings.com.au', beta: false },
  { code: 'jbhifi', label: 'JB Hi-Fi', baseUrl: '', beta: true, placeholder: 'e.g. https://marketplace.jbhifi.com.au — check your seller portal URL' },
  { code: 'babybunting', label: 'Baby Bunting', baseUrl: '', beta: true, placeholder: 'e.g. https://marketplace.babybunting.com.au — check your seller portal URL' },
  { code: 'other_mirakl', label: 'Other Mirakl', baseUrl: '', beta: false, placeholder: 'https://marketplace.example.com' },
] as const;

type AuthMode = 'oauth' | 'api_key' | 'both';
type AuthHeaderType = 'auto' | 'bearer' | 'authorization' | 'x-api-key';

interface MiraklConnectionPanelProps {
  onSettlementsAutoFetched?: () => void;
  marketplaceFilter?: string;
}

export default function MiraklConnectionPanel({ onSettlementsAutoFetched, marketplaceFilter }: MiraklConnectionPanelProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  // Form state
  const [selectedMpCode, setSelectedMpCode] = useState('bunnings');
  const [baseUrl, setBaseUrl] = useState('https://marketplace.bunnings.com.au');
  const [authMode, setAuthMode] = useState<AuthMode>('api_key');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [sellerCompanyId, setSellerCompanyId] = useState('');
  const [authHeaderType, setAuthHeaderType] = useState<AuthHeaderType>('auto');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const selectedMp = KNOWN_MARKETPLACES.find(m => m.code === selectedMpCode) || KNOWN_MARKETPLACES[0];

  const handleMarketplaceChange = (code: string) => {
    setSelectedMpCode(code);
    const mp = KNOWN_MARKETPLACES.find(m => m.code === code);
    if (mp?.baseUrl) {
      setBaseUrl(mp.baseUrl);
    } else {
      setBaseUrl('');
    }
    setLastError(null);
  };

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'status' },
      });
      if (!error && data) {
        setConnected(data.connected);
        setConnection(data.connection || null);
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

  const isFormValid = () => {
    if (!baseUrl) return false;
    if (authMode === 'oauth' || authMode === 'both') {
      if (!clientId || !clientSecret) return false;
    }
    if (authMode === 'api_key' || authMode === 'both') {
      if (!apiKey) return false;
    }
    return true;
  };

  const [lastDiagnostic, setLastDiagnostic] = useState<string | null>(null);
  const [lastSuggestion, setLastSuggestion] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!isFormValid()) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Client-side format check for API keys
    if (apiKey && (authMode === 'api_key' || authMode === 'both')) {
      const trimmed = apiKey.trim();
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const HEX_RE = /^[0-9a-f]{32,64}$/i;
      
      if (!UUID_RE.test(trimmed) && !HEX_RE.test(trimmed)) {
        // Check if it looks like a password
        const hasUpper = /[A-Z]/.test(trimmed);
        const hasLower = /[a-z]/.test(trimmed);
        const hasDigit = /\d/.test(trimmed);
        const hasSpecial = /[!@#$%^&*()_+=\[\]{};':"\\|,.<>?/~`]/.test(trimmed);
        
        if (hasUpper && hasLower && hasDigit && hasSpecial && trimmed.length < 40) {
          setLastError(`This looks like a password, not an API key. Mirakl API keys are UUID format (e.g. bfb2d8a3-914b-4d8e-828b-3d75199754c5).`);
          setLastSuggestion('Go to your seller portal → My Settings → API Key tab → Generate a new API key');
          toast.error('That looks like a password, not an API key');
          return;
        }
        
        if (trimmed.length < 20) {
          setLastError(`Value is too short (${trimmed.length} chars) to be a valid API key.`);
          setLastSuggestion('Go to your seller portal → My Settings → API Key tab and copy the full key');
          toast.error('API key is too short');
          return;
        }
      }
    }

    setConnecting(true);
    setLastError(null);
    setLastDiagnostic(null);
    setLastSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'connect' },
        body: {
          base_url: baseUrl,
          client_id: clientId || '',
          client_secret: clientSecret || '',
          api_key: apiKey || null,
          auth_mode: authMode,
          auth_header_type: authHeaderType === 'auto' ? null : authHeaderType,
          seller_company_id: sellerCompanyId || 'default',
          marketplace_label: selectedMp.label,
          marketplace_code: selectedMp.code === 'other_mirakl' ? baseUrl.replace(/https?:\/\//, '').split('.')[0] : selectedMp.code,
        },
      });
      if (error) throw error;
      if (data?.error) {
        setLastDiagnostic(data.diagnostic || null);
        setLastSuggestion(data.suggestion || null);
        throw new Error(data.error);
      }
      toast.success(`${selectedMp.label} connection verified and saved ✓`);
      setClientId('');
      setClientSecret('');
      setApiKey('');
      await checkStatus();
    } catch (err: any) {
      setLastError(err.message);
      toast.error(`Connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    const label = connection?.marketplace_label || 'Mirakl marketplace';
    if (!confirm(`Disconnect ${label}? You can reconnect anytime.`)) return;
    setDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'disconnect' },
        body: connection?.id ? { connection_id: connection.id } : {},
      });
      if (error) throw error;
      setConnected(false);
      setConnection(null);
      toast.success(`${label} disconnected`);
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTestConnection = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    setFetching(true);
    setLastError(null);
    try {
      const { data, error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'status' },
      });
      if (error) throw error;
      if (data?.connected) {
        toast.success(`${connection?.marketplace_label || 'Mirakl'} connection is working ✓`);
      } else {
        toast.error('Connection test failed — credentials may be invalid');
      }
    } catch (err: any) {
      setLastError(err.message);
      toast.error(`Connection test failed: ${err.message}`);
    } finally {
      setFetching(false);
    }
  };

  const handleReportIssue = async () => {
    if (!lastError) return;
    setReporting(true);
    try {
      const { error } = await supabase.functions.invoke('report-mirakl-issue', {
        body: {
          marketplace_label: connection?.marketplace_label || selectedMp.label,
          base_url: baseUrl || connection?.base_url || '',
          error_message: lastError,
        },
      });
      if (error) throw error;
      toast.success('Issue reported — our team will investigate.');
      setLastError(null);
    } catch (err: any) {
      toast.error(`Failed to report: ${err.message}`);
    } finally {
      setReporting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Checking Mirakl connection...</p>
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
              <span className="text-lg">🏠</span>
              Mirakl Marketplace Sync
            </CardTitle>
            <CardDescription className="text-xs">
              Auto-import settlement data from Mirakl-powered marketplaces.
            </CardDescription>
          </div>
          {connected ? (
            <Badge className="bg-primary/10 text-primary gap-1">
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
                <span className="text-muted-foreground">Marketplace:</span>
                <span className="font-medium">{connection.marketplace_label}</span>
              </div>
              {connection.seller_company_id && connection.seller_company_id !== 'default' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shop ID:</span>
                  <span className="font-mono text-xs">{connection.seller_company_id}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auth mode:</span>
                <Badge variant="outline" className="text-[10px] h-5">
                  {connection.auth_mode === 'both' ? 'OAuth + API Key' : connection.auth_mode === 'api_key' ? 'API Key' : 'OAuth'}
                </Badge>
              </div>
              {connection.updated_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last updated:</span>
                  <span className="text-xs">{new Date(connection.updated_at).toLocaleString()}</span>
                </div>
              )}
            </div>

            {lastError && (
              <Alert variant="destructive" className="py-2">
                <AlertDescription className="text-xs flex items-center justify-between gap-2">
                  <span className="truncate">{lastError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1 text-xs h-6"
                    onClick={handleReportIssue}
                    disabled={reporting}
                  >
                    {reporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flag className="h-3 w-3" />}
                    Report Issue
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => handleFetchNow(e)}
                disabled={fetching}
                className="gap-1.5"
              >
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {fetching ? 'Fetching...' : 'Fetch Settlements'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting || fetching}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Marketplace selector */}
            <div>
              <Label className="text-xs">Marketplace</Label>
              <Select value={selectedMpCode} onValueChange={handleMarketplaceChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWN_MARKETPLACES.map(mp => (
                    <SelectItem key={mp.code} value={mp.code} className="text-xs">
                      <span className="flex items-center gap-2">
                        {mp.label}
                        {mp.beta && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-400 text-amber-600">Beta</Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Beta info banner */}
            {selectedMp.beta && (
              <Alert className="py-2 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                  This marketplace is in beta testing. Your connection helps us validate support. If something doesn't work, use the <strong>Report Issue</strong> button.
                </AlertDescription>
              </Alert>
            )}

            {/* Base URL for non-Bunnings */}
            {selectedMp.code !== 'bunnings' && (
              <div>
                <Label className="text-xs">Base URL</Label>
                <Input
                  placeholder={'placeholder' in selectedMp ? (selectedMp as any).placeholder : 'https://marketplace.example.com'}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="font-mono text-xs h-8"
                />
              </div>
            )}

            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground space-y-2">
              <p className="text-xs font-medium">How to find your API key:</p>
              <ol className="text-xs list-decimal list-inside space-y-0.5">
                <li>Log into your <strong>{selectedMp.label} seller portal</strong></li>
                <li>Click your <strong>profile initials</strong> (top right)</li>
                <li>Select <strong>My Settings</strong></li>
                <li>Click the <strong>API Key</strong> tab</li>
                <li>Click <strong>Generate a new API key</strong></li>
                <li>Copy and paste it below</li>
              </ol>
              <p className="text-[10px] text-muted-foreground/70">
                Xettle requests <strong>read-only</strong> access to settlement and transaction data.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">Shop ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  placeholder={`e.g. your ${selectedMp.label} vendor number or Mirakl shop ID`}
                  value={sellerCompanyId}
                  onChange={(e) => setSellerCompanyId(e.target.value)}
                  className="font-mono text-xs h-8"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Leave blank if you only have one store.
                </p>
              </div>
              <div>
                <Label className="text-xs font-medium mb-2 block">Auth Method</Label>
                <RadioGroup
                  value={authMode}
                  onValueChange={(v) => {
                    setAuthMode(v as AuthMode);
                    if (v === 'oauth') {
                      setAuthHeaderType('auto');
                      setAdvancedOpen(false);
                    }
                  }}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="oauth" id="auth-oauth" />
                    <Label htmlFor="auth-oauth" className="text-xs font-normal cursor-pointer">OAuth</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="api_key" id="auth-apikey" />
                    <Label htmlFor="auth-apikey" className="text-xs font-normal cursor-pointer">API Key (recommended)</Label>
                  </div>
                </RadioGroup>
              </div>
              {(authMode === 'oauth' || authMode === 'both') && (
                <>
                  <div>
                    <Label className="text-xs">Client ID</Label>
                    <Input placeholder="Your Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} className="font-mono text-xs h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">Client Secret</Label>
                    <Input type="password" placeholder="Your Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="font-mono text-xs h-8" />
                  </div>
                </>
              )}
              {(authMode === 'api_key' || authMode === 'both') && (
                <div>
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    placeholder="e.g. bfb2d8a3-914b-4d8e-828b-3d75199754c5"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Paste the API key generated from your {selectedMp.label} seller portal.
                  </p>
                </div>
              )}
              {(authMode === 'api_key' || authMode === 'both') && (
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground h-6 px-1">
                      <Settings2 className="h-3 w-3" />
                      Advanced
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div>
                      <Label className="text-xs">Header Format</Label>
                      <Select value={authHeaderType} onValueChange={(v) => setAuthHeaderType(v as AuthHeaderType)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto" className="text-xs">Auto (recommended)</SelectItem>
                          <SelectItem value="bearer" className="text-xs">Authorization: Bearer</SelectItem>
                          <SelectItem value="authorization" className="text-xs">Authorization: key</SelectItem>
                          <SelectItem value="x-api-key" className="text-xs">X-API-KEY: key</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/20 rounded p-2">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Most sellers use a direct <strong>API Key</strong> from the seller portal.
                  If your account uses OAuth credentials (Client ID + Secret), switch to OAuth above.
                </span>
              </div>
            </div>

            {lastError && (
              <div className="space-y-2">
                <Alert variant="destructive" className="py-2">
                  <AlertDescription className="text-xs flex items-center justify-between gap-2">
                    <span>{lastError}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1 text-xs h-6"
                      onClick={handleReportIssue}
                      disabled={reporting}
                    >
                      {reporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flag className="h-3 w-3" />}
                      Report Issue
                    </Button>
                  </AlertDescription>
                </Alert>
                {lastDiagnostic && (
                  <Alert className="py-2 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                      <strong>Diagnostic:</strong> {lastDiagnostic}
                    </AlertDescription>
                  </Alert>
                )}
                {lastSuggestion && (
                  <Alert className="py-2 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
                    <Info className="h-3.5 w-3.5 text-blue-500" />
                    <AlertDescription className="text-xs text-blue-700 dark:text-blue-400">
                      <strong>Fix:</strong> {lastSuggestion}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || !isFormValid()}
              className="gap-1.5"
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Credentials are encrypted and stored securely. No marketplace data is shared with third parties.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
