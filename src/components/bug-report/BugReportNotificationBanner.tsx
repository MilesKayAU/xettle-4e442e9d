import { useState, useEffect } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function BugReportNotificationBanner() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      // Get resolved bugs where notify_submitter is true
      const { data: bugs } = await supabase
        .from('bug_reports')
        .select('id, description')
        .eq('submitted_by', user.id)
        .eq('status', 'resolved')
        .eq('notify_submitter', true);

      if (!bugs || bugs.length === 0) return;

      // Check which ones have been dismissed
      const keys = bugs.map((b) => `bug_notification_${b.id}`);
      const { data: dismissed } = await supabase
        .from('app_settings')
        .select('key')
        .in('key', keys);

      const dismissedKeys = new Set((dismissed || []).map((d) => d.key));
      const pending = bugs.filter((b) => !dismissedKeys.has(`bug_notification_${b.id}`));
      setNotifications(pending);
    };

    load();
  }, [user]);

  const dismiss = async (bugId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== bugId));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('app_settings').insert({
      user_id: user.id,
      key: `bug_notification_${bugId}`,
      value: 'dismissed',
    } as any);
  };

  if (notifications.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {notifications.map((n) => (
        <div key={n.id} className="flex items-center gap-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
          <p className="text-sm text-green-800 dark:text-green-200 flex-1">
            Your bug report <em>"{n.description?.substring(0, 60)}…"</em> has been resolved ✓
          </p>
          <button onClick={() => dismiss(n.id)} className="text-green-600 hover:text-green-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
