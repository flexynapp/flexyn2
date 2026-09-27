// src/components/skins/SkinPrompt.jsx
//
// The one-time "try this look?" offer for whichever skin is in season.
// Shown once per device per window, and gone for good after either answer:
// the answer itself is the record (see src/lib/skins.js). SkinToggle, on
// the You tab and in Settings, is for changing your mind.
//
// Mounted in App.jsx next to PWAInstallPrompt, so it only renders for a
// signed-in, onboarded user. It waits a beat after mount so it doesn't land
// on top of the launch splash or the first paint of the dashboard.
//
// Home only. It docks above the nav, which on Workout is exactly where the
// logger's exercise card sits, so offering it anywhere else puts a choice
// about decoration on top of someone mid-set. Away from Home it waits; the
// offer is still unanswered, so it appears the next time they are there.
//
// No close X on purpose. "Not now" IS the dismiss, and a third control
// would only create a state where the prompt is gone but nothing was
// recorded, which is how it would come back tomorrow.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '@/lib/LanguageContext';
import { readSkinChoice } from '@/lib/skins';
import { useSkin } from './useSkin';

const SHOW_DELAY_MS = 2500;
const OFFER_ON = '/dashboard';

export default function SkinPrompt() {
  const { tFallback } = useLanguage();
  const { skin, parts, setOn } = useSkin();
  const Icon = parts?.Icon;
  const [show, setShow] = useState(false);
  const onHome = useLocation().pathname === OFFER_ON;

  useEffect(() => {
    if (!skin || !onHome) return undefined;
    if (readSkinChoice(skin) !== null) return undefined;
    const t = setTimeout(() => setShow(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [skin, onHome]);

  const answer = (on) => {
    setShow(false);
    setOn(on);
  };

  return (
    <AnimatePresence>
      {show && skin && onHome && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          // Docks on --above-nav, which includes any skin's nav-edge row, so
          // the card clears the pumpkins; the app's corner on desktop.
          className="fixed bottom-[var(--above-nav)] start-3 end-3 lg:left-auto lg:end-[calc(var(--shell-inset)+1.5rem)] lg:bottom-6 lg:max-w-sm z-[60] rounded-2xl bg-card border border-border shadow-md p-3 flex flex-col gap-2"
          role="dialog"
          aria-labelledby="skin-offer-title"
        >
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              {Icon && <Icon className="w-7 h-7" />}
            </div>
            <div className="flex-1 min-w-0">
              <p id="skin-offer-title" className="font-heading font-bold text-body leading-tight">
                {tFallback(...skin.copy.offerTitle)}
              </p>
              <p className="text-caption text-muted-foreground leading-snug">
                {tFallback(...skin.copy.offerBody)}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => answer(false)}
              className="flex-1 h-11 rounded-lg bg-secondary text-secondary-foreground text-label font-semibold active:opacity-80 transition-opacity"
            >
              {tFallback('skin.offer.no', 'Not now')}
            </button>
            <button
              type="button"
              onClick={() => answer(true)}
              className="flex-1 h-11 rounded-lg bg-primary text-primary-foreground text-label font-bold active:opacity-80 transition-opacity"
            >
              {tFallback('skin.offer.yes', 'Turn it on')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
