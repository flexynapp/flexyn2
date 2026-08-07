import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getTranslation, loadLanguage, isLanguageLoaded, SUPPORTED_LANGUAGES } from './i18n';
import { db } from '@/api/db';
import { clearTranslationCache } from './translate';

const LANG_STORAGE_KEY = 'fn-language';
const DEFAULT_LANG = 'en';

// Exported so class components (e.g. ErrorBoundary) can read the
// context directly via React.useContext instead of going through the
// useLanguage() hook, which throws if no provider is mounted above.
export const LanguageContext = createContext(null);

// Resolve the starting language synchronously (localStorage or 'en' default)
// so we can KICK OFF the loadLanguage promise BEFORE React mounts — this
// way the language is usually ready by the time LanguageProvider renders.
function readInitialLang() {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    if (v && SUPPORTED_LANGUAGES.some(l => l.code === v)) return v;
  } catch { /* private mode */ }
  return DEFAULT_LANG;
}

// Kick off the load immediately on module import — by the time the
// LanguageProvider component runs, the fetch is already in flight.
// English is always loaded as the fallback dictionary.
const _initialLang = readInitialLang();
const _bootstrapLoad = Promise.all([
  loadLanguage('en'),
  _initialLang !== 'en' ? loadLanguage(_initialLang) : Promise.resolve(true),
]);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(_initialLang);
  // `ready` flips true once English + the active language are loaded.
  // First render returns null so the UI doesn't flash raw translation keys.
  const [ready, setReady] = useState(isLanguageLoaded('en') && isLanguageLoaded(_initialLang));

  // Wait for the module-level bootstrap load (started before render) to
  // finish, then flip ready. Typically resolves within ~50ms on first
  // visit, instantly on subsequent visits (HTTP cache).
  useEffect(() => {
    let cancelled = false;
    _bootstrapLoad.then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  // Track whether we have hydrated from the server yet to avoid race-condition writes.
  const hydratedFromServer = useRef(false);
  // Mounted flag for setLanguage's async path — without this, calling
  // setLanguage right before unmount (e.g. mid-sign-out) leaves the
  // setLanguageState fire after the component has gone, generating a
  // React 'unmounted update' warning AND the localStorage write under
  // an old user context.
  const mountedRef = useRef(true);
  // See MoodLogCard for the full story: a cleanup-only mounted flag is false
  // from the first paint under StrictMode. Here it gated setLanguage() after
  // its await, so changing language in dev applied neither the state nor the
  // localStorage write.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // On mount, try to read the signed-in user's preferred_language and override local state if set.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await db.auth.me();
        const serverLang = me?.preferred_language;
        if (!cancelled && serverLang && SUPPORTED_LANGUAGES.some(l => l.code === serverLang) && serverLang !== language) {
          // Load before flipping so we don't show raw keys mid-transition.
          await loadLanguage(serverLang);
          if (cancelled) return;
          setLanguageState(serverLang);
          try { localStorage.setItem(LANG_STORAGE_KEY, serverLang); } catch {}
        }
      } catch {
        // Not signed in or request failed — keep localStorage value.
      } finally {
        hydratedFromServer.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setLanguage = useCallback(async (code) => {
    if (!SUPPORTED_LANGUAGES.some(l => l.code === code)) return;
    // Load the new language BEFORE flipping state so the next render
    // has translations available. Without this, every t() call between
    // setState and the load resolving would return raw keys.
    await loadLanguage(code);
    if (!mountedRef.current) return;
    setLanguageState(code);
    try { localStorage.setItem(LANG_STORAGE_KEY, code); } catch {}
    clearTranslationCache();
    try { window.dispatchEvent(new CustomEvent('flexyn:language-changed', { detail: { code } })); } catch {}
    try {
      db.auth.updateMe({ preferred_language: code }).catch(() => {});
    } catch {}
  }, []);

  // Keep <html lang/dir> in sync
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  const t = useCallback((key, vars) => {
    let str = getTranslation(language, key);
    if (vars && typeof str === 'string') {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return str;
  }, [language]);

  /**
   * Translation with explicit fallback.
   *
   * NOTE on when this actually matters: `getTranslation` resolves
   * `language → en → the raw key`, so a key missing in the current
   * language but present in `en` already renders ENGLISH, not a key path.
   * (An earlier version of this comment said it "returns the raw key",
   * which is only true when the key is missing from `en` as well.)
   *
   * So tFallback earns its keep for keys that aren't in ANY part file yet
   * — new components shipping ahead of their translations. Its fallback is
   * used when the key is missing everywhere.
   * Avoids the verbose `t(k) === k ? 'fallback' : t(k)` pattern across the
   * codebase. Use this when shipping new components that haven't had their
   * keys added to every language file yet.
   *
   * Vars are interpolated into BOTH the translation AND the fallback so
   * non-English users on a missing key don't see literal `{placeholder}`
   * tokens in the UI. Without this, e.g.
   *   `tFallback('streakRescue.title', 'Save your {streak}-day streak', { streak: 14 })`
   * would render "Save your {streak}-day streak" (placeholder visible)
   * to any locale where the key is missing.
   */
  const tFallback = useCallback((key, fallback, vars) => {
    const v = t(key, vars);
    if (v !== key) return v;
    let str = fallback;
    if (vars && typeof str === 'string') {
      Object.entries(vars).forEach(([k, val]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(val));
      });
    }
    return str;
  }, [t]);

  const currentLanguage = SUPPORTED_LANGUAGES.find(l => l.code === language) || SUPPORTED_LANGUAGES[0];

  // Memoize the context value — see ThemeContext for the rationale.
  // Every t() / tFallback() lookup goes through this context, so an
  // unmemoized value would re-render every t-consumer on every parent
  // render (effectively the whole app).
  //
  // CRITICAL: this useMemo MUST sit before any conditional early
  // return, otherwise React's hook count changes between the first
  // render (loading spinner branch, hook NOT called) and subsequent
  // renders (full provider, hook called) — React throws "Rendered
  // more hooks than during the previous render" and the entire
  // provider crashes. When that happens consumers fall back to the
  // null context default and every t() returns undefined, which makes
  // tons of UI text appear "missing." This was the bug behind the
  // round-4 ghost-feature regression.
  const value = useMemo(
    () => ({ language, setLanguage, t, tFallback, currentLanguage, SUPPORTED_LANGUAGES }),
    [language, setLanguage, t, tFallback, currentLanguage]
  );

  // First render gate: until English + active language are loaded, return
  // a minimal loading shell instead of `children`. Without this, every
  // t() call would return the raw key (e.g. "nav.dashboard") and the UI
  // would briefly show keys before the dictionary lands. ~50ms first
  // load, instant on subsequent visits.
  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}