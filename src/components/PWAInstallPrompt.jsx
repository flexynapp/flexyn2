// src/components/PWAInstallPrompt.jsx
//
// "Install App" prompt. Shows a small banner the first time a user lands on
// the Dashboard from an installable browser context. Tap the button → native
// install dialog appears. Dismissed forever once installed OR user closes it.
//
// The `beforeinstallprompt` event fires on Chrome/Edge/Android when the PWA
// meets installability criteria (manifest + service worker + HTTPS). Safari
// doesn't fire it — iOS users see the regular Share → Add to Home Screen flow.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

const DISMISS_STORAGE_KEY = 'fn-pwa-install-dismissed-at';
const DISMISS_COOLDOWN_DAYS = 14;

export default function PWAInstallPrompt() {
  const { tFallback } = useLanguage();
  // Cached event handle — needed because beforeinstallprompt fires ONCE.
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  // Whether the banner is currently visible to the user.
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Honor the cooldown — if user dismissed recently, stay quiet.
    try {
      const dismissedAt = localStorage.getItem(DISMISS_STORAGE_KEY);
      if (dismissedAt) {
        const ms = Date.now() - Number(dismissedAt);
        if (ms < DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) return;
      }
    } catch { /* private mode — fall through and offer */ }

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    const onInstalled = () => {
      // App was installed via any path (browser menu, our button, OS prompt).
      // Hide ourselves forever — beforeinstallprompt won't fire on installed
      // app anyway, but clearing state keeps the UI clean.
      setShow(false);
      setDeferredPrompt(null);
      try { localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      // outcome: 'accepted' | 'dismissed'. Either way the prompt is now
      // single-use; clear our handle. `appinstalled` will fire if accepted.
      setDeferredPrompt(null);
      setShow(false);
      if (outcome === 'dismissed') {
        try { localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('[PWA] install prompt failed:', err);
      setShow(false);
    }
  };

  const handleDismiss = () => {
    setShow(false);
    try { localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
  };

  return (
    <AnimatePresence>
      {show && deferredPrompt && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          // The desktop end inset tracks the capped shell, so the banner
          // docks to the app's corner rather than the monitor's. See index.css.
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] start-3 end-3 lg:left-auto lg:end-[calc(var(--shell-inset)+1.5rem)] lg:bottom-6 lg:max-w-sm z-[60] rounded-2xl bg-card border border-border shadow-xl p-3 flex items-center gap-3"
          role="dialog"
          aria-label={tFallback("iosInstall.title", "Install Flexyn")}
        >
          <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Download className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-sm leading-tight">{tFallback("iosInstall.title", "Install Flexyn")}</p>
            <p className="text-xs text-muted-foreground leading-snug truncate">
              {tFallback('pwaInstall.body', 'Add to your home screen for faster access.')}
            </p>
          </div>
          <button
            onClick={handleInstall}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity"
          >
            {tFallback("pWAInstallPrompt.install", "Install")}
          </button>
          <button
            onClick={handleDismiss}
            aria-label={tFallback("discovery.dismiss", "Dismiss")}
            className="shrink-0 p-1 rounded-md text-muted-foreground hover:bg-secondary active:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
