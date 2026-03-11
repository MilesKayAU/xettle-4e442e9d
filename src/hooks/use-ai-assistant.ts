import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface UseAiAssistantOptions {
  context?: Record<string, any>;
}

export function useAiAssistant({ context }: UseAiAssistantOptions = {}) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageCount, setUsageCount] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadUsage = useCallback(async () => {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const { data } = await supabase
        .from('ai_usage' as any)
        .select('question_count')
        .eq('month', currentMonth)
        .maybeSingle();
      setUsageCount((data as any)?.question_count ?? 0);
    } catch {
      // silent
    }
  }, []);

  const sendMessage = useCallback(async (input: string) => {
    const userMsg: AiMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    let assistantContent = '';

    const upsertAssistant = (chunk: string) => {
      assistantContent += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
        }
        return [...prev, { role: 'assistant', content: assistantContent }];
      });
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError('Please log in first.');
        setIsLoading(false);
        return;
      }

      const allMessages = [...messages, userMsg];
      const controller = new AbortController();
      abortRef.current = controller;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            messages: allMessages.map(m => ({ role: m.role, content: m.content })),
            context,
          }),
          signal: controller.signal,
        }
      );

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        if (resp.status === 402) {
          setError(errBody.error || 'AI Assistant is a Pro feature.');
        } else if (resp.status === 429) {
          setError(errBody.error || 'Monthly question limit reached.');
          if (errBody.usage) setUsageCount(errBody.usage.used);
        } else {
          setError(errBody.error || 'Something went wrong.');
        }
        setIsLoading(false);
        return;
      }

      // Parse SSE stream
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsertAssistant(content);
          } catch {
            // partial JSON, put back
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Flush remaining
      if (buffer.trim()) {
        for (let raw of buffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsertAssistant(content);
          } catch { /* ignore */ }
        }
      }

      // Refresh usage count
      await loadUsage();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Connection failed.');
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [messages, context, loadUsage]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    usageCount,
    sendMessage,
    cancel,
    clearMessages,
    loadUsage,
  };
}
