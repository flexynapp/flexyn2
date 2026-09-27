// src/lib/AuthContext.jsx — Supabase auth
import React, { createContext, useState, useContext, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { markReturningUser } from '@/lib/firstLaunch';
import { unsubscribePushOnLogout } from '@/lib/pushCleanup';
import { identify, resetAnalytics, track, EVENTS } from '@/lib/analytics';
import { isNative } from '@/lib/native';
import { getTranslation } from '@/lib/i18n';
import { toast } from '@/lib/toast';

const AuthContext = createContext();

// The native deep-link failure toast. AuthProvider sits inside
// LanguageProvider but cannot import it: LanguageContext imports db.js, whose
// module-scope auth listener would then ride along into every test that
// renders AuthProvider. getTranslation reads the same loaded catalogs, and
// <html lang> is what LanguageProvider sets. A key that comes back as itself
// is a miss (see the NEVER `t(key) || 'English'` rule), so English is used.
const NATIVE_AUTH_FAILED_KEY = 'nativeAuth.callbackFailed';
const NATIVE_AUTH_FAILED_EN = 'Sign in did not finish. Try again.';
function nativeAuthFailedMessage() {
  try {
    const lang = document.documentElement.lang || 'en';
    const v = getTranslation(lang, NATIVE_AUTH_FAILED_KEY);
    return v && v !== NATIVE_AUTH_FAILED_KEY ? v : NATIVE_AUTH_FAILED_EN;
  } catch {
    return NATIVE_AUTH_FAILED_EN;
  }
}

// A failed read used to be ignored and returned { id, email } alone, which
// has no onboarding flag and no username, so App.jsx routed a fully
// onboarded user into Onboarding on a network blip, and its final save
// could overwrite their real answers. A missing row (data null, no error)
// is still a new user; an ERROR is retried once and then thrown.
async function fetchProfile(authUser) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();
    if (!error) return { id: authUser.id, email: authUser.email, ...(profile ?? {}), is_anonymous: !!authUser.is_anonymous };
    lastError = error;
  }
  throw lastError;
}


// Analytics for a SIGNED_IN event. supabase-js also emits SIGNED_IN when a
// tab regains focus, so this counts once per browser session per account.
// "Signed up" means the account was created in the last ten minutes, which
// is the magic-link, OAuth and guest paths alike landing here for the first
// time; everything else is a returning sign-in.
function trackSignIn(authUser) {
  if (!authUser?.id) return;
  identify(authUser.id, { isGuest: authUser.is_anonymous });
  const flag = `flexyn.analytics.signedIn.${authUser.id}`;
  try {
    if (sessionStorage.getItem(flag)) return;
    sessionStorage.setItem(flag, '1');
  } catch { /* storage blocked: count it anyway */ }
  const createdMs = Date.parse(authUser.created_at || '');
  const isNew = Number.isFinite(createdMs) && Date.now() - createdMs < 10 * 60 * 1000;
  const method = authUser.is_anonymous ? 'guest' : (authUser.app_metadata?.provider || 'email');
  track(isNew ? EVENTS.SIGNED_UP : EVENTS.SIGNED_IN, { method });
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
      // Keep a profile already loaded for this account (a refresh on tab
      // focus failing must not blank the app). Otherwise flag the failure
      // so App.jsx offers a retry instead of treating the user as new.
      setUser(prev => (prev?.id === authUser.id && !prev.profileLoadFailed
        ? prev
        : { id: authUser.id, email: authUser.email, profileLoadFailed: true }));
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
        identify(session.user.id, { isGuest: session.user.is_anonymous });
        loadProfile(session.user).finally(() => clearTimeout(timeout));
      } else {
        clearTimeout(timeout);
        setIsLoadingAuth(false);
      }
    });

    // 2. Keep in sync with auth events (OAuth redirect, sign-out, token refresh).
    //    IMPORTANT: callback must be synchronous — defer async work with setTimeout.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // USER_UPDATED is how a guest becomes a real account (linkIdentity or
      // a confirmed email change): reload so is_anonymous flips without a
      // sign-out.
      if (event === 'USER_UPDATED' && session?.user) {
        setTimeout(() => loadProfile(session.user), 0);
      }
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
            trackSignIn(session.user);
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
        resetAnalytics();
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
    // Clear React Query cache so any in-flight requests under the OLD
    // user's email key (workoutLogs, notifications, etc.) don't
    // resolve and surface previous-account data when the next user
    // signs in on the same device. clearQueryCache is the wrapper
    // around queryClientInstance.clear() so we don't have to import
    // the QueryClient instance directly here.
    try {
      const { clearQueryCache } = await import('@/lib/query-client');
      clearQueryCache();
    } catch { /* ignore — best-effort */ }
    try {
      await supabase.auth.signOut();
    } finally {
      if (shouldRedirect) window.location.href = '/';
    }
  }, []);

  // Native app: OAuth and magic links return on the app.flexyn:// deep link,
  // which lands here whether or not the sign-in screen is still mounted (the
  // OS may have killed the app while the user was in the browser). On
  // success, supabase-js emits SIGNED_IN and the listener above loads the
  // profile exactly as it does on the web.
  useEffect(() => {
    if (!isNative()) return undefined;
    let cleanup = () => {};
    let alive = true;
    import('@/lib/nativeAuth').then(({ initNativeAuthListener }) => {
      if (!alive) return;
      cleanup = initNativeAuthListener({
        onError: () => toast.error(nativeAuthFailedMessage()),
      });
    }).catch(() => { /* the listener is best effort; web never gets here */ });
    return () => { alive = false; cleanup(); };
  }, []);

  const navigateToLogin = useCallback(() => {
    if (isNative()) {
      import('@/lib/nativeAuth').then((m) => m.nativeSignIn('google')).catch(() => {});
      return;
    }
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
