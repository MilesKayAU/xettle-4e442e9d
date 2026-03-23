import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link2, Unlink, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { storeXeroOauthReturnPath, XERO_OAUTH_STATE_KEY } from '@/utils/xero-oauth';

interface Tenant {
  id: string;
  name: string;
  expiresAt: string;
}

interface ConnectionStatus {
  connected: boolean;
  isExpired: boolean;
  tenants: Tenant[];
}

const XeroConnectionStatus = () => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setStatus({ connected: false, isExpired: false, tenants: [] });
        setLoading(false);
        return;
      }

      // Use supabase.functions.invoke with query params passed via headers
      const { data: result, error } = await supabase.functions.invoke('xero-auth', {
        method: 'GET',
        headers: {
          'x-action': 'status'
        }
      });

      if (error) {
        console.error('Failed to fetch Xero status:', error);
        setStatus({ connected: false, isExpired: false, tenants: [] });
      } else {
        setStatus(result);
      }
    } catch (error) {
      console.error('Error fetching Xero status:', error);
      setStatus({ connected: false, isExpired: false, tenants: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error('You must be logged in to connect to Xero');
        setConnecting(false);
        return;
      }

      const redirectUri = 'https://xettle.app/xero/callback';
      
      // Use supabase.functions.invoke
      const { data: result, error } = await supabase.functions.invoke('xero-auth', {
        method: 'GET',
        headers: {
          'x-action': 'authorize',
          'x-redirect-uri': redirectUri
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to start authorization');
      }

      if (result?.error) {
        throw new Error(result.error || 'Failed to start authorization');
      }

      // Store state for CSRF protection
      if (result?.state) {
        sessionStorage.setItem(XERO_OAUTH_STATE_KEY, result.state);
      }

      // Redirect to Xero
      if (result?.authUrl) {
        storeXeroOauthReturnPath();
        window.location.href = result.authUrl;
      } else {
        throw new Error('No authorization URL received');
      }

    } catch (error: any) {
      console.error('Error connecting to Xero:', error);
      toast.error(error.message || 'Failed to connect to Xero');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error('You must be logged in');
        setDisconnecting(false);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('xero-auth', {
        method: 'POST',
        headers: {
          'x-action': 'disconnect'
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to disconnect');
      }

      if (result?.error) {
        throw new Error(result.error || 'Failed to disconnect');
      }

      toast.success('Disconnected from Xero');
      setStatus({ connected: false, isExpired: false, tenants: [] });
    } catch (error: any) {
      console.error('Error disconnecting from Xero:', error);
      toast.error(error.message || 'Failed to disconnect from Xero');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">X</span>
            </div>
            <div>
              <CardTitle className="text-lg">Xero Integration</CardTitle>
              <CardDescription>
                Sync invoices and bills directly to Xero
              </CardDescription>
            </div>
          </div>
          <Badge 
            variant={status?.connected ? (status.isExpired ? 'destructive' : 'default') : 'secondary'}
            className={status?.connected && !status.isExpired ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200' : ''}
          >
            {status?.connected && !status.isExpired && <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />}
            {status?.connected 
              ? (status.isExpired ? 'Token Expired' : 'Connected') 
              : 'Not Connected'
            }
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.connected && status.tenants.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Connected Organizations
            </p>
            <ul className="space-y-1">
              {status.tenants.map((tenant) => (
                <li key={tenant.id} className="text-sm text-muted-foreground pl-6">
                  {tenant.name}
                </li>
              ))}
            </ul>
            {status.isExpired && (
              <p className="text-sm text-destructive mt-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Token expired. Please reconnect.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {!status?.connected ? (
            <Button 
              onClick={handleConnect} 
              disabled={connecting}
              className="flex-1"
            >
              {connecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  Connect to Xero
                </>
              )}
            </Button>
          ) : (
            <>
              {status.isExpired && (
                <Button 
                  onClick={handleConnect} 
                  disabled={connecting}
                  className="flex-1"
                >
                  {connecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Reconnecting...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Reconnect
                    </>
                  )}
                </Button>
              )}
              <Button 
                variant="outline" 
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Unlink className="mr-2 h-4 w-4" />
                    Disconnect
                  </>
                )}
              </Button>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={fetchStatus}
                title="Refresh status"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default XeroConnectionStatus;
