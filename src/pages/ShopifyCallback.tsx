import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

const ShopifyCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting your Shopify store...');
  const [shopDomain, setShopDomain] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const shop = searchParams.get('shop');
      const state = searchParams.get('state');
      const hmac = searchParams.get('hmac');
      const timestamp = searchParams.get('timestamp');

      if (!code || !shop || !state || !hmac) {
        setStatus('error');
        setMessage('Missing required parameters from Shopify.');
        return;
      }

      try {
        const { data: result, error: funcError } = await supabase.functions.invoke('shopify-auth', {
          body: { action: 'callback', code, shop, state, hmac, timestamp },
        });

        if (funcError) throw new Error(funcError.message || 'Failed to complete authorization');
        if (result?.error) throw new Error(result.error);

        setShopDomain(result?.shop || shop);
        setStatus('success');
        setMessage('Shopify connected successfully ✅');

        setTimeout(() => navigate('/dashboard'), 2000);
      } catch (err: any) {
        console.error('Shopify callback error:', err);
        setStatus('error');
        setMessage(err.message || 'Failed to connect Shopify store.');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

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
            {status === 'loading' && 'Connecting to Shopify...'}
            {status === 'success' && 'Connected!'}
            {status === 'error' && 'Connection Failed'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'success' && shopDomain && (
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm font-medium mb-1">Connected Store:</p>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                {shopDomain}
              </p>
            </div>
          )}
          <Button onClick={() => navigate('/dashboard')} className="w-full">
            {status === 'success' ? 'Continue to Dashboard' : 'Back to Dashboard'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ShopifyCallback;
