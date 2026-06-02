// src/components/AppUpdatePrompt.jsx
//
// Toast-style banner that surfaces when a new app version is available.
// PWA service worker auto-updates in the background, but with
// `registerType: 'autoUpdate'` the user has no idea — they'd see the
// new code on a stale tab only after a hard refresh.
//
// This component subscribes to the vite-plugin-pwa `useRegisterSW`
// virtual module's `needRefresh` flag, then renders a bottom-pinned
// banner with a single "Update" button that calls `updateServiceWorker`
// (which skipWaiting + reload).
//
// SAFETY
//   • Only renders when navigator.serviceWorker is available + a new SW
//     waited for us. No effect in dev or on browsers without SW support.
//   • Dynamic-imports the virtual module so a build without
//     vite-plugin-pwa registered (tests, SSR) doesn't fail at import.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCw, X } from 'lucide-react';

const DISMISS_KEY = 'flexyn.appUpdateDismissed';

export default function AppUpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateFn, setUpdateFn] = useState(() => () => {});
  // Persist dismissal in sessionStorage so a navigation within the same
  // tab doesn't re-surface the prompt seconds after the user closed it.
  // sessionStorage (not localStorage) so a NEW tab or a fresh open after
  // the update lands still gets re-prompted — the dismissal was about
  // this session, not about ignoring updates forever.
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const handleDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
    setDismissed(true);
  };

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      try {
        // Dynamic import so a missing module (test/SSR) doesn't crash
        // the bundle. vite-plugin-pwa generates this at build time.
        const mod = await import(/* @vite-ignore */ 'virtual:pwa-register/react').catch(() => null);
        if (!mod || cancelled) return;
        const { useRegisterSW } = mod;
        if (typeof useRegisterSW !== 'function') return;
        // useRegisterSW is a hook — we can't call hooks here. Use the
        // bare function (registerSW) instead by importing the non-hook
        // module path.
        const baseMod = await import(/* @vite-ignore */ 'virtual:pwa-register').catch(() => null);
        if (!baseMod || cancelled) return;
        const updateSW = baseMod.registerSW({
          onNeedRefresh() {
            if (cancelled) return;
            setNeedRefresh(true);
            setUpdateFn(() => () => updateSW(true));
          },
          onOfflineReady() { /* could surface "ready offline" toast here */ },
        });
        cleanup = () => { /* no public unregister; rely on cancellation flag */ };
      } catch {
        /* missing virtual module is non-fatal */
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, []);

  if (!needRefresh || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed left-3 right-3 z-[70] bg-card border border-border rounded-xl shadow-lg flex items-center gap-3 p-3"
        style={{ bottom: 'calc(80px + env(safe-area-inset-bottom))' }}
        role="status"
        aria-live="polite"
      >
        <div className="w-9 h-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <RotateCw className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm">A new version is available</p>
          <p className="text-xs text-muted-foreground">Reload to get the latest features.</p>
        </div>
        <button
          onClick={() => { try { updateFn(); } catch { /* ignore */ } }}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold"
        >
          Update
        </button>
        <button
          onClick={handleDismiss}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
