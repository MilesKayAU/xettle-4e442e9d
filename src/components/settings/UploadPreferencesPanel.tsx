import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Info } from 'lucide-react';

export default function UploadPreferencesPanel() {
  const [alwaysConfirm, setAlwaysConfirm] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'always_confirm_reparse')
        .maybeSingle();
      setAlwaysConfirm(data?.value === 'true');
      setLoading(false);
    })();
  }, []);

  const handleToggle = async (checked: boolean) => {
    setAlwaysConfirm(checked);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        { user_id: user.id, key: 'always_confirm_reparse', value: String(checked) },
        { onConflict: 'user_id,key' }
      );
    
    if (error) {
      toast.error('Failed to save setting');
      setAlwaysConfirm(!checked);
    } else {
      toast.success(checked ? 'Will always ask before re-parsing' : 'Smart re-parse mode enabled');
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="always-confirm-reparse" className="text-sm font-medium">
            Always confirm before re-parsing existing settlements
          </Label>
          <p className="text-xs text-muted-foreground">
            When off, settlements with issues (gap detected, upload needed) will auto re-parse without asking. 
            Clean settlements (ready to push) will always ask for confirmation regardless of this setting.
          </p>
        </div>
        <Switch
          id="always-confirm-reparse"
          checked={alwaysConfirm}
          onCheckedChange={handleToggle}
        />
      </div>
      
      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Smart behaviour (default):</strong></p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Gap detected / Upload needed → auto re-parse with info toast</li>
              <li>Ready to push / Already recorded → ask for confirmation</li>
              <li>Pushed to Xero → blocked (use Correct &amp; Repost instead)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
