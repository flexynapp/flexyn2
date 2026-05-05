import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getTranslation, SUPPORTED_LANGUAGES } from './i18n';
import { base44 } from '@/api/base44Client';
import { clearTranslationCache } from './translate';

const LANG_STORAGE_KEY = 'fn-language';
const DEFAULT_LANG = 'en';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  // Start from localStorage (or 'en' default). This renders instantly.
  const [language, setLanguageState] = useState(() => {
    try {
      return localStorage.getItem(LANG_STORAGE_KEY) || DEFAULT_LANG;
    } catch {
      return DEFAULT_LANG;
    }
  });

  // Track whether we have hydrated from the server yet to avoid race-condition writes.
  const hydratedFromServer = useRef(false);

  // On mount, try to read the signed-in user's preferred_language and override local state if set.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await base44.auth.me();
        const serverLang = me?.preferred_language;
        if (!cancelled && serverLang && SUPPORTED_LANGUAGES.some(l => l.code === serverLang) && serverLang !== language) {
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

  const setLanguage = useCallback((code) => {
    if (!SUPPORTED_LANGUAGES.some(l => l.code === code)) return;
    setLanguageState(code);
    try { localStorage.setItem(LANG_STORAGE_KEY, code); } catch {}
    // Clear any cached on-demand translations so future Hub posts re-translate
    // into the newly-selected language. (The cache key already includes target
    // lang so old entries wouldn't be wrong — clearing is mostly to keep the
    // cache lean and avoid stale entries from previous language choices.)
    clearTranslationCache();
    // Notify listeners (HubPostCard, etc.) to reset any "currently translated"
    // UI state so users see the new language on the next view.
    try { window.dispatchEvent(new CustomEvent('flexyn:language-changed', { detail: { code } })); } catch {}
    // Best-effort server write. Fails silently if not signed in.
    try {
      base44.auth.updateMe({ preferred_language: code }).catch(() => {});
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
  const currentLanguage = SUPPORTED_LANGUAGES.find(l => l.code === language) || SUPPORTED_LANGUAGES[0];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, currentLanguage, SUPPORTED_LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}