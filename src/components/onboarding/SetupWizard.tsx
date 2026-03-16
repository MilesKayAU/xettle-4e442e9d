import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import SetupStepConnectXero from './SetupStepConnectXero';
import SetupStepConnectStores from './SetupStepConnectStores';
import SetupStepUpload from './SetupStepUpload';
import SetupStepResults from './SetupStepResults';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialStep?: number;
  hasAmazon?: boolean;
  hasShopify?: boolean;
  hasXero?: boolean;
  justConnectedXero?: boolean;
}

const STEP_LABELS = ['Connect Xero', 'Marketplaces', 'Add Settlements', 'Verify'];
const TOTAL_STEPS = 4;
const STORAGE_KEY = 'xettle_setup_step';
const SELECTED_MARKETPLACES_KEY = 'xettle_setup_marketplaces';

export default function SetupWizard({
  open,
  onClose,
  onComplete,
  initialStep = 1,
  hasAmazon = false,
  hasShopify = false,
  hasXero = false,
  justConnectedXero = false,
}: SetupWizardProps) {
  const [step, setStep] = useState(() => {
    if (initialStep > 1) return Math.min(initialStep, TOTAL_STEPS);
    const saved = sessionStorage.getItem(STORAGE_KEY);
    const parsed = saved ? parseInt(saved, 10) : 1;
    return Math.min(parsed, TOTAL_STEPS);
  });
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<string[]>(() => {
    const saved = sessionStorage.getItem(SELECTED_MARKETPLACES_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [skippedAllApis, setSkippedAllApis] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (initialStep > 1) setStep(Math.min(initialStep, TOTAL_STEPS));
  }, [initialStep]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, String(step));
  }, [step]);

  useEffect(() => {
    sessionStorage.setItem(SELECTED_MARKETPLACES_KEY, JSON.stringify(selectedMarketplaces));
  }, [selectedMarketplaces]);

  // Fire-and-forget background scan orchestrator
  const fireBackgroundScan = useCallback(async (fnName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const baseUrl = `https://${projectId}.supabase.co/functions/v1`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      };
      // Amazon needs smart-sync action to actually import settlements
      if (fnName === 'fetch-amazon-settlements') {
        headers['x-action'] = 'smart-sync';
      }
      await fetch(`${baseUrl}/${fnName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      }).catch(err => console.warn(`[wizard] ${fnName} failed:`, err));
    } catch (err) {
      console.warn('[wizard] background scan error:', err);
    }
  }, []);

  const handleNext = () => setStep(s => Math.min(s + 1, TOTAL_STEPS));
  const handleSkip = () => setStep(s => Math.min(s + 1, TOTAL_STEPS));

  const handleBack = () => {
    setStep(s => {
      if (s <= 1) return 1;
      const target = s - 1;
      // If going back to Upload (3) but upload should be skipped, go to Marketplaces (2)
      if (target === 3 && !shouldShowUpload) return 2;
      return target;
    });
  };



  const handleComplete = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SELECTED_MARKETPLACES_KEY);
    // Always mark wizard as complete so it doesn't reappear
    onComplete();
    // Always land on dashboard — Setup Hub is accessible from there if needed
    nav('/dashboard');
  };

  const handleCloseAttempt = () => {
    setShowCloseWarning(true);
  };

  const handleConfirmClose = () => {
    setShowCloseWarning(false);
    onClose();
  };

  // Determine if upload step should show
  const hasCsvMarketplaces = selectedMarketplaces.some(m =>
    !['amazon', 'shopify'].includes(m)
  );
  const shouldShowUpload = hasCsvMarketplaces || skippedAllApis;

  // Calculate effective step, skipping Upload (3) if not needed
  let effectiveStep = step;
  if (step === 3 && !shouldShowUpload) {
    effectiveStep = 4;
  }

  const progressValue = (effectiveStep / TOTAL_STEPS) * 100;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleCloseAttempt(); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto p-0 gap-0">
          {/* Progress header */}
          <div className="px-6 pt-6 pb-3 space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Step {effectiveStep} of {TOTAL_STEPS}</span>
              <span>Setup takes about 60 seconds</span>
            </div>
            <Progress value={progressValue} className="h-1.5" />
            <div className="flex justify-between">
              {STEP_LABELS.map((label, i) => (
                <span
                  key={label}
                  className={`text-[10px] font-medium transition-colors ${
                    i + 1 <= effectiveStep ? 'text-primary' : 'text-muted-foreground/50'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Step content */}
          <div className="px-6 pb-6">
            {effectiveStep === 1 && (
              <SetupStepConnectXero
                onNext={handleNext}
                onSkip={handleSkip}
                hasXero={hasXero}
                onFireBackgroundScan={fireBackgroundScan}
              />
            )}
            {effectiveStep === 2 && (
              <SetupStepConnectStores
                onNext={handleNext}
                onSkip={() => {
                  setSkippedAllApis(true);
                  handleNext();
                }}
                onBack={handleBack}
                hasAmazon={hasAmazon}
                hasShopify={hasShopify}
                hasXero={hasXero}
                justConnectedXero={justConnectedXero}
                selectedMarketplaces={selectedMarketplaces}
                onMarketplacesChange={setSelectedMarketplaces}
                onFireBackgroundScan={fireBackgroundScan}
              />
            )}
            {effectiveStep === 3 && shouldShowUpload && (
              <SetupStepUpload
                onNext={handleNext}
                onSkip={handleSkip}
                onBack={handleBack}
                selectedMarketplaces={selectedMarketplaces}
              />
            )}
            {effectiveStep === 4 && (
              <SetupStepResults
                onNext={handleComplete}
                hasXero={hasXero}
                hasAmazon={hasAmazon}
                hasShopify={hasShopify}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showCloseWarning} onOpenChange={setShowCloseWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave setup?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure? You can restart setup anytime from Settings → Setup Wizard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Setup</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
