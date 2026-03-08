
import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { User, Mail, Building2, Loader2 } from "lucide-react";
import { LeadInfo } from './types';

interface LeadFormProps {
  leadInfo: LeadInfo;
  setLeadInfo: (leadInfo: LeadInfo) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

const LeadForm: React.FC<LeadFormProps> = ({
  leadInfo,
  setLeadInfo,
  onSubmit,
  onCancel,
  isLoading
}) => {
  return (
    <div className="flex justify-start">
      <div className="rounded-lg px-4 py-4 bg-muted w-full">
        <h4 className="font-medium mb-3">
          {leadInfo.isDistributor 
            ? "Interested in becoming a distributor?" 
            : "Leave your contact information"}
        </h4>
        <p className="text-sm mb-3">Please share your details and we'll get back to you:</p>
        <div className="space-y-3">
          <div className="relative">
            <User className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Your Name *" 
              className="pl-8"
              value={leadInfo.name}
              onChange={(e) => setLeadInfo({ ...leadInfo, name: e.target.value })}
            />
          </div>
          <div className="relative">
            <Mail className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              type="email"
              placeholder="Your Email *" 
              className="pl-8"
              value={leadInfo.email}
              onChange={(e) => setLeadInfo({ ...leadInfo, email: e.target.value })}
            />
          </div>
          {leadInfo.isDistributor && (
            <div className="relative">
              <Building2 className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Company Name" 
                className="pl-8"
                value={leadInfo.company}
                onChange={(e) => setLeadInfo({ ...leadInfo, company: e.target.value })}
              />
            </div>
          )}
          <Input
            placeholder="Your Region/Country" 
            value={leadInfo.region}
            onChange={(e) => setLeadInfo({ ...leadInfo, region: e.target.value })}
          />
          <div className="flex space-x-2">
            <Button 
              onClick={onSubmit} 
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
            </Button>
            <Button 
              variant="outline" 
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeadForm;
