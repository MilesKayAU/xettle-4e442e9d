import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { DEFAULT_AMAZON_REGION, getAmazonRegionByMarketplaceId, getAmazonRegionLabel } from '@/constants/amazon-regions';

export default function AmazonCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [sellerInfo, setSellerInfo] = useState<{ selling_partner_id: string; marketplace_id: string } | null>(null);

  useEffect(() => {
    const exchangeCode = async () => {
      const spapi_oauth_code = searchParams.get('spapi_oauth_code');
      const selling_partner_id = searchParams.get('selling_partner_id');
      const mws_auth_token = searchParams.get('mws_auth_token');
      const errorParam = searchParams.get('error');
      const errorDesc = searchParams.get('error_description');

      if (errorParam) {
        setStatus('error');
        setErrorMessage(errorDesc || errorParam || 'Authorization was denied');
        return;
      }

      if (!spapi_oauth_code || !selling_partner_id) {
        setStatus('error');
        setErrorMessage('Missing authorization parameters from Amazon. Please try connecting again.');
        return;
      }

      try {
        // Parse marketplace_id and region from the state param (format: uuid:marketplaceId:region)
        const stateParam = searchParams.get('state') || '';
        const stateParts = stateParam.split(':');
        const storedMarketplaceId = stateParts.length >= 3 ? stateParts[1] : null;
        const storedRegion = stateParts.length >= 3 ? stateParts[2] : null;

        // Fallback to sessionStorage for backward compat, then defaults
        const marketplace_id = storedMarketplaceId || sessionStorage.getItem('amazon_marketplace_id') || DEFAULT_AMAZON_REGION.marketplaceId;
        const region = storedRegion || sessionStorage.getItem('amazon_region') || DEFAULT_AMAZON_REGION.region;

        const { data, error } = await supabase.functions.invoke('amazon-auth', {
          headers: { 'x-action': 'connect' },
          body: {
            spapi_oauth_code,
            selling_partner_id,
            marketplace_id,
            region,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        setSellerInfo({
          selling_partner_id: data.selling_partner_id,
          marketplace_id: data.marketplace_id,
        });
        setStatus('success');

        // Auto-redirect after 3 seconds
        setTimeout(() => {
          navigate('/dashboard?connected=amazon', { replace: true });
        }, 3000);
      } catch (err: any) {
        console.error('Amazon callback error:', err);
        setStatus('error');
        setErrorMessage(err.message || 'Failed to connect Amazon account');
      }
    };

    exchangeCode();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">Amazon Connection</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">Connecting your Amazon account...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
              <p className="font-medium text-foreground">Amazon Connected Successfully!</p>
              {sellerInfo && (
                <p className="text-xs text-muted-foreground font-mono">
                  Seller: {sellerInfo.selling_partner_id}
                </p>
              )}
              <p className="text-xs text-muted-foreground">Redirecting to dashboard...</p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-10 w-10 text-destructive mx-auto" />
              <p className="font-medium text-foreground">Connection Failed</p>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => navigate('/dashboard', { replace: true })}>
                  Back to Dashboard
                </Button>
                <Button size="sm" onClick={() => window.location.reload()}>
                  Try Again
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}