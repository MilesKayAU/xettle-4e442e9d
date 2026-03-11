import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import AiChatPanel from './AiChatPanel';

interface AskAiButtonProps {
  context?: Record<string, any>;
  suggestedPrompts?: string[];
}

export default function AskAiButton({ context, suggestedPrompts }: AskAiButtonProps) {
  const [open, setOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isPro, setIsPro] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      setIsAuthenticated(true);

      const [proRes, adminRes, starterRes] = await Promise.all([
        supabase.rpc('has_role', { _role: 'pro' }),
        supabase.rpc('has_role', { _role: 'admin' }),
        supabase.rpc('has_role', { _role: 'starter' }),
      ]);

      if (mounted) setIsPro(!!proRes.data || !!adminRes.data || !!starterRes.data);
    };

    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  if (!isAuthenticated) return null;

  const handleClick = () => {
    if (isPro === false) {
      toast.error('AI Assistant is a Pro feature — upgrade to unlock', {
        action: {
          label: 'View Plans',
          onClick: () => window.location.href = '/pricing',
        },
      });
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        onClick={handleClick}
        className="fixed bottom-4 right-4 z-50 shadow-lg gap-2"
        size="sm"
      >
        <Sparkles className="h-4 w-4" />
        Ask AI
      </Button>
      <AiChatPanel
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        suggestedPrompts={suggestedPrompts}
      />
    </>
  );
}
