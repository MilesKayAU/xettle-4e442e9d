import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import AiChatPanel from './AiChatPanel';

/**
 * AskAiButton — Floating AI assistant button.
 * Reads context from AiContextProvider (no props needed).
 * Mounted in AuthenticatedLayout for sitewide availability.
 * Uses centralized AuthContext — no direct supabase.auth calls.
 */
export default function AskAiButton() {
  const [open, setOpen] = useState(false);
  const { user, hasAccess, loading } = useAuth();

  if (!user || loading) return null;

  const handleClick = () => {
    if (!hasAccess) {
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
        className="fixed bottom-16 right-4 z-50 shadow-lg gap-2"
        size="sm"
      >
        <Sparkles className="h-4 w-4" />
        Ask AI
      </Button>
      <AiChatPanel
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
