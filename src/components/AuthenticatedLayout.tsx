import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTrialStatus } from '@/hooks/use-trial-status';
import TrialBanner from '@/components/shared/TrialBanner';

export default function AuthenticatedLayout() {
  const [userId, setUserId] = useState<string | undefined>();

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUserId(data.session?.user?.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setUserId(session?.user?.id);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const trialInfo = useTrialStatus(userId);

  return (
    <>
      <TrialBanner status={trialInfo.status} daysRemaining={trialInfo.daysRemaining} />
      <Outlet />
    </>
  );
}
