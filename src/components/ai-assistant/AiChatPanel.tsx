import { useState, useRef, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, X, Loader2, Sparkles, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAiAssistant, type AiMessage } from '@/hooks/use-ai-assistant';
import { useAiContext } from '@/ai/context/AiContextProvider';

const MONTHLY_LIMIT = 50;

/**
 * AiChatPanel — Sheet-based chat UI.
 * Reads page context from AiContextProvider automatically.
 */
export default function AiChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { context } = useAiContext();
  const { messages, isLoading, error, usageCount, sendMessage, clearMessages, loadUsage } = useAiAssistant({ context });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      loadUsage();
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open, loadUsage]);

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput('');
    sendMessage(trimmed);
  };

  const handleSuggestedPrompt = (prompt: string) => {
    sendMessage(prompt);
  };

  const used = usageCount ?? 0;
  const remaining = Math.max(0, MONTHLY_LIMIT - used);

  const suggestedPrompts = context.suggestedPrompts || [];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <SheetTitle className="text-base">Ask AI</SheetTitle>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" onClick={clearMessages} title="Clear chat" className="h-7 w-7">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {remaining} of {MONTHLY_LIMIT} questions remaining this month
          </p>
        </SheetHeader>

        {/* Messages area */}
        <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef as any}>
          <div className="space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="space-y-3 pt-4">
                <p className="text-sm text-muted-foreground text-center">
                  Ask me anything about your settlements, reconciliation, or Xero sync.
                </p>
                {suggestedPrompts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium text-center">Suggested questions:</p>
                    <div className="flex flex-col gap-1.5">
                      {suggestedPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => handleSuggestedPrompt(prompt)}
                          className="text-left text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/50 transition-colors text-foreground"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}

            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="border-t border-border p-3 flex-shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex gap-2"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your settlements..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={!input.trim() || isLoading}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MessageBubble({ message }: { message: AiMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
