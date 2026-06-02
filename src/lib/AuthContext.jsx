// src/lib/AuthContext.jsx — Supabase auth
import React, { createContext, useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { markReturningUser } from '@/lib/firstLaunch';
import { unsubscribePushOnLogout } from '@/lib/pushCleanup';

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

    // Capture timezone offset so the streak-break reminder cron (migration
    // 035) can nudge users in THEIR local evening, not the server's UTC.
    // We do this every bootstrap (cheap RPC, idempotent) so travellers
    // whose tz changed mid-trip get nudged at the right hour. Fire-and-
    // forget: if the RPC doesn't exist yet (pre-migration deploy) we
    // silently no-op — the server defaults to NULL = no nudges for that
    // user, which is the safe behavior.
    try {
      // Date.getTimezoneOffset() returns MINUTES WEST of UTC (positive
      // for the Americas) — invert it to "minutes east" which is what
      // the SQL function expects so it can simply ADD the offset.
      const offsetMinutes = -new Date().getTimezoneOffset();
      if (Number.isInteger(offsetMinutes)) {
        supabase.rpc('update_user_timezone_offset', {
          p_offset_minutes: offsetMinutes,
        }).then(
          ({ error }) => {
            // RPC may resolve with an error object instead of throwing
            // (Supabase pattern). Pre-035 hosts return 42883 which we
            // swallow; everything else routes to Sentry so a real
            // regression doesn't sit silent and break streak nudges.
            if (error && error.code !== '42883' && error.code !== '42P01') {
              import('./reportError').then(({ reportError }) => {
                reportError(error, {
                  feature: 'auth.timezoneCapture',
                  level: 'warning',
                  userId: authUser?.id,
                });
              }).catch(() => {});
            }
          },
          (err) => {
            // Network-level failure — also worth surfacing.
            import('./reportError').then(({ reportError }) => {
              reportError(err, {
                feature: 'auth.timezoneCapture',
                level: 'warning',
                userId: authUser?.id,
              });
            }).catch(() => {});
          },
        );
      }
    } catch (err) {
      // Synchronous failure in the offset math itself shouldn't break
      // auth, but log it so we know if Date.getTimezoneOffset ever
      // throws in some embedded webview.
      try {
        import('./reportError').then(({ reportError }) => {
          reportError(err, { feature: 'auth.timezoneCapture.sync', level: 'warning' });
        }).catch(() => {});
      } catch { /* last-resort silence */ }
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

          // Auto-claim referral code if one was captured pre-signup. The
          // claim RPC is idempotent — already-claimed returns 'already_
          // claimed' which we silently swallow on TOKEN_REFRESHED events.
          // The first successful claim writes to the audit table + fires
          // BOTH parties' celebration notifications.
          if (event === 'SIGNED_IN') {
            setTimeout(async () => {
              try {
                const { consumePendingReferralCode } = await import('./data/referrals');
                const { claimReferral } = await import('./data/referrals');
                const pending = consumePendingReferralCode();
                if (pending) {
                  const res = await claimReferral(pending);
                  if (res?.ok) {
                    const { toast } = await import('sonner');
                    toast.success(`Welcome! +200 coins and an Elite capsule are yours.`);
                  }
                  // Silent on failure — already-claimed / self-referral
                  // shouldn't pop a toast. The RPC's error paths are all
                  // expected outcomes, not crashes.
                }
              } catch (err) {
                console.warn('[auth] referral claim error:', err?.message || err);
              }
            }, 500); // small delay to let profile load complete first
          }
          // Magic-link / OAuth callbacks land at /something#access_token=…&refresh_token=…
          // After Supabase parses + stores the session, the tokens linger in
          // window.location.hash — visible in the browser address bar, kept
          // in the back/forward history stack, and captured in any
          // screenshot/screen-share. Strip the hash on SIGNED_IN so the
          // tokens stop being a leak surface. Guard against typeof window
          // for SSR safety, and only strip if the hash actually looks like
          // an auth payload so we don't disturb legitimate page anchors.
          try {
            if (typeof window !== 'undefined' && /[#&](access_token|refresh_token|provider_token|expires_in)=/.test(window.location.hash)) {
              const clean = window.location.pathname + window.location.search;
              window.history.replaceState({}, document.title, clean);
            }
          } catch { /* non-fatal */ }
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
      // Optional-chained unsubscribe — onAuthStateChange has historically
      // returned `{ data: { subscription } }` reliably, but a future
      // supabase-js shape change or an HMR-induced partial init would
      // crash unmount otherwise. The cleanup running on every dep
      // change makes this matter more than a typical mount-only effect.
      try { subscription?.unsubscribe?.(); } catch { /* tolerate */ }
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
  //
  // The handler is parked in a ref + the listener registers ONCE for the
  // life of the component. Reasoning: the effect's [checkUserAuth] dep
  // means a future change in the useCallback chain (loadProfile or
  // checkUserAuth dropping their memoization) would cause the effect to
  // re-run on every render, registering a fresh listener and removing
  // the prior one — under normal flow it's net-zero, but a hot-reload
  // OR a fast-fire of the event between cleanup and re-registration
  // could miss notifications OR (worse, in HMR) double-register if
  // cleanup fails to fire. Pinning the handler reference + a one-shot
  // mount removes that whole class of risk.
  const checkUserAuthRef = useRef(checkUserAuth);
  useEffect(() => { checkUserAuthRef.current = checkUserAuth; }, [checkUserAuth]);
  useEffect(() => {
    const handler = () => { checkUserAuthRef.current?.().catch(() => {}); };
    window.addEventListener('flexyn:loot-equipped', handler);
    window.addEventListener('flexyn:theme-changed', handler);
    return () => {
      window.removeEventListener('flexyn:loot-equipped', handler);
      window.removeEventListener('flexyn:theme-changed', handler);
    };
  }, []);

  const logout = useCallback(async (shouldRedirect = true) => {
    // Privacy: drop this device's push subscription BEFORE signOut so
    // the next user on the same device doesn't inherit pushes. See
    // src/lib/pushCleanup.js for the rationale.
    await unsubscribePushOnLogout();

    setUser(null);
    setIsAuthenticated(false);
    try {
      await supabase.auth.signOut();
    } finally {
      if (shouldRedirect) window.location.href = '/';
    }
  }, []);

  const navigateToLogin = useCallback(() => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }, []);

  // Memoize the context value — see ThemeContext for the rationale.
  // useAuth() is consumed by ~every authenticated component in the app;
  // an unmemoized value here re-renders the whole UI on any AuthProvider
  // re-render (which happens on every Supabase auth-event tick).
  const value = useMemo(() => ({
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
  }), [user, isAuthenticated, isLoadingAuth, logout, navigateToLogin, checkUserAuth]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
