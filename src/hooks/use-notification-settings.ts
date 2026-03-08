import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const NOTIFICATION_EMAIL_KEY = 'invoice_notification_email';

export function useNotificationSettings() {
  const [notificationEmail, setNotificationEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Fetch the notification email from database on mount
  useEffect(() => {
    fetchNotificationEmail();
  }, []);

  const fetchNotificationEmail = async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', NOTIFICATION_EMAIL_KEY)
        .maybeSingle();

      if (error) {
        console.error('Error fetching notification email:', error);
        return;
      }

      if (data?.value) {
        setNotificationEmail(data.value);
      }
    } catch (error) {
      console.error('Error fetching notification settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveNotificationEmail = async (email: string) => {
    try {
      // Use upsert to insert or update
      const { error } = await supabase
        .from('app_settings')
        .upsert(
          { key: NOTIFICATION_EMAIL_KEY, value: email },
          { onConflict: 'key' }
        );

      if (error) throw error;

      setNotificationEmail(email);
      return true;
    } catch (error) {
      console.error('Error saving notification email:', error);
      return false;
    }
  };

  const clearNotificationEmail = async () => {
    try {
      const { error } = await supabase
        .from('app_settings')
        .delete()
        .eq('key', NOTIFICATION_EMAIL_KEY);

      if (error) throw error;

      setNotificationEmail('');
      return true;
    } catch (error) {
      console.error('Error clearing notification email:', error);
      return false;
    }
  };

  return {
    notificationEmail,
    saveNotificationEmail,
    clearNotificationEmail,
    isConfigured: !!notificationEmail,
    loading
  };
}
