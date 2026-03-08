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

        const redirectUri = `${window.location.origin}/auth/xero/callback`;
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
          <Button onClick={() => navigate('/dashboard')} className="w-full">
            {status === 'success' ? 'Continue to Dashboard' : 'Back to Dashboard'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default XeroCallback;
