
import { useState } from 'react';
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DistributorFormValues } from '@/components/distributor/distributor-form-schema';

export const useDistributorSubmission = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);

  const submitApplication = async (data: DistributorFormValues) => {
    setIsSubmitting(true);
    setSubmissionSuccess(false);
    
    try {
      console.log('Starting distributor application submission...');
      console.log('Form data:', data);
      
      // Create the submission data
      const submissionData = {
        full_name: data.fullName,
        company_name: data.companyName,
        email: data.email,
        phone: data.phone,
        message: data.message,
        status: 'new'
      };
      
      console.log('Submission data prepared:', submissionData);
      
      // Direct insert to distributor_inquiries table
      const { data: insertResult, error: insertError } = await supabase
        .from('distributor_inquiries')
        .insert([submissionData])
        .select();
      
      console.log('Insert result:', insertResult);
      console.log('Insert error:', insertError);
      
      if (insertError) {
        throw new Error(`Database error: ${insertError.message}`);
      }
      
      if (!insertResult || insertResult.length === 0) {
        throw new Error('No data returned from insert operation');
      }
      
      setSubmissionSuccess(true);
      
      toast({
        title: "Application Submitted Successfully",
        description: "Thank you for your interest! We'll review your application and contact you soon.",
      });
      
      return true;
      
    } catch (error: any) {
      console.error('Submission failed:', error);
      
      let errorMessage = "An unexpected error occurred. Please try again.";
      
      if (error.message.includes('row-level security')) {
        errorMessage = "Database permissions issue. Please contact support for assistance.";
      } else if (error.message.includes('duplicate')) {
        errorMessage = "An application with this email already exists.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Submission Failed",
        description: errorMessage,
        variant: "destructive",
      });
      
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isSubmitting,
    submissionSuccess,
    submitApplication
  };
};
