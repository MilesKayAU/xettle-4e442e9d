
import { useState } from 'react';
import { toast } from "@/hooks/use-toast";
import { useOpenAiKey } from "@/hooks/use-supabase-config";
import { Message, FAQ } from './types';
import { checkForDistributorKeywords, findMatchingFaq } from './utils';

interface UseMessageHandlerProps {
  faqs: FAQ[];
  onDistributorDetected: () => void;
  onAddMessage: (message: Message) => void;
}

export const useMessageHandler = ({ faqs, onDistributorDetected, onAddMessage }: UseMessageHandlerProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const { apiKey } = useOpenAiKey();

  const handleSendMessage = async (input: string, systemMessage: string, messages: Message[]) => {
    if (!input.trim()) return;
    
    const userMessage = { role: 'user' as const, content: input };
    onAddMessage(userMessage);
    setIsLoading(true);

    const isDistributorQuery = checkForDistributorKeywords(input);
    const matchingFaq = findMatchingFaq(input, faqs);
    
    try {
      // Handle FAQ responses quickly without API call
      if (matchingFaq) {
        setTimeout(() => {
          onAddMessage({ 
            role: 'assistant', 
            content: matchingFaq.answer
          });
          setIsLoading(false);
          
          // Add contextual links
          if (matchingFaq.answer.toLowerCase().includes('purchase') || 
              matchingFaq.answer.toLowerCase().includes('buy')) {
            onAddMessage({ 
              role: 'assistant', 
              content: "You can purchase our products directly from our official website:"
            });
          }
          
          if (matchingFaq.answer.toLowerCase().includes('distributor') || 
              matchingFaq.answer.toLowerCase().includes('wholesale')) {
            onAddMessage({ 
              role: 'assistant', 
              content: "For wholesale and distribution opportunities, please visit our distributor page:"
            });
          }
        }, 300); // Reduced delay for better UX
        
        return;
      }
      
      if (!apiKey) {
        toast({
          title: "API Key Required",
          description: "Please add your OpenAI API key in the Admin settings",
          variant: "destructive"
        });
        setIsLoading(false);
        return;
      }

      let enhancedSystemMessage = systemMessage;
      
      if (faqs && faqs.length > 0) {
        enhancedSystemMessage += "\n\nReference the following FAQs when answering questions:\n";
        faqs.forEach(faq => {
          enhancedSystemMessage += `Q: ${faq.question}\nA: ${faq.answer}\n\n`;
        });
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: 'system', content: enhancedSystemMessage },
            ...messages.filter(m => m.role !== 'system'),
            userMessage
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Failed to get response");
      }

      const data = await response.json();
      const assistantMessage = data.choices[0].message;
      
      onAddMessage(assistantMessage);

      if (isDistributorQuery) {
        setTimeout(() => {
          onDistributorDetected();
        }, 1000);
      }
    } catch (error) {
      console.error("Error in chat completion:", error);
      toast({
        title: "Chat Error",
        description: error instanceof Error ? error.message : "Failed to get response from AI",
        variant: "destructive"
      });
      
      onAddMessage({ 
        role: 'assistant', 
        content: "I'm sorry, I'm having trouble connecting right now. Please try again later or contact us directly."
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    handleSendMessage
  };
};
