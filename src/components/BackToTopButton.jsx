// src/components/BackToTopButton.jsx
//
// Small floating circular button that appears once the user has scrolled
// past 2 screen-heights on any long page. Tap → smooth scroll to top.
// Mounted globally in Layout so it overlays every route without per-page
// wiring. Pairs with double-tap-active-tab for power users (different
// muscle memories, same outcome).

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { useScrollPosition } from '@/hooks/useScrollPosition';

export default function BackToTopButton() {
  const scrollY = useScrollPosition();
  const threshold = typeof window !== 'undefined'
    ? window.innerHeight * 2
    : 1600;
  const visible = scrollY > threshold;

  // Respect reduced-motion: smooth scroll → instant jump for users who
  // opt out of motion (and on iOS Safari where smooth scroll can be
  // janky for very long lists).
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  const handleClick = () => {
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
    window.scrollTo({
      top: 0,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          onClick={handleClick}
          // Clears the bottom tab bar, home-indicator inset included.
          // This used to read `max(env(safe-area-inset-bottom), 80px)` and the
          // comment beside it claimed it added the inset — it never did. Every
          // inset a device reports is smaller than 80px, so the max() always
          // picked 80 and the button overlapped the nav on exactly the phones
          // the inset exists for. `max` where `calc` was meant.
          //
          // `bottom` is a CLASS, not an inline style. It used to be inline
          // beside a `lg:bottom-6`, and an inline style beats any class no
          // matter the breakpoint — so the desktop value had never once
          // applied and the button floated 83px up from the bottom, clearing
          // a bottom nav that is `lg:hidden` and therefore not there. Written
          // as an arbitrary value both halves are classes and the cascade
          // resolves them in the order they read.
          //
          // The end inset tracks the capped shell so the button sits at the
          // app's right edge rather than the monitor's — 530px adrift on a
          // 2560 display otherwise. 0 below --shell-max, so mobile is
          // unchanged and keeps the bare `end-4`.
          className="fixed end-4 lg:end-[calc(var(--shell-inset)+1rem)] bottom-[var(--above-nav)] lg:bottom-6 z-30 w-12 h-12 rounded-full bg-card/95 backdrop-blur-sm border border-border shadow-lg flex items-center justify-center text-foreground hover:bg-secondary active:bg-secondary transition-colors"
          aria-label="Back to top"
          type="button"
        >
          <ArrowUp className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
