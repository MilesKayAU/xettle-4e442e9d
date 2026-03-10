import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import SetupStepConnectStores from './SetupStepConnectStores';
import SetupStepConnectXero from './SetupStepConnectXero';
import SetupStepScanning from './SetupStepScanning';
import SetupStepResults from './SetupStepResults';
import SetupStepActions from './SetupStepActions';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialStep?: number;
  hasAmazon?: boolean;
  hasShopify?: boolean;
  hasXero?: boolean;
}

const STEP_LABELS = ['Connect Stores', 'Connect Xero', 'Scan', 'Results', 'Next Steps'];

export default function SetupWizard({
  open,
  onClose,
  onComplete,
  initialStep = 1,
  hasAmazon = false,
  hasShopify = false,
  hasXero = false,
}: SetupWizardProps) {
  const [step, setStep] = useState(() => {
    const saved = sessionStorage.getItem('xettle_setup_step');
    return saved ? parseInt(saved, 10) : initialStep;
  });

  useEffect(() => {
    if (initialStep > 1) setStep(initialStep);
  }, [initialStep]);

  useEffect(() => {
    sessionStorage.setItem('xettle_setup_step', String(step));
  }, [step]);

  const handleNext = () => setStep(s => Math.min(s + 1, 5));
  const handleSkip = () => setStep(s => Math.min(s + 1, 5));
  const handleComplete = () => {
    sessionStorage.removeItem('xettle_setup_step');
    onComplete();
  };

  const progressValue = (step / 5) * 100;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Progress header */}
        <div className="px-6 pt-6 pb-3 space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {step} of 5</span>
            <span>Setup takes about 60 seconds</span>
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
            <SetupStepConnectStores
              onNext={handleNext}
              onSkip={onClose}
              hasAmazon={hasAmazon}
              hasShopify={hasShopify}
            />
          )}
          {step === 2 && (
            <SetupStepConnectXero
              onNext={handleNext}
              onSkip={handleSkip}
              hasXero={hasXero}
            />
          )}
          {step === 3 && (
            <SetupStepScanning
              onNext={handleNext}
              hasAmazon={hasAmazon}
              hasShopify={hasShopify}
              hasXero={hasXero}
            />
          )}
          {step === 4 && (
            <SetupStepResults onNext={handleNext} />
          )}
          {step === 5 && (
            <SetupStepActions
              onComplete={handleComplete}
              hasXero={hasXero}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
