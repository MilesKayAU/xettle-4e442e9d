import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TrialStatus = 'loading' | 'active' | 'expiring' | 'expired' | 'paid' | 'none';

interface TrialInfo {
  status: TrialStatus;
  daysRemaining: number | null;
  userTier: string;
}

export function useTrialStatus(userId: string | undefined): TrialInfo {
  const [info, setInfo] = useState<TrialInfo>({ status: 'loading', daysRemaining: null, userTier: 'free' });

  useEffect(() => {
    if (!userId) return;

    const check = async () => {
      try {
        // Check paid roles first (pro > starter > paid > admin)
        const [proRes, starterRes, paidRes, adminRes, trialRes] = await Promise.all([
          supabase.rpc('has_role', { _role: 'pro' as any }),
          supabase.rpc('has_role', { _role: 'starter' as any }),
          supabase.rpc('has_role', { _role: 'paid' }),
          supabase.rpc('has_role', { _role: 'admin' }),
          supabase.rpc('has_role', { _role: 'trial' as any }),
        ]);

        if (adminRes.data) { setInfo({ status: 'paid', daysRemaining: null, userTier: 'pro' }); return; }
        if (proRes.data) { setInfo({ status: 'paid', daysRemaining: null, userTier: 'pro' }); return; }
        if (starterRes.data) { setInfo({ status: 'paid', daysRemaining: null, userTier: 'starter' }); return; }
        if (paidRes.data) { setInfo({ status: 'paid', daysRemaining: null, userTier: 'starter' }); return; }

        if (trialRes.data) {
          // Server-side trial expiry check — atomically downgrades trial → free if expired
          const { data: expiryResult } = await (supabase.rpc as any)('check_and_expire_trial', {
            p_user_id: userId,
          });

          const result = expiryResult as any;

          if (result?.expired) {
            setInfo({ status: 'expired', daysRemaining: 0, userTier: 'free' });
          } else if (result?.days_remaining != null) {
            const daysRemaining = result.days_remaining as number;
            if (daysRemaining <= 3) {
              setInfo({ status: 'expiring', daysRemaining, userTier: 'starter' });
            } else {
              setInfo({ status: 'active', daysRemaining, userTier: 'starter' });
            }
          } else {
            setInfo({ status: 'active', daysRemaining: 10, userTier: 'starter' });
          }
          return;
        }

        // No relevant role
        setInfo({ status: 'none', daysRemaining: null, userTier: 'free' });
      } catch {
        setInfo({ status: 'none', daysRemaining: null, userTier: 'free' });
      }
    };

    check();
  }, [userId]);

  return info;
}
