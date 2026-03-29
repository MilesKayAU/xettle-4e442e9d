import { Outlet } from 'react-router-dom';
import { useTrialStatus } from '@/hooks/use-trial-status';
import TrialBanner from '@/components/shared/TrialBanner';
import ScopeBanner from '@/components/shared/ScopeBanner';
import { AiContextProvider } from '@/ai/context/AiContextProvider';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import AskAiButton from '@/components/ai-assistant/AskAiButton';

function AuthenticatedLayoutInner() {
  const { user } = useAuth();
  const trialInfo = useTrialStatus(user?.id);

  return (
    <AiContextProvider>
      <ScopeBanner />
      <TrialBanner status={trialInfo.status} daysRemaining={trialInfo.daysRemaining} />
      <Outlet />
      <AskAiButton />
    </AiContextProvider>
  );
}

export default function AuthenticatedLayout() {
  return (
    <AuthProvider>
      <AuthenticatedLayoutInner />
    </AuthProvider>
  );
}
