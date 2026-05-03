// src/lib/AuthContext.jsx — Supabase auth
import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { markReturningUser } from '@/lib/firstLaunch';

const AuthContext = createContext();

async function fetchProfile(authUser) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();
  return { id: authUser.id, email: authUser.email, ...(profile ?? {}) };
}

export function AuthProvider({ children }) {
  const [user,            setUser]            = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth,   setIsLoadingAuth]   = useState(true);
  const initialised = useRef(false);

  const loadProfile = useCallback(async (authUser) => {
    try {
      const merged = await fetchProfile(authUser);
      setUser(merged);
      setIsAuthenticated(true);
      markReturningUser();
    } catch {
      setUser({ id: authUser.id, email: authUser.email });
      setIsAuthenticated(true);
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    // Safety net: never block the UI longer than 8 seconds
    const timeout = setTimeout(() => setIsLoadingAuth(false), 8000);

    // onAuthStateChange fires immediately with INITIAL_SESSION — use it as the
    // single source of truth. No separate getSession() needed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        clearTimeout(timeout); // cancel safety net once we get a real response

        if (session?.user) {
          // Only call loadProfile on the first init or on explicit sign-in/out events.
          // TOKEN_REFRESHED fires silently and should not re-fetch the profile.
          if (!initialised.current || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
            initialised.current = true;
            await loadProfile(session.user);
          } else {
            initialised.current = true;
            setIsLoadingAuth(false);
          }
        } else {
          initialised.current = true;
          setUser(null);
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
        }
      }
    );

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const checkUserAuth = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) await loadProfile(authUser);
  }, [loadProfile]);

  const logout = useCallback((shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    supabase.auth.signOut().then(() => {
      if (shouldRedirect) window.location.href = '/';
    });
  }, []);

  const navigateToLogin = useCallback(() => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      // Kept for API compatibility with existing components
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: null,
      authChecked: !isLoadingAuth,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
