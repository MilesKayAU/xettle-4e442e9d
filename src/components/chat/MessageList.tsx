
import React from 'react';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Message } from './types';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
}

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading }) => {
  return (
    <div className="space-y-4">
      {messages.filter(m => m.role !== 'system').map((message, index) => (
        <div 
          key={index}
          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div 
            className={`rounded-lg px-4 py-2 max-w-[85%] ${
              message.role === 'user' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted'
            }`}
          >
            {message.content}
          </div>
        </div>
      ))}
      
      {messages.length > 3 && messages[messages.length - 1].role === 'assistant' && 
        messages[messages.length - 1].content.includes("purchase") && (
        <div className="flex justify-start mt-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs" 
            asChild
          >
            <a 
              href="https://www.mileskayaustralia.com" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              Shop at mileskayaustralia.com
            </a>
          </Button>
        </div>
      )}
      
      {messages.length > 3 && messages[messages.length - 1].role === 'assistant' && 
        messages[messages.length - 1].content.includes("distributor") && (
        <div className="flex justify-start mt-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs" 
            asChild
          >
            <Link to="/distributors">
              View Distributor Information
            </Link>
          </Button>
        </div>
      )}
      
      {isLoading && (
        <div className="flex justify-start">
          <div className="rounded-lg px-4 py-2 bg-muted flex items-center">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Typing...
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageList;
