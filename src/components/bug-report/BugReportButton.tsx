import { useState, useEffect, useRef, useCallback } from 'react';
import { Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import BugReportModal from './BugReportModal';

interface ConsoleError {
  message: string;
  source?: string;
  timestamp: string;
}

export default function BugReportButton() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const errorsRef = useRef<ConsoleError[]>([]);

  // Check if user has admin role
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      setUserEmail(user.email || '');
      const { data } = await supabase.rpc('has_role', { _role: 'admin' });
      if (mounted) setVisible(!!data);
    };

    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

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

  if (!visible) return null;

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
        userEmail={userEmail}
      />
    </>
  );
}
