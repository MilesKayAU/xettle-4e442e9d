
import { useState, useEffect } from 'react';
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DistributorApplication } from '../types';

export const useDistributorData = () => {
  const [applications, setApplications] = useState<DistributorApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  useEffect(() => {
    loadApplications();
  }, []);
  
  const loadApplications = async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    
    try {
      console.log('Loading distributor applications...');
      
      // Check Supabase session
      const { data: session } = await supabase.auth.getSession();
      console.log('Current Supabase session:', session);
      
      if (!session?.session) {
        console.log('No active session, attempting to sign in...');
        
        // Try to sign in with stored admin credentials
        const adminEmail = localStorage.getItem('adminEmail') || 'admin@mileskayaustralia.com';
        const adminPassword = localStorage.getItem('adminPassword') || 'J@red12345';
        
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: adminEmail,
          password: adminPassword,
        });
        
        if (signInError) {
          console.error('Failed to authenticate:', signInError);
          toast({
            title: 'Authentication Required',
            description: 'Please log in to view distributor applications.',
            variant: 'destructive',
          });
          setApplications([]);
          return;
        }
        
        console.log('Authentication successful:', signInData);
      }
      
      // Now query the distributor_inquiries table
      console.log('Querying distributor_inquiries table...');
      const { data, error } = await supabase
        .from('distributor_inquiries')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Query error:', error);
        toast({
          title: 'Database Error',
          description: `Failed to load applications: ${error.message}`,
          variant: 'destructive',
        });
        setApplications([]);
      } else {
        console.log('Data loaded successfully:', data);
        setApplications(formatApplications(data || []));
        
        if (isManualRefresh && data) {
          toast({
            title: 'Refreshed',
            description: `Loaded ${data.length} applications`,
            variant: 'default',
          });
        }
      }
      
    } catch (err) {
      console.error('Unexpected error:', err);
      toast({
        title: 'Error',
        description: 'Failed to load applications',
        variant: 'destructive',
      });
      setApplications([]);
    } finally {
      if (isManualRefresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  };
  
  const formatApplications = (data: any[]): DistributorApplication[] => {
    return data.map(app => ({
      ...app,
      date: new Date(app.created_at).toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      })
    }));
  };
  
  const updateStatus = async (id: string, status: string) => {
    try {
      console.log(`Updating status for ${id} to ${status}`);
      
      const { error } = await supabase
        .from('distributor_inquiries')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
        
      if (error) {
        throw error;
      }
      
      setApplications(prev =>
        prev.map(app =>
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
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const refresh = () => {
    console.log('Manual refresh triggered');
    loadApplications(true);
  };

  return {
    applications,
    isLoading,
    isRefreshing,
    updateStatus,
    refresh
  };
};
