/**
 * useSettingsPin — Session-level PIN unlock for sensitive Xero-affecting settings.
 *
 * Users set a 4-digit PIN during signup (stored as SHA-256 hash in app_settings).
 * Before any Xero-affecting change, this hook gates the action behind a PIN prompt.
 * Once unlocked, the session remains unlocked until the tab is closed.
 */

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const SESSION_KEY = 'xettle_settings_pin_unlocked';
// ... keep existing code
export function useSettingsPin() {
  const { user } = useAuth();
  const [isUnlocked, setIsUnlocked] = useState(readSessionUnlockState);
  const [showDialog, setShowDialog] = useState(false);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    (async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'settings_pin_hash')
        .maybeSingle();
      if (isMounted) setHasPin(!!data?.value);
    })();
    return () => { isMounted = false; };
  }, [user]);

  const unlock = useCallback(() => {
    persistSessionUnlockState();
    setIsUnlocked(true);
    setShowDialog(false);
    if (pendingCallback) {
      pendingCallback();
      setPendingCallback(null);
    }
  }, [pendingCallback]);

  const requirePin = useCallback((callback: () => void) => {
    // If no PIN is set, allow through (legacy users without PIN)
    if (hasPin === false) {
      callback();
      return;
    }
    if (isUnlocked) {
      callback();
      return;
    }
    setPendingCallback(() => callback);
    setShowDialog(true);
  }, [isUnlocked, hasPin]);

  const cancelDialog = useCallback(() => {
    setShowDialog(false);
    setPendingCallback(null);
  }, []);

  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'settings_pin_hash')
      .maybeSingle();
    if (!data?.value) return false;
    const inputHash = await hashPin(pin);
    return inputHash === data.value;
  }, []);

  return {
    isUnlocked,
    hasPin,
    showDialog,
    requirePin,
    unlock,
    cancelDialog,
    verifyPin,
  };
}
