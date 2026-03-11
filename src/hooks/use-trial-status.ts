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
          const { data: trialSetting } = await supabase
            .from('app_settings')
            .select('value')
            .eq('user_id', userId)
            .eq('key', 'trial_started_at')
            .maybeSingle();

          if (trialSetting?.value) {
            const daysSinceStart = Math.floor(
              (Date.now() - new Date(trialSetting.value).getTime()) / (1000 * 60 * 60 * 24)
            );
            const daysRemaining = Math.max(0, 10 - daysSinceStart);

            if (daysSinceStart > 10) {
              // Expired — downgrade
              await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'trial' as any);
              await supabase.from('user_roles').upsert(
                { user_id: userId, role: 'free' as any },
                { onConflict: 'user_id,role' }
              );
              setInfo({ status: 'expired', daysRemaining: 0, userTier: 'free' });
            } else if (daysRemaining <= 3) {
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
