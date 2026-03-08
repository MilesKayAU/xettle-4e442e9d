
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Send, X, Loader2 } from "lucide-react";
import { useChatMessenger } from './chat/useChatMessenger';
import MessageList from './chat/MessageList';
import LeadForm from './chat/LeadForm';

const ChatMessenger: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  
  const {
    messages,
    isLoading,
    showLeadForm,
    leadInfo,
    setLeadInfo,
    setShowLeadForm,
    handleSendMessage,
    handleLeadSubmit
  } = useChatMessenger();

  // Optimize mounting check
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Optimize scroll behavior with useMemo to prevent unnecessary scrolls
  const shouldScroll = useMemo(() => messages.length > 0, [messages.length]);

  useEffect(() => {
    if (shouldScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [shouldScroll]);

  // Memoize the send message handler to prevent recreating on every render
  const onSendMessage = useMemo(() => async () => {
    if (!input.trim() || isLoading) return;
    await handleSendMessage(input);
    setInput('');
  }, [input, isLoading, handleSendMessage]);

  const handleKeyPress = useMemo(() => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  }, [onSendMessage]);

  // Don't render until mounted to prevent hydration issues
  if (!isMounted) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button 
            variant="default" 
            size="icon" 
            className="h-16 w-16 rounded-full shadow-lg bg-primary hover:bg-primary/90 transition-opacity duration-500"
            aria-label="Open chat"
            style={{ 
              position: 'fixed',
              bottom: '24px', 
              right: '24px',
              zIndex: 1000,
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
            }}
          >
            <MessageCircle className="h-8 w-8" />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-80 sm:w-96 p-0 h-[500px] flex flex-col"
          side="top"
          align="end"
          style={{ zIndex: 1001 }}
        >
          <div className="bg-primary p-3 text-primary-foreground flex justify-between items-center">
            <h3 className="font-medium">Miles Kay Distributor Assistant</h3>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-primary-foreground hover:bg-primary/80"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <ScrollArea className="flex-1 p-4">
            <MessageList messages={messages} isLoading={isLoading} />
            
            {showLeadForm && (
              <LeadForm
                leadInfo={leadInfo}
                setLeadInfo={setLeadInfo}
                onSubmit={handleLeadSubmit}
                onCancel={() => setShowLeadForm(false)}
                isLoading={isLoading}
              />
            )}
            
            <div ref={messagesEndRef} />
          </ScrollArea>
          
          <div className="border-t p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              className="min-h-[60px] resize-none"
              onKeyDown={handleKeyPress}
              disabled={isLoading}
            />
            <Button 
              onClick={onSendMessage} 
              disabled={!input.trim() || isLoading} 
              className="self-end"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default ChatMessenger;
