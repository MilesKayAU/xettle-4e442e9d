
import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const RETRYABLE_AUTH_ERROR = /timeout|deadline|network|failed to fetch|request_timeout|unexpected_failure|context canceled|context deadline exceeded/i;

export function useAdminAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
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

      let lastError: any = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (!error) {
          toast({
            title: 'Signed In',
            description: 'Successfully authenticated.',
            variant: 'default',
          });
          return { success: true, data };
        }

        lastError = error;
        if (attempt === 0 && RETRYABLE_AUTH_ERROR.test(error.message || '')) {
          await new Promise((resolve) => setTimeout(resolve, 650));
          continue;
        }
      }

      toast({
        title: 'Authentication Failed',
        description: lastError?.message || 'Invalid credentials',
        variant: 'destructive',
      });
      return { success: false, error: lastError };
    } catch (error) {
      console.error('Exception during sign-in:', error);
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
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;

      setSession(null);
      setUser(null);
      setIsAuthenticated(false);

      toast({
        title: "Signed Out",
        description: "You have been signed out successfully",
      });
    } catch (error) {
      console.error("Error signing out:", error);
      toast({
        title: "Sign Out Failed",
        description: "Please try again.",
        variant: "destructive",
      });
    }
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
