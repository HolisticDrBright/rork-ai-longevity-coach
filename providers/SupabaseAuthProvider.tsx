import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import { authService } from '@/lib/supabaseService';
import type { Session, User } from '@supabase/supabase-js';

export const [SupabaseAuthProvider, useSupabaseAuth] = createContextHook(() => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    console.log('[SupabaseAuth] Initializing...');

    void supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      console.log('[SupabaseAuth] Initial session:', currentSession ? 'exists' : 'none');
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setIsAuthenticated(!!currentSession);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      console.log('[SupabaseAuth] Auth state changed:', _event);
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setIsAuthenticated(!!newSession);
      setAuthError(null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    });
    return () => subscription.remove();
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    const result = await authService.signUp(email, password);
    if (result.error) {
      setAuthError(result.error);
      return false;
    }
    return true;
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    const result = await authService.signIn(email, password);
    if (result.error) {
      setAuthError(result.error);
      return false;
    }
    return true;
  }, []);

  const signInWithMagicLink = useCallback(async (email: string): Promise<boolean> => {
    setAuthError(null);
    const result = await authService.signInWithMagicLink(email);
    if (result.error) {
      setAuthError(result.error);
      return false;
    }
    return true;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    console.log('[SupabaseAuth] Signing out...');
    await authService.signOut();
    setSession(null);
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    setAuthError(null);
    const result = await authService.resetPassword(email);
    if (result.error) {
      setAuthError(result.error);
      return false;
    }
    return true;
  }, []);

  const clearError = useCallback(() => {
    setAuthError(null);
  }, []);

  return useMemo(() => ({
    session,
    user,
    userId: user?.id ?? null,
    isLoading,
    isAuthenticated,
    authError,
    signUp,
    signIn,
    signInWithMagicLink,
    signOut,
    resetPassword,
    clearError,
  }), [session, user, isLoading, isAuthenticated, authError, signUp, signIn, signInWithMagicLink, signOut, resetPassword, clearError]);
});
