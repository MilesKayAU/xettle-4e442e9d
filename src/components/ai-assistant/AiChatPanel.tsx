import { useState, useRef, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, X, Loader2, Sparkles, Trash2, ScanSearch, Bug, FileCode } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAiAssistant, type AiMessage } from '@/hooks/use-ai-assistant';
import { useAiContext } from '@/ai/context/AiContextProvider';
import { scanPage, formatScanForAI } from '@/utils/page-scanner';

const MONTHLY_LIMIT = 50;

function isTestMode(): boolean {
  const isAllowedDomain =
    window.location.hostname === 'localhost' ||
    window.location.hostname.includes('lovable.app') ||
    window.location.hostname.includes('lovableproject.com');

  return (
    import.meta.env.VITE_TEST_MODE === 'true' ||
    window.location.search.includes('test_mode=true')
  ) && isAllowedDomain;
}

/**
 * AiChatPanel — Sheet-based chat UI.
 * In test mode, includes page scanning and QA tools.
 */
export default function AiChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { context } = useAiContext();
  const { messages, isLoading, error, usageCount, sendMessage, clearMessages, loadUsage } = useAiAssistant({ context });
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const testMode = isTestMode();

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

  const handleScanPage = () => {
    const scan = scanPage();
    const formatted = formatScanForAI(scan);
    sendMessage(`[PAGE SCAN REQUEST]\nI've scanned the current page. Please analyze this scan for issues, bugs, fake data, broken links, accessibility problems, and anything that looks wrong.\n\n${formatted}`);
  };

  const handleCheckFakeData = () => {
    const scan = scanPage();
    const formatted = formatScanForAI(scan);
    sendMessage(`[FAKE DATA CHECK]\nPlease examine this page scan and identify any placeholder data, test data, hardcoded dummy values, lorem ipsum text, or data that looks fake/unrealistic for a production app.\n\n${formatted}`);
  };

  const handleCodeReview = () => {
    const scan = scanPage();
    const formatted = formatScanForAI(scan);
    sendMessage(`[CODE & UX REVIEW]\nBased on this page scan, please explain:\n1. What this page does and its purpose\n2. How the UI elements work together\n3. Any UX issues or improvements you'd suggest\n4. Whether the page structure follows best practices\n\n${formatted}`);
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
              <SheetTitle className="text-base">
                {testMode ? 'AI Code Checker' : 'Ask AI'}
              </SheetTitle>
              {testMode && (
                <span className="text-[10px] font-mono bg-amber-500/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                  TEST MODE
                </span>
              )}
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

        {/* Test mode quick actions */}
        {testMode && messages.length === 0 && !isLoading && (
          <div className="px-4 py-3 border-b border-border bg-amber-50/50 dark:bg-amber-950/20 flex-shrink-0">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-2">
              🔍 QA Tools — Scan this page
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleScanPage}
                disabled={isLoading}
                className="text-xs h-7 gap-1 border-amber-300 dark:border-amber-700"
              >
                <ScanSearch className="h-3 w-3" />
                Full Scan
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckFakeData}
                disabled={isLoading}
                className="text-xs h-7 gap-1 border-amber-300 dark:border-amber-700"
              >
                <Bug className="h-3 w-3" />
                Fake Data
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCodeReview}
                disabled={isLoading}
                className="text-xs h-7 gap-1 border-amber-300 dark:border-amber-700"
              >
                <FileCode className="h-3 w-3" />
                UX Review
              </Button>
            </div>
          </div>
        )}

        {/* Messages area */}
        <ScrollArea className="flex-1 overflow-hidden" ref={scrollRef as any}>
          <div className="px-4 py-3 space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="space-y-3 pt-4">
                <p className="text-sm text-muted-foreground text-center">
                  {testMode
                    ? 'I can scan this page for issues, check for fake data, review the UX, or answer any question about how this page works.'
                    : 'Ask me anything about your settlements, reconciliation, or Xero sync.'}
                </p>
                {testMode && (
                  <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium">What I can do in test mode:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>Scan for broken links & missing images</li>
                      <li>Detect fake/placeholder data</li>
                      <li>Check accessibility issues</li>
                      <li>Review page structure & UX</li>
                      <li>Identify console errors</li>
                      <li>Explain what any page element does</li>
                    </ul>
                  </div>
                )}
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
                {testMode ? 'Analyzing page...' : 'Thinking...'}
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
          {testMode && messages.length > 0 && (
            <div className="flex gap-1.5 mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleScanPage}
                disabled={isLoading}
                className="text-xs h-6 gap-1 px-2"
              >
                <ScanSearch className="h-3 w-3" />
                Re-scan
              </Button>
            </div>
          )}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex gap-2"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={testMode ? 'Ask about this page, scan for issues...' : 'Ask about your settlements...'}
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
  // Hide raw scan data from user messages for cleaner display
  const displayContent = isUser && message.content.includes('[PAGE SCAN REQUEST]')
    ? '🔍 Scanning page for issues...'
    : isUser && message.content.includes('[FAKE DATA CHECK]')
    ? '🔍 Checking for fake/placeholder data...'
    : isUser && message.content.includes('[CODE & UX REVIEW]')
    ? '🔍 Reviewing page code & UX...'
    : message.content;

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
          <p>{displayContent}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
