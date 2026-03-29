import { useEffect, useState } from 'react';
import { logger } from '@/utils/logger';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function EbayCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [ebayUsername, setEbayUsername] = useState<string | null>(null);

  useEffect(() => {
    const exchangeCode = async () => {
      const code = searchParams.get('code');
      const errorParam = searchParams.get('error');
      const errorDesc = searchParams.get('error_description');

      logger.debug('[eBay Callback] Processing authorization callback.', { hasCode: !!code, error: errorParam });

      if (errorParam) {
        setStatus('error');
        setErrorMessage(errorDesc || errorParam || 'Authorization was denied');
        return;
      }

      if (!code) {
        setStatus('error');
        setErrorMessage('Missing authorization code from eBay. Please try connecting again.');
        return;
      }

      try {
        logger.debug('[eBay Callback] Exchanging code for tokens...');
        const { data, error } = await supabase.functions.invoke('ebay-auth', {
          headers: { 'x-action': 'connect' },
          body: { code },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        logger.debug('[eBay Callback] Token exchange successful, user:', data.ebay_username);
        setEbayUsername(data.ebay_username);
        setStatus('success');

        // If opened as popup, close after brief delay
        if (window.opener) {
          setTimeout(() => window.close(), 2000);
        } else {
          setTimeout(() => {
            navigate('/dashboard?connected=ebay', { replace: true });
          }, 3000);
        }
      } catch (err: any) {
        console.error('[eBay Callback] Error:', err);
        setStatus('error');
        setErrorMessage(err.message || 'Failed to connect eBay account');
      }
    };

    exchangeCode();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">eBay Connection</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground">Connecting your eBay account...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
              <p className="font-medium text-foreground">eBay Connected Successfully!</p>
              {ebayUsername && (
                <p className="text-xs text-muted-foreground font-mono">
                  User: {ebayUsername}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {window.opener ? 'This window will close automatically...' : 'Redirecting to dashboard...'}
              </p>
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
