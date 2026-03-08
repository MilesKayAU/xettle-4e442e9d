
import { useState, useEffect } from 'react';
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DistributorApplication } from '../types';

export const useDistributorApplications = () => {
  const [applications, setApplications] = useState<DistributorApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  useEffect(() => {
    fetchDistributorApplications();
  }, []);
  
  const fetchDistributorApplications = async () => {
    const loadingState = isRefreshing ? setIsRefreshing : setIsLoading;
    loadingState(true);
    try {
      console.log('=== FETCHING DISTRIBUTOR APPLICATIONS ===');
      
      // Check auth status first
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      console.log('Current session for fetch:', session);
      console.log('Session error for fetch:', sessionError);
      
      if (sessionError) {
        console.error('Session error:', sessionError);
        toast({
          title: 'Authentication Error',
          description: 'Please log in to view applications.',
          variant: 'destructive',
        });
        return;
      }
      
      console.log('Attempting to fetch distributor_inquiries...');
      
      const { data, error, count } = await supabase
        .from('distributor_inquiries')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });
      
      console.log('Fetch query result - data:', data);
      console.log('Fetch query result - error:', error);
      console.log('Fetch query result - count:', count);
      
      if (error) {
        console.error('=== FETCH ERROR DETAILS ===');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        console.error('Error details:', error.details);
        console.error('Full error object:', error);
        
        if (error.code === '42501' || error.message.includes('row-level security')) {
          toast({
            title: 'Access Denied',
            description: 'You do not have permission to view distributor applications. Please contact an administrator.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Error',
            description: `Failed to load distributor applications: ${error.message}`,
            variant: 'destructive',
          });
        }
        return;
      }
      
      console.log('Applications data received:', data);
      console.log('Number of applications found:', data?.length || 0);
      
      if (data) {
        const formattedData = data.map(app => ({
          ...app,
          date: new Date(app.created_at).toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
          })
        }));
        
        setApplications(formattedData);
        console.log('Applications set in state:', formattedData.length);
        console.log('Formatted applications:', formattedData);
        
        if (formattedData.length === 0) {
          console.log('No distributor applications found');
        } else {
          console.log(`Successfully loaded ${formattedData.length} applications`);
        }
      } else {
        console.log('No data returned from query');
        setApplications([]);
      }
    } catch (err) {
      console.error('=== EXCEPTION FETCHING APPLICATIONS ===');
      console.error('Exception type:', typeof err);
      console.error('Exception message:', err);
      console.error('Exception stack:', (err as Error).stack);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred while fetching applications.',
        variant: 'destructive',
      });
    } finally {
      loadingState(false);
      console.log('=== FETCH APPLICATIONS END ===');
    }
  };
  
  const handleStatusChange = async (id: string, status: string) => {
    try {
      console.log(`=== UPDATING STATUS FOR ${id} TO ${status} ===`);
      
      const { error } = await supabase
        .from('distributor_inquiries')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
        
      if (error) {
        console.error('Status update error:', error);
        throw error;
      }
      
      console.log('Status update successful');
      
      setApplications(prevApps =>
        prevApps.map(app =>
          app.id === id ? { ...app, status } : app
        )
      );
      
      toast({
        title: `Application ${status}`,
        description: `The distributor application has been ${status}.`,
      });
    } catch (error: any) {
      console.error('Error updating status:', error);
      toast({
        title: 'Update Failed',
        description: `Failed to update application status: ${error.message}`,
        variant: 'destructive',
      });
    }
  };

  const handleRefresh = () => {
    console.log('Manual refresh triggered');
    fetchDistributorApplications();
  };

  return {
    applications,
    isLoading,
    isRefreshing,
    handleStatusChange,
    handleRefresh
  };
};
