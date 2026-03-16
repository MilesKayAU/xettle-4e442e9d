/**
 * SettingsPinDialog — Modal that prompts for 4-digit settings PIN.
 * Used for session-level unlock before Xero-affecting changes.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Shield } from 'lucide-react';

interface SettingsPinDialogProps {
  open: boolean;
  onVerify: (pin: string) => Promise<boolean>;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function SettingsPinDialog({ open, onVerify, onSuccess, onCancel }: SettingsPinDialogProps) {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (open) {
      setPin(['', '', '', '']);
      setError(false);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [open]);

  const handleChange = async (index: number, value: string) => {
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
      setVerifying(true);
      const valid = await onVerify(fullPin);
      setVerifying(false);
      if (valid) {
        onSuccess();
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

  const handleSubmit = async () => {
    const fullPin = pin.join('');
    if (fullPin.length !== 4) return;
    setVerifying(true);
    const valid = await onVerify(fullPin);
    setVerifying(false);
    if (valid) {
      onSuccess();
    } else {
      setError(true);
      setPin(['', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="text-center">
          <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <DialogTitle className="text-center">Settings PIN Required</DialogTitle>
          <DialogDescription className="text-center">
            Enter your 4-digit PIN to unlock sensitive settings for this session
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-3 py-4">
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
              className={`w-12 h-12 text-center text-xl font-mono ${error ? 'border-destructive animate-shake' : ''}`}
              autoComplete="off"
              disabled={verifying}
            />
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive text-center">Incorrect PIN. Try again.</p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1" disabled={verifying}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="flex-1" disabled={pin.some(d => !d) || verifying}>
            {verifying ? 'Verifying...' : 'Unlock'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
