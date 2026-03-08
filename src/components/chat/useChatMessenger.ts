
import { useState, useCallback } from 'react';
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Message, LeadInfo } from './types';
import { useFaqLoader } from './useFaqLoader';
import { useMessageHandler } from './useMessageHandler';

const INITIAL_SYSTEM_MESSAGE = `You are a helpful assistant for Miles Kay Australia. Your role is to provide information about the company and its products. 

Important guidelines:
1. For consumers: Inform them they can purchase directly from www.mileskayaustralia.com or through our distributors like Bunnings, Kogan, and Amazon.
2. If a user asks about wholesale, bulk orders or becoming a distributor, identify them as a potential distributor and trigger the lead form.
3. Keep responses concise and friendly.
4. Always try to determine early if the user is a regular consumer or a potential distributor/wholesaler by asking if appropriate.
5. For wholesale inquiries, mention our distributor application process and direct them to the /distributors page.`;

const INITIAL_ASSISTANT_MESSAGE = 'Hello! I\'m the Miles Kay assistant. How can I help you with our products today? Are you looking to purchase for yourself or are you interested in wholesale/distribution opportunities?';

export const useChatMessenger = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: INITIAL_SYSTEM_MESSAGE },
    { role: 'assistant', content: INITIAL_ASSISTANT_MESSAGE }
  ]);
  
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadInfo, setLeadInfo] = useState<LeadInfo>({
    name: '',
    email: '',
    region: '',
    company: '',
    isDistributor: false
  });

  const { faqs } = useFaqLoader();

  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const handleDistributorDetected = useCallback(() => {
    setLeadInfo(prev => ({...prev, isDistributor: true}));
    setShowLeadForm(true);
  }, []);

  const { isLoading, handleSendMessage: sendMessage } = useMessageHandler({
    faqs,
    onDistributorDetected: handleDistributorDetected,
    onAddMessage: addMessage
  });

  const handleSendMessage = useCallback(async (input: string) => {
    await sendMessage(input, INITIAL_SYSTEM_MESSAGE, messages);
  }, [sendMessage, messages]);

  const handleLeadSubmit = useCallback(async () => {
    if (!leadInfo.name || !leadInfo.email) {
      toast({
        title: "Information Required",
        description: "Please provide at least your name and email",
        variant: "destructive"
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('distributor_inquiries')
        .insert({
          full_name: leadInfo.name,
          email: leadInfo.email.toLowerCase().trim(),
          region: leadInfo.region,
          company_name: leadInfo.company || null,
          status: leadInfo.isDistributor ? 'distributor_lead' : 'chat_lead',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (error) throw error;
      
      setShowLeadForm(false);
      
      let confirmationMessage = "Thank you for your information! ";
      
      if (leadInfo.isDistributor) {
        confirmationMessage += "Our team will contact you soon about distribution opportunities. You can also visit our distributor page for more information at /distributors";
        
        setTimeout(() => {
          addMessage({ 
            role: 'assistant', 
            content: "Here's a direct link to our distributor application page where you can find more information:"
          });
        }, 1000);
      } else {
        confirmationMessage += "We'll be in touch soon!";
      }
      
      addMessage({ 
        role: 'assistant', 
        content: confirmationMessage
      });

      setLeadInfo({
        name: '',
        email: '',
        region: '',
        company: '',
        isDistributor: false
      });

      toast({
        title: "Information Received",
        description: "Thank you! Our team will contact you soon.",
      });
    } catch (error) {
      console.error("Error submitting lead info:", error);
      toast({
        title: "Submission Failed",
        description: "There was an error saving your information. Please try again or contact us directly.",
        variant: "destructive"
      });
    }
  }, [leadInfo, addMessage]);

  return {
    messages,
    isLoading,
    showLeadForm,
    leadInfo,
    setLeadInfo,
    setShowLeadForm,
    handleSendMessage,
    handleLeadSubmit
  };
};
