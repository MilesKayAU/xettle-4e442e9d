import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

      // Validate state if we stored it
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
        // Get the current session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          setStatus('error');
          setMessage('You must be logged in to complete Xero authorization.');
          return;
        }

        // Get the redirect URI (must match what was used in the authorize request)
        const redirectUri = `${window.location.origin}/auth/xero/callback`;

        // Exchange code for tokens via edge function using supabase.functions.invoke
        const { data: result, error: funcError } = await supabase.functions.invoke('xero-auth', {
          body: { code, redirectUri },
          headers: {
            'x-action': 'callback'
          }
        });

        if (funcError) {
          throw new Error(funcError.message || 'Failed to complete authorization');
        }

        if (result?.error) {
          throw new Error(result.error || result.details || 'Failed to complete authorization');
        }

        setTenants(result?.tenants || []);
        setStatus('success');
        setMessage('Successfully connected to Xero!');
        
        // Clear the stored state
        sessionStorage.removeItem('xero_oauth_state');

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
            {status === 'loading' && (
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            )}
            {status === 'success' && (
              <CheckCircle className="h-12 w-12 text-green-500" />
            )}
            {status === 'error' && (
              <XCircle className="h-12 w-12 text-destructive" />
            )}
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
          
          <div className="flex flex-col gap-2">
            <Button 
              onClick={() => navigate('/admin')}
              className="w-full"
            >
              {status === 'success' ? 'Continue to Admin' : 'Back to Admin'}
            </Button>
            
            {status === 'error' && (
              <Button 
                variant="outline"
                onClick={() => navigate('/admin')}
                className="w-full"
              >
                Try Again
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default XeroCallback;
