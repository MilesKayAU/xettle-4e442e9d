import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';

const SITE_PIN = '1941';
const STORAGE_KEY = 'xettle_pin_verified';

export default function PinGate({ children }: { children: React.ReactNode }) {
  // Secure test-mode bypass: only on localhost / Lovable preview domains
  const isAllowedDomain = window.location.hostname === 'localhost'
    || window.location.hostname.includes('lovable.app')
    || window.location.hostname.includes('lovableproject.com');

  const isTestMode = (
    import.meta.env.VITE_TEST_MODE === 'true'
    || window.location.search.includes('test_mode=true')
  ) && isAllowedDomain;

  const [verified, setVerified] = useState(() => {
    if (isTestMode) return true;
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!verified) {
      inputRefs.current[0]?.focus();
    }
  }, [verified]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    setError(false);

    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    if (digit && index === 3) {
      const fullPin = newPin.join('');
      if (fullPin === SITE_PIN) {
        sessionStorage.setItem(STORAGE_KEY, 'true');
        setVerified(true);
      } else {
        setError(true);
        setPin(['', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleSubmit = () => {
    const fullPin = pin.join('');
    if (fullPin === SITE_PIN) {
      sessionStorage.setItem(STORAGE_KEY, 'true');
      setVerified(true);
    } else {
      setError(true);
      setPin(['', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  };

  if (verified) return <>{children}</>;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-2">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-lg">
            <span className="text-primary underline decoration-primary decoration-2 underline-offset-4">X</span><span className="text-foreground">ettle</span> — Access Required
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Enter the 4-digit PIN to continue</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center gap-3">
            {pin.map((digit, i) => (
              <Input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className={`w-14 h-14 text-center text-2xl font-mono ${error ? 'border-destructive animate-shake' : ''}`}
                autoComplete="off"
              />
            ))}
          </div>
          {error && (
            <p className="text-sm text-destructive text-center">Incorrect PIN. Try again.</p>
          )}
          <Button onClick={handleSubmit} className="w-full" disabled={pin.some(d => !d)}>
            Unlock
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
