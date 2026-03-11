import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import SetupStepConnectXero from './SetupStepConnectXero';
import SetupStepConnectStores from './SetupStepConnectStores';
import SetupStepUpload from './SetupStepUpload';
import SetupStepScanning from './SetupStepScanning';
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

const STEP_LABELS = ['Connect Xero', 'Marketplaces', 'Upload', 'Scan', 'Results'];
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
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : initialStep;
  });
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<string[]>(() => {
    const saved = sessionStorage.getItem(SELECTED_MARKETPLACES_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [skippedAllApis, setSkippedAllApis] = useState(false);

  useEffect(() => {
    if (initialStep > 1) setStep(initialStep);
  }, [initialStep]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, String(step));
  }, [step]);

  useEffect(() => {
    sessionStorage.setItem(SELECTED_MARKETPLACES_KEY, JSON.stringify(selectedMarketplaces));
  }, [selectedMarketplaces]);

  const handleNext = () => setStep(s => Math.min(s + 1, 5));
  const handleSkip = () => setStep(s => Math.min(s + 1, 5));
  const handleComplete = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SELECTED_MARKETPLACES_KEY);
    onComplete();
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

  // If step 3 (Upload) should be skipped, auto-advance
  const effectiveStep = step === 3 && !shouldShowUpload ? 4 : step;

  const progressValue = (effectiveStep / 5) * 100;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleCloseAttempt(); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto p-0 gap-0">
          {/* Progress header */}
          <div className="px-6 pt-6 pb-3 space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Step {effectiveStep} of 5</span>
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
              />
            )}
            {effectiveStep === 2 && (
              <SetupStepConnectStores
                onNext={handleNext}
                onSkip={() => {
                  setSkippedAllApis(true);
                  handleNext();
                }}
                hasAmazon={hasAmazon}
                hasShopify={hasShopify}
                hasXero={hasXero}
                justConnectedXero={justConnectedXero}
                selectedMarketplaces={selectedMarketplaces}
                onMarketplacesChange={setSelectedMarketplaces}
              />
            )}
            {effectiveStep === 3 && shouldShowUpload && (
              <SetupStepUpload
                onNext={handleNext}
                onSkip={handleSkip}
                selectedMarketplaces={selectedMarketplaces}
              />
            )}
            {effectiveStep === 4 && (
              <SetupStepScanning
                onNext={handleNext}
                hasAmazon={hasAmazon}
                hasShopify={hasShopify}
                hasXero={hasXero}
              />
            )}
            {effectiveStep === 5 && (
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
