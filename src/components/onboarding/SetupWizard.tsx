import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Sparkles } from 'lucide-react';
import SetupStepConnectXero from './SetupStepConnectXero';
import SetupStepSelectMarketplaces from './SetupStepSelectMarketplaces';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialStep?: number;
  hasXero?: boolean;
  hasAmazon?: boolean;
  hasShopify?: boolean;
  justConnectedXero?: boolean;
}

const STEP_LABELS = ['Connect Xero', 'Your Channels', "You're In!"];
const TOTAL_STEPS = 3;

export default function SetupWizard({
  open,
  onClose,
  onComplete,
  initialStep = 1,
  hasXero = false,
}: SetupWizardProps) {
  const [step, setStep] = useState(() => Math.min(initialStep, TOTAL_STEPS));
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<string[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    if (initialStep > 1) setStep(Math.min(initialStep, TOTAL_STEPS));
  }, [initialStep]);

  const handleNext = () => setStep(s => Math.min(s + 1, TOTAL_STEPS));
  const handleSkip = () => setStep(s => Math.min(s + 1, TOTAL_STEPS));

  const handleMarketplacesNext = (codes: string[]) => {
    setSelectedMarketplaces(codes);
    setStep(s => Math.min(s + 1, TOTAL_STEPS));
  };

  const handleComplete = () => {
    sessionStorage.removeItem('xettle_setup_step');
    onComplete();
    nav('/dashboard');
  };

  const handleCloseAttempt = () => {
    setShowCloseWarning(true);
  };

  const handleConfirmClose = () => {
    setShowCloseWarning(false);
    onClose();
  };

  const progressValue = (step / TOTAL_STEPS) * 100;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleCloseAttempt(); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto p-0 gap-0">
          {/* Progress header */}
          <div className="px-6 pt-6 pb-3 space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Step {step} of {TOTAL_STEPS}</span>
              <span>Takes about 60 seconds</span>
            </div>
            <Progress value={progressValue} className="h-1.5" />
            <div className="flex justify-between">
              {STEP_LABELS.map((label, i) => (
                <span
                  key={label}
                  className={`text-[10px] font-medium transition-colors ${
                    i + 1 <= step ? 'text-primary' : 'text-muted-foreground/50'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Step content */}
          <div className="px-6 pb-6">
            {step === 1 && (
              <SetupStepConnectXero
                onNext={handleNext}
                onSkip={handleSkip}
                hasXero={hasXero}
              />
            )}
            {step === 2 && (
              <SetupStepSelectMarketplaces
                onNext={handleMarketplacesNext}
                onSkip={() => handleMarketplacesNext([])}
              />
            )}
            {step === 3 && (
              <div className="space-y-6 text-center py-4">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-foreground">You're in!</h2>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {hasXero
                      ? "We're analysing your Xero account now. Head to your dashboard to see what we find."
                      : "Your dashboard is ready. You can connect Xero anytime from Settings."
                    }
                  </p>
                  {selectedMarketplaces.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {selectedMarketplaces.length} marketplace{selectedMarketplaces.length > 1 ? 's' : ''} ready for settlement data.
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>We'll detect additional sales channels automatically</span>
                </div>
                <Button onClick={handleComplete} size="lg" className="w-full max-w-xs">
                  Go to Dashboard
                </Button>
              </div>
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
