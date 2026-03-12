import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, X, Upload, Link2, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface SuggestedConnection {
  id: string;
  marketplace_code: string;
  marketplace_name: string;
  connection_status: string;
  connection_type: string;
  settings: Record<string, any> | null;
}

interface CoaDetectedPanelProps {
  suggestedConnections: SuggestedConnection[];
  onChanged: () => void;
}

export default function CoaDetectedPanel({ suggestedConnections, onChanged }: CoaDetectedPanelProps) {
  const navigate = useNavigate();
  const [processing, setProcessing] = useState<string | null>(null);

  if (suggestedConnections.length === 0) return null;

  const handleActivateManual = async (conn: SuggestedConnection) => {
    setProcessing(conn.id);
    try {
      await supabase.from('marketplace_connections').update({
        connection_status: 'active',
        connection_type: 'manual',
      }).eq('id', conn.id);
      toast({ title: `${conn.marketplace_name} activated`, description: 'You can now upload settlements for this channel.' });
      onChanged();
    } catch {
      toast({ title: 'Error', description: 'Failed to activate channel.', variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };

  const handleDismiss = async (conn: SuggestedConnection) => {
    setProcessing(conn.id);
    try {
      await supabase.from('marketplace_connections').delete().eq('id', conn.id);
      toast({ title: `${conn.marketplace_name} dismissed` });
      onChanged();
    } catch {
      toast({ title: 'Error', description: 'Failed to dismiss channel.', variant: 'destructive' });
    } finally {
      setProcessing(null);
    }
  };

  const handleConnectApi = (conn: SuggestedConnection) => {
    navigate('/setup');
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          Detected from your Xero accounts
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          We found these channels in your Chart of Accounts. Confirm which ones you sell on.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestedConnections.map(conn => {
          const detectedFrom = (conn.settings as any)?.detected_account || 'Xero account';
          const isProcessing = processing === conn.id;

          return (
            <div
              key={conn.id}
              className="flex items-center justify-between rounded-lg border bg-background px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <CheckCircle className="h-4 w-4 text-primary" />
                <div>
                  <span className="text-sm font-medium">{conn.marketplace_name}</span>
                  <p className="text-xs text-muted-foreground">
                    Detected from: "{detectedFrom}"
                  </p>
                </div>
                <Badge variant="secondary" className="text-[10px]">Suggested</Badge>
              </div>
              <div className="flex items-center gap-2">
                {['amazon_au'].includes(conn.marketplace_code) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConnectApi(conn)}
                    disabled={isProcessing}
                    className="gap-1.5"
                  >
                    <Link2 className="h-3 w-3" />
                    Connect API
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleActivateManual(conn)}
                  disabled={isProcessing}
                  className="gap-1.5"
                >
                  <Upload className="h-3 w-3" />
                  Upload Settlement
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDismiss(conn)}
                  disabled={isProcessing}
                  className="gap-1.5 text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                  Not selling here
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
