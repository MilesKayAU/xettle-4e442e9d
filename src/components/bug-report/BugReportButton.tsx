import { useState, useEffect, useRef, useCallback } from 'react';
import { Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import BugReportModal from './BugReportModal';

interface ConsoleError {
  message: string;
  source?: string;
  timestamp: string;
}

export default function BugReportButton() {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const errorsRef = useRef<ConsoleError[]>([]);

  // Intercept console errors
  useEffect(() => {
    const originalError = console.error;
    console.error = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      errorsRef.current = [
        ...errorsRef.current.slice(-9),
        { message: msg.substring(0, 500), timestamp: new Date().toISOString() },
      ];
      originalError.apply(console, args);
    };

    const onError = (event: ErrorEvent) => {
      errorsRef.current = [
        ...errorsRef.current.slice(-9),
        {
          message: event.message?.substring(0, 500) || 'Unknown error',
          source: event.filename,
          timestamp: new Date().toISOString(),
        },
      ];
    };

    window.addEventListener('error', onError);
    return () => {
      console.error = originalError;
      window.removeEventListener('error', onError);
    };
  }, []);

  const getErrors = useCallback(() => [...errorsRef.current], []);

  if (!isAdmin) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-50 shadow-lg gap-2"
        size="sm"
        variant="outline"
      >
        <Bug className="h-4 w-4" />
        Report Issue
      </Button>
      <BugReportModal
        open={open}
        onClose={() => setOpen(false)}
        getErrors={getErrors}
        userEmail={user?.email || ''}
      />
    </>
  );
}
