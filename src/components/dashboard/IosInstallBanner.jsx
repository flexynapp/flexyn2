// src/components/dashboard/IosInstallBanner.jsx
//
// Dismissible install hint for iOS Safari users who haven't yet
// added Flexyn to their home screen. iOS Safari is the only browser
// that doesn't fire beforeinstallprompt — there's no way to trigger
// the install dialog programmatically. The user has to tap Share →
// Add to Home Screen manually. We just point them at it.
//
// SHOW CONDITIONS (all must be true)
// ──────────────────────────────────
//   1. iOS Safari (UA sniff — the only platform that lacks the
//      beforeinstallprompt event AND benefits from PWA install).
//   2. Not running in standalone display mode — once installed, the
//      navigator.standalone flag (or matchMedia 'display-mode:
//      standalone') flips true. We respect both.
//   3. Not dismissed before (per-user localStorage flag).
//
// We don't gate on "is engaged" the way PushOptInBanner does — the
// install moment is upstream of engagement. A user who likes Flexyn
// enough to scroll the dashboard once is a candidate for installing.

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share, Plus, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';

const DISMISS_KEY = (userId) => `flexyn.iosInstallDismissed.${userId || 'anon'}`;

function readDismissed(userId) {
  try { return localStorage.getItem(DISMISS_KEY(userId)) === '1'; }
  catch { return false; }
}
function writeDismissed(userId) {
  try { localStorage.setItem(DISMISS_KEY(userId), '1'); }
  catch { /* best-effort */ }
}

// Detect iOS Safari running in a regular browser tab (not in standalone /
// installed mode). Returns true only when the install hint is actionable.
function isIosSafariNotInstalled() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  // iOS UA: iPhone | iPad | iPod. Modern iPadOS sometimes reports
  // 'Macintosh' with touchpoints — catch that too.
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  if (!isIos) return false;

  // Safari (not Chrome iOS / Firefox iOS — those can't install PWAs).
  // Chrome on iOS reports 'CriOS', Firefox 'FxiOS'. Standard Safari has
  // 'Safari' and no 'CriOS'/'FxiOS'.
  const isSafari = ua.includes('Safari') && !ua.includes('CriOS') && !ua.includes('FxiOS');
  if (!isSafari) return false;

  // Already installed? navigator.standalone is the iOS-specific flag.
  // matchMedia('(display-mode: standalone)') is the cross-browser way
  // and catches the case where iOS Safari is launched from a Home
  // Screen shortcut that doesn't set navigator.standalone (rare).
  const isStandalone = navigator.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  if (isStandalone) return false;

  // Without a service worker the "install" produces a degraded PWA
  // (no offline support, no push notifications). Don't prompt the
  // user to install something half-baked.
  if (!('serviceWorker' in navigator)) return false;

  return true;
}

export default function IosInstallBanner() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  // Both initial states evaluate synchronously off localStorage so the
  // banner DECISION is made on first render — no one-frame flash of
  // 'shown then hidden' when the dismissed flag is read in an effect.
  // The auth-resolved branch then refines `dismissed` to the per-user
  // key once user.id arrives (the anon prefix is the conservative
  // pre-auth default).
  const [eligible, setEligible] = useState(() => {
    try { return isIosSafariNotInstalled(); } catch { return false; }
  });
  const [dismissed, setDismissed] = useState(() => readDismissed(undefined));

  // No-op effect kept as a future hook for re-running detection on
  // visibility change if the user installs the PWA mid-session.
  useEffect(() => {
    setEligible(isIosSafariNotInstalled());
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setDismissed(readDismissed(user.id));
  }, [user?.id]);

  const shouldShow = !!user?.id && eligible && !dismissed;

  const handleDismiss = () => {
    writeDismissed(user?.id);
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
          transition={{ duration: 0.35 }}
          className="relative overflow-hidden rounded-lg border border-blue-500/30 bg-blue-500/8 px-2.5 py-1.5 flex items-center gap-2"
          role="region"
          aria-label={tFallback('iosInstall.aria', 'Install Flexyn on your home screen')}
        >
          <div className="shrink-0 w-6 h-6 rounded-md bg-blue-500/15 text-blue-500 flex items-center justify-center">
            <Plus className="w-3 h-3" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-heading font-bold leading-tight">
              {tFallback('iosInstall.title', 'Install Flexyn')}
            </p>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/90 mt-0.5">
              <span>{tFallback('iosInstall.step1', 'Tap')}</span>
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-foreground/10">
                <Share className="w-2.5 h-2.5" />
              </span>
              <span>{tFallback('iosInstall.step2', 'then')}</span>
              <span className="font-semibold">
                {tFallback('iosInstall.step3', 'Add to Home Screen')}
              </span>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 -me-1 p-1.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
            aria-label={tFallback('iosInstall.close', 'Dismiss')}
          >
            <X className="w-3 h-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
