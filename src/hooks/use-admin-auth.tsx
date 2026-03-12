
import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export function useAdminAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setIsAuthenticated(!!session);
      }
    );

    checkSession();

    return () => subscription.unsubscribe();
  }, []);

  async function checkSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      setSession(session);
      setUser(session?.user ?? null);
      setIsAuthenticated(!!session);
    } catch (error) {
      console.error("Error checking auth session:", error);
    } finally {
      setIsLoading(false);
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast({
          title: 'Authentication Failed',
          description: error.message || 'Invalid credentials',
          variant: 'destructive',
        });
        return { success: false, error };
      }
      
      toast({
        title: 'Signed In',
        description: 'Successfully authenticated.',
        variant: 'default',
      });
      
      return { success: true, data };
    } catch (error) {
      console.error('Exception during Supabase sign-in:', error);
      toast({
        title: 'Authentication Error',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      });
      return { success: false, error };
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    // Clear state immediately for instant UI feedback
    setSession(null);
    setUser(null);
    setIsAuthenticated(false);
    
    toast({
      title: "Signed Out",
      description: "You have been signed out successfully",
    });

    // Fire-and-forget the actual sign out
    supabase.auth.signOut().catch((error) => {
      console.error("Error signing out:", error);
    });
  };

  return {
    isAuthenticated,
    setIsAuthenticated,
    isLoading,
    session,
    user,
    handleSignOut,
    signIn
  };
}
