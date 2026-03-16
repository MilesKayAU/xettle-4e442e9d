import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

const XeroCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing Xero authorization...');
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');
      const state = searchParams.get('state');

      const storedState = sessionStorage.getItem('xero_oauth_state');
      if (storedState && state !== storedState) {
        setStatus('error');
        setMessage('Security validation failed. Please try again.');
        return;
      }

      if (error) {
        setStatus('error');
        setMessage(errorDescription || 'Authorization was denied or failed.');
        return;
      }

      if (!code) {
        setStatus('error');
        setMessage('No authorization code received from Xero.');
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setStatus('error');
          setMessage('You must be logged in to complete Xero authorization.');
          return;
        }

        const redirectUri = 'https://xettle.app/xero/callback';
        const { data: result, error: funcError } = await supabase.functions.invoke('xero-auth', {
          body: { code, redirectUri },
          headers: { 'x-action': 'callback' },
        });

        if (funcError) throw new Error(funcError.message || 'Failed to complete authorization');
        if (result?.error) throw new Error(result.error || 'Failed to complete authorization');

        setTenants(result?.tenants || []);
        setStatus('success');
        setMessage('Successfully connected to Xero!');
        sessionStorage.removeItem('xero_oauth_state');

        // Auto-trigger AI Account Mapper (caches CoA + suggests mappings)
        try {
          const { data: existingCodes } = await supabase
            .from('app_settings')
            .select('value')
            .eq('user_id', session.user.id)
            .eq('key', 'accounting_xero_account_codes')
            .maybeSingle();

          if (!existingCodes?.value) {
            console.log('[XeroCallback] No account codes set — auto-triggering AI mapper');
            const { data: mapResult } = await supabase.functions.invoke('ai-account-mapper', {
              body: { action: 'scan_and_match', autoTrigger: true },
            });

            if (mapResult?.success) {
              console.log('[XeroCallback] AI mapper complete — running CoA intelligence');
            }
          }

          // ─── CoA Intelligence: detect channels from Chart of Accounts ───
          // Check if we already ran detection recently (24h cache)
          const { data: cachedResult } = await supabase
            .from('app_settings')
            .select('value')
            .eq('user_id', session.user.id)
            .eq('key', 'coa_detection_results')
            .maybeSingle();

          const cachedAge = cachedResult?.value
            ? Date.now() - new Date(JSON.parse(cachedResult.value).timestamp || 0).getTime()
            : Infinity;

          if (cachedAge > 24 * 60 * 60 * 1000) {
            const [coaRes, registryRes, processorRes] = await Promise.all([
              supabase.from('xero_chart_of_accounts').select('account_code, account_name, account_type, tax_type').eq('user_id', session.user.id).eq('is_active', true),
              supabase.from('marketplace_registry').select('marketplace_code, marketplace_name, detection_keywords').eq('is_active', true),
              supabase.from('payment_processor_registry').select('processor_code, processor_name, detection_keywords').eq('is_active', true),
            ]);

            if (coaRes.data && coaRes.data.length > 0 && registryRes.data && processorRes.data) {
              const { analyseCoA, getHighConfidenceChannels } = await import('@/utils/coa-intelligence');
              const signals = analyseCoA(coaRes.data, registryRes.data, processorRes.data);
              const highChannels = getHighConfidenceChannels(signals);

              console.log(`[XeroCallback] CoA intelligence: ${highChannels.length} HIGH channels, ${signals.payment_providers.length} providers`);

              // Insert suggested channels — never downgrade active to suggested
              const { upsertMarketplaceConnection } = await import('@/utils/marketplace-connections');
              for (const ch of highChannels) {
                await upsertMarketplaceConnection({
                  userId: session.user.id,
                  marketplaceCode: ch.marketplace_code,
                  marketplaceName: ch.marketplace_name,
                  connectionType: 'coa_detected',
                  connectionStatus: 'suggested',
                  neverDowngrade: true,
                  settings: {
                    detected_from: 'coa',
                    detected_account: ch.detected_account,
                  },
                });
              }

              // Cache detection results
              await supabase.from('app_settings').upsert({
                user_id: session.user.id,
                key: 'coa_detection_results',
                value: JSON.stringify({
                  timestamp: new Date().toISOString(),
                  channels: signals.channels.length,
                  providers: signals.payment_providers.length,
                  mappings: signals.mapping_suggestions.length,
                }),
              }, { onConflict: 'user_id,key' });
            }
          }
        } catch (e) {
          console.error('[XeroCallback] Auto-mapper/CoA intelligence failed:', e);
        }
        
        // Auto-redirect after brief success display
        setTimeout(() => {
          navigate('/dashboard?connected=xero');
        }, 2000);
      } catch (err: any) {
        console.error('Xero callback error:', err);
        setStatus('error');
        setMessage(err.message || 'Failed to complete Xero authorization.');
      }
    };

    handleCallback();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            {status === 'loading' && <Loader2 className="h-12 w-12 animate-spin text-primary" />}
            {status === 'success' && <CheckCircle className="h-12 w-12 text-green-500" />}
            {status === 'error' && <XCircle className="h-12 w-12 text-destructive" />}
          </div>
          <CardTitle>
            {status === 'loading' && 'Connecting to Xero...'}
            {status === 'success' && 'Connected!'}
            {status === 'error' && 'Connection Failed'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'success' && tenants.length > 0 && (
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm font-medium mb-2">Connected Organizations:</p>
              <ul className="space-y-1">
                {tenants.map((tenant) => (
                  <li key={tenant.id} className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    {tenant.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button onClick={() => navigate('/dashboard?connected=xero')} className="w-full">
            {status === 'success' ? 'Continue to Dashboard' : 'Back to Dashboard'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default XeroCallback;
