import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTrialStatus } from '@/hooks/use-trial-status';
import TrialBanner from '@/components/shared/TrialBanner';
import ScopeBanner from '@/components/shared/ScopeBanner';
import { AiContextProvider } from '@/ai/context/AiContextProvider';
import AskAiButton from '@/components/ai-assistant/AskAiButton';

export default function AuthenticatedLayout() {
  const [userId, setUserId] = useState<string | undefined>();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const trialInfo = useTrialStatus(userId);

  return (
    <AiContextProvider>
      <ScopeBanner />
      <TrialBanner status={trialInfo.status} daysRemaining={trialInfo.daysRemaining} />
      <Outlet />
      <AskAiButton />
    </AiContextProvider>
  );
}
