
import { useState } from 'react';
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DistributorFormValues } from '@/components/distributor/distributor-form-schema';

export const useDistributorForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);

  const handleSubmit = async (data: DistributorFormValues) => {
    setIsSubmitting(true);
    setSubmissionSuccess(false);
    
    try {
      console.log('=== DISTRIBUTOR FORM SUBMISSION START ===');
      console.log('Form data received:', data);
      
      // Test connection first
      console.log('Testing Supabase connection...');
      const { data: connectionTest, error: connectionError } = await supabase
        .from('distributor_inquiries')
        .select('id')
        .limit(1);
      
      console.log('Connection test result:', { connectionTest, connectionError });
      
      if (connectionError) {
        console.error('Connection test failed:', connectionError);
        throw new Error(`Connection failed: ${connectionError.message}`);
      }
      
      // Check current session
      console.log('Checking current session...');
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      console.log('Current session:', session);
      console.log('Session error:', sessionError);
      
      const insertData = {
        full_name: data.fullName.trim(),
        company_name: data.companyName.trim(),
        email: data.email.toLowerCase().trim(),
        phone: data.phone.trim(),
        message: data.message.trim(),
        status: 'new'
      };
      
      console.log('Prepared insert data:', insertData);
      console.log('About to insert into distributor_inquiries table...');
      
      const { data: result, error } = await supabase
        .from('distributor_inquiries')
        .insert([insertData])
        .select();
      
      console.log('Insert operation completed');
      console.log('Insert result:', result);
      console.log('Insert error:', error);
      
      if (error) {
        console.error('=== DATABASE ERROR DETAILS ===');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Error details:', error.details);
        console.error('Error hint:', error.hint);
        console.error('Full error object:', error);
        
        // More specific error handling
        if (error.code === '42501') {
          throw new Error('Permission denied - RLS policy blocking insertion');
        } else if (error.code === '23505') {
          throw new Error('Duplicate entry detected');
        } else if (error.code === '23514') {
          throw new Error('Data validation failed');
        } else {
          throw new Error(`Database error (${error.code}): ${error.message}`);
        }
      }
      
      if (!result || result.length === 0) {
        console.error('No result returned from insert operation');
        throw new Error('Insert operation completed but no data was returned');
      }
      
      console.log('=== SUBMISSION SUCCESSFUL ===');
      console.log('Inserted record:', result[0]);
      setSubmissionSuccess(true);
      
      toast({
        title: "Application Submitted",
        description: "Thank you for your interest! We'll review your application and contact you soon.",
        variant: "default",
      });
      
    } catch (error: any) {
      console.error('=== FORM SUBMISSION ERROR ===');
      console.error('Error type:', typeof error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Full error object:', error);
      
      toast({
        title: "Submission Failed",
        description: `Error: ${error.message}. Please check the console for details.`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      console.log('=== FORM SUBMISSION END ===');
    }
  };

  return {
    isSubmitting,
    submissionSuccess,
    handleSubmit
  };
};
