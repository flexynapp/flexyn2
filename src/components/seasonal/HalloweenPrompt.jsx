// src/components/seasonal/HalloweenPrompt.jsx
//
// The one-time "try the Halloween look?" offer. Shown once per device per
// season, only in season, and gone for good after either answer: the answer
// itself is the record (see src/lib/halloween.js). Settings → Display keeps
// a switch for changing your mind.
//
// Mounted in App.jsx next to PWAInstallPrompt, so it only renders for a
// signed-in, onboarded user. It waits a beat after mount so it doesn't land
// on top of the launch splash or the first paint of the dashboard.
//
// No close X on purpose. "Not now" IS the dismiss, and a third control
// would only create a state where the prompt is gone but nothing was
// recorded, which is how it would come back tomorrow.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/lib/LanguageContext';
import { useTheme } from '@/lib/ThemeContext';
import { readHalloweenChoice } from '@/lib/halloween';
import PumpkinMark from './PumpkinMark';

const SHOW_DELAY_MS = 2500;

export default function HalloweenPrompt() {
  const { tFallback } = useLanguage();
  const { halloweenAvailable, setHalloween } = useTheme();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!halloweenAvailable) return undefined;
    if (readHalloweenChoice() !== null) return undefined;
    const t = setTimeout(() => setShow(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [halloweenAvailable]);

  const answer = (on) => {
    setShow(false);
    setHalloween(on);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          // Same dock as PWAInstallPrompt: above the bottom nav on a phone,
          // the app's corner on desktop. See --shell-inset in index.css.
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] start-3 end-3 lg:left-auto lg:end-[calc(var(--shell-inset)+1.5rem)] lg:bottom-6 lg:max-w-sm z-[60] rounded-2xl bg-card border border-border shadow-md p-3 flex flex-col gap-2"
          role="dialog"
          aria-labelledby="halloween-prompt-title"
        >
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <PumpkinMark className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p id="halloween-prompt-title" className="font-heading font-bold text-body leading-tight">
                {tFallback('halloween.prompt.title', 'Halloween look is here')}
              </p>
              <p className="text-caption text-muted-foreground leading-snug">
                {tFallback('halloween.prompt.body', 'Warm autumn colours and a pumpkin until November 1. Change it anytime in Settings.')}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => answer(false)}
              className="flex-1 h-11 rounded-lg bg-secondary text-secondary-foreground text-label font-semibold active:opacity-80 transition-opacity"
            >
              {tFallback('halloween.prompt.no', 'Not now')}
            </button>
            <button
              type="button"
              onClick={() => answer(true)}
              className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-label font-bold active:opacity-80 transition-opacity"
            >
              {tFallback('halloween.prompt.yes', 'Turn it on')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
