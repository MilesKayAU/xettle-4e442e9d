
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import LoadingSpinner from "@/components/ui/loading-spinner";
import { User, Building2, Mail, Phone, FileText, Send, CheckCircle2 } from 'lucide-react';
import { distributorFormSchema, DistributorFormValues } from './distributor-form-schema';

interface DistributorApplicationFormProps {
  isSubmitting: boolean;
  submissionSuccess: boolean;
  onSubmit: (data: DistributorFormValues) => void;
}

const DistributorApplicationForm: React.FC<DistributorApplicationFormProps> = ({
  isSubmitting,
  submissionSuccess,
  onSubmit
}) => {
  const form = useForm<DistributorFormValues>({
    resolver: zodResolver(distributorFormSchema),
    defaultValues: {
      fullName: "",
      companyName: "",
      email: "",
      phone: "",
      message: "",
    },
  });

  return (
    <div className="bg-card p-6 rounded-lg shadow-sm border">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-10" placeholder="John Doe" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-10" placeholder="Your Company Ltd" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-10" type="email" placeholder="email@example.com" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-10" placeholder="+1 (123) 456-7890" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Additional Information</FormLabel>
                <FormControl>
                  <div className="relative">
                    <FileText className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Textarea 
                      className="pl-10 min-h-[120px]" 
                      placeholder="Tell us about your business, areas of operation, and why you're interested in becoming a distributor."
                      {...field} 
                    />
                  </div>
                </FormControl>
                <FormDescription>
                  Please provide any relevant information about your business and distribution capabilities.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <Button type="submit" className="w-full" disabled={isSubmitting || submissionSuccess}>
            {isSubmitting ? (
              <LoadingSpinner size="sm" text="Submitting Application..." />
            ) : submissionSuccess ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Submitted Successfully
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Submit Application
              </>
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
};

export default DistributorApplicationForm;
