// src/lib/AuthContext.jsx — Supabase auth
import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
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
    // Safety net: never block UI longer than 10 seconds
    const timeout = setTimeout(() => setIsLoadingAuth(false), 10000);

    // 1. Bootstrap immediately from stored session (localStorage, no network)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadProfile(session.user).finally(() => clearTimeout(timeout));
      } else {
        clearTimeout(timeout);
        setIsLoadingAuth(false);
      }
    });

    // 2. Keep in sync with auth events (OAuth redirect, sign-out, token refresh).
    //    IMPORTANT: callback must be synchronous — defer async work with setTimeout.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          // Defer so Supabase's internal auth state settles first
          setTimeout(() => loadProfile(session.user), 0);
        }
      } else if (event === 'SIGNED_OUT') {
        setTimeout(() => {
          setUser(null);
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
        }, 0);
      }
      // INITIAL_SESSION is handled by getSession() above — skip it here
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const checkUserAuth = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) await loadProfile(authUser);
  }, [loadProfile]);

  // App-wide refresh on cosmetic equip / theme change. Previously this lived
  // inside HubProfile, so equipping in the Bag from any non-profile screen
  // (Header, sidebar, Dashboard) left `useAuth().user` stale — the sidebar
  // avatar wouldn't pick up a freshly equipped frame until the next page
  // navigation. Mounting the listener here means every consumer of useAuth
  // gets the fresh row immediately after equip.
  useEffect(() => {
    const handler = () => { checkUserAuth().catch(() => {}); };
    window.addEventListener('flexyn:loot-equipped', handler);
    window.addEventListener('flexyn:theme-changed', handler);
    return () => {
      window.removeEventListener('flexyn:loot-equipped', handler);
      window.removeEventListener('flexyn:theme-changed', handler);
    };
  }, [checkUserAuth]);

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
      isLoadingPublicSettings: false,
      authError: (!isLoadingAuth && !isAuthenticated) ? { type: 'auth_required' } : null,
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
