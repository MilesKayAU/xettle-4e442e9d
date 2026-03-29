import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isPro: boolean;
  isAdmin: boolean;
  isStarter: boolean;
  isTrial: boolean;
  /** Convenience: true if any paid/trial role */
  hasAccess: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  isPro: false,
  isAdmin: false,
  isStarter: false,
  isTrial: false,
  hasAccess: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<{ isPro: boolean; isAdmin: boolean; isStarter: boolean; isTrial: boolean }>({
    isPro: false, isAdmin: false, isStarter: false, isTrial: false,
  });

  const fetchRoles = useCallback(async () => {
    const [proRes, adminRes, starterRes, trialRes] = await Promise.all([
      supabase.rpc('has_role', { _role: 'pro' }),
      supabase.rpc('has_role', { _role: 'admin' }),
      supabase.rpc('has_role', { _role: 'starter' }),
      supabase.rpc('has_role', { _role: 'trial' }),
    ]);
    setRoles({
      isPro: !!proRes.data,
      isAdmin: !!adminRes.data,
      isStarter: !!starterRes.data,
      isTrial: !!trialRes.data,
    });
  }, []);

  useEffect(() => {
    // Single getSession call on mount — no getUser() race
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.user) fetchRoles();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.user) fetchRoles();
      else setRoles({ isPro: false, isAdmin: false, isStarter: false, isTrial: false });
    });

    return () => subscription.unsubscribe();
  }, [fetchRoles]);

  const value = useMemo<AuthState>(() => ({
    user,
    session,
    loading,
    ...roles,
    hasAccess: roles.isPro || roles.isAdmin || roles.isStarter || roles.isTrial,
  }), [user, session, loading, roles]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
