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
  const receivedAuthEventRef = useRef(false);

  useEffect(() => {
    // Remount-safe: subscription is re-created on every effect run and torn
    // down in cleanup (no permanent "initialized" latch).
    let isMounted = true;
    receivedAuthEventRef.current = false;

    console.log('[SupabaseAuth] Initializing...');

    supabase.auth
      .getSession()
      .then(({ data: { session: currentSession } }) => {
        // If an onAuthStateChange event already delivered a session, the
        // initial getSession result is stale — ignore it.
        if (!isMounted || receivedAuthEventRef.current) return;
        console.log('[SupabaseAuth] Initial session:', currentSession ? 'exists' : 'none');
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setIsAuthenticated(!!currentSession);
        setIsLoading(false);
      })
      .catch((e: unknown) => {
        console.log('[SupabaseAuth] getSession failed:', e instanceof Error ? e.message : 'unknown error');
        if (isMounted && !receivedAuthEventRef.current) {
          setIsLoading(false);
        }
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      receivedAuthEventRef.current = true;
      if (!isMounted) return;
      console.log('[SupabaseAuth] Auth state changed:', _event);
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setIsAuthenticated(!!newSession);
      setAuthError(null);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
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
