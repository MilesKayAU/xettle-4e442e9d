import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { History, Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, Crown, Lock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface SyncEvent {
  id: string;
  event_type: string;
  status: string;
  details: any;
  settlements_affected: number;
  error_message: string | null;
  created_at: string;
}

const EVENT_LABELS: Record<string, string> = {
  amazon_fetch: 'Amazon Fetch',
  xero_push: 'Xero Push',
  xero_auto_push: 'Xero Auto-Push',
};

const STATUS_BADGE: Record<string, { variant: 'default' | 'destructive' | 'secondary'; icon: any }> = {
  success: { variant: 'default', icon: CheckCircle2 },
  error: { variant: 'destructive', icon: XCircle },
  partial: { variant: 'secondary', icon: AlertTriangle },
};

export function SyncHistoryCard() {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('sync_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20);
        if (!error && data) setEvents(data as SyncEvent[]);
      } catch {} finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          Sync History
        </CardTitle>
        <CardDescription className="text-xs">
          Recent auto-fetch and Xero push events
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No sync events yet. Events will appear here when settlements are auto-fetched or pushed to Xero.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {events.map((event) => {
              const badge = STATUS_BADGE[event.status] || STATUS_BADGE.error;
              const Icon = badge.icon;
              return (
                <div key={event.id} className="flex items-center justify-between py-2 px-2 rounded-md bg-muted/30 text-sm">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-3.5 w-3.5 ${event.status === 'success' ? 'text-green-600' : event.status === 'error' ? 'text-destructive' : 'text-yellow-600'}`} />
                    <span className="font-medium">{EVENT_LABELS[event.event_type] || event.event_type}</span>
                    {event.settlements_affected > 0 && (
                      <span className="text-xs text-muted-foreground">({event.settlements_affected} settlements)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {event.error_message && (
                      <span className="text-xs text-destructive truncate max-w-32" title={event.error_message}>
                        {event.error_message}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CRON_OPTIONS = [
  { value: '12', label: 'Every 12 hours', description: 'Premium — catch settlements faster' },
  { value: '24', label: 'Every 24 hours (daily)', description: 'Recommended — perfect for 99% of sellers' },
];

export function CronScheduleCard({ userTier }: { userTier: 'free' | 'starter' | 'pro' }) {
  const [schedule, setSchedule] = useState<string>('24');
  const [saving, setSaving] = useState(false);
  const isPro = userTier === 'pro';

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'cron_schedule_hours')
        .limit(1);
      if (data && data.length > 0 && data[0].value) {
        setSchedule(data[0].value);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', 'cron_schedule_hours')
        .eq('user_id', user.id)
        .limit(1);

      if (existing && existing.length > 0) {
        await supabase
          .from('app_settings')
          .update({ value: schedule })
          .eq('id', existing[0].id);
      } else {
        await supabase
          .from('app_settings')
          .insert({ user_id: user.id, key: 'cron_schedule_hours', value: schedule });
      }
      toast.success(`Auto-sync schedule set to every ${schedule} hours`);
    } catch (err: any) {
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Auto-Sync Schedule
            </CardTitle>
            <CardDescription className="text-xs">
              How often to auto-fetch from Amazon & push to Xero
            </CardDescription>
          </div>
          {isPro ? (
            <Badge className="bg-primary text-primary-foreground gap-1">
              <Crown className="h-3 w-3" /> Pro
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground gap-1">
              <Lock className="h-3 w-3" /> Pro Only
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isPro ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Amazon posts settlements every 2–3 days, so daily checks catch everything. The 12-hour option ensures you're always first to reconcile.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Upgrade to <strong className="text-foreground">Pro ($229/year)</strong> for fully automatic settlement fetching and Xero push on a schedule.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link to="/pricing">View Plans</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
