import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
// canvas-confetti is ~10 KB gzip. The level-up overlay only fires on
// the rare moment a user crosses a level — every other page load
// shouldn't pay the cost. Dynamic-import inside the effect.
import { getTier } from '@/lib/xpTier';
import Particles from '@/components/Particles';
import { useLanguage } from '@/lib/LanguageContext';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import prefersReducedMotion from '@/lib/reducedMotion';

// The backdrop sits at z-300. canvas-confetti defaults its canvas to
// z-index 100 and appends it to document.body, so every burst this
// overlay fired was painted UNDERNEATH a `bg-black/60 backdrop-blur-md`
// backdrop — drawn correctly, invisible always. It has to be told to go
// above the overlay it is celebrating.
export const CONFETTI_Z_INDEX = 320;

// How long the card stays up before it dismisses itself.
export const AUTO_DISMISS_MS = 6000;

// Legibility scrim over `tier.surface`.
//
// Every tier's surface opens with a specular highlight in the top-left,
// and on Silver, Platinum, Diamond and Legendary that highlight is within
// a few percent of white — which is exactly where the headline lands. The
// card's copy is all `text-white`, so it measured between 1.3:1 and 2.8:1
// depending on tier: present in the DOM, invisible on the screen.
//
// Corner-weighted rather than a flat wash, for the same reason
// ProfileTierBanner's vignette is: a flat black ramp over the whole plate
// turns the richest part of the gradient to mud. Heaviest over the
// specular corner, easing off toward the base of the gradient, which is
// already dark on every tier.
const CARD_SCRIM =
  'radial-gradient(125% 105% at 18% 4%, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.50) 45%, rgba(0,0,0,0.38) 100%)';

function getTierColors(level) {
  if (level >= 91) return ['#fbbf24', '#f97316', '#ef4444']; // Legendary
  if (level >= 81) return ['#06b6d4', '#3b82f6', '#6366f1']; // Diamond
  return ['#fbbf24', '#f97316', '#a855f7']; // Default
}

export default function LevelUpOverlay({ event, onDismiss }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(!!event);
  const { t, tFallback } = useLanguage();
  const reducedMotion = prefersReducedMotion();

  // Auto-dismiss. Held in a ref rather than listed as a dep: LevelUpManager
  // passes a fresh arrow every render, so depending on it tore the timer
  // down and started a new 6s on every parent re-render — and the profile
  // query behind it refetches. The card dismissed 6s after the last
  // incidental re-render, not 6s after it appeared.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!event) return undefined;
    const id = setTimeout(() => onDismissRef.current?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [event]);

  // Confetti burst and haptic feedback. The module load is async, so
  // we resolve it once and then schedule both bursts off the same
  // resolved confetti() function — keeps the visual timing identical
  // to the old eager-import version.
  useEffect(() => {
    if (!event || reducedMotion) return;
    const colors = getTierColors(event.toLevel);

    // Haptic feedback
    try {
      navigator.vibrate?.([15, 50, 15]);
    } catch { /* Safari iOS throws on iframes */ }

    let cancelled = false;
    let t1, t2;
    import('canvas-confetti').then(({ default: confetti }) => {
      if (cancelled) return;
      const burst = (x) => {
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { x, y: 0.6 },
            colors,
            zIndex: CONFETTI_Z_INDEX,
          });
        } catch {
          // Decorative. A throw inside the library (its worker path can
          // fail on some engines) must not take the celebration's own
          // timers with it.
        }
      };
      t1 = setTimeout(() => burst(0.2), 300);
      t2 = setTimeout(() => burst(0.8), 500);
    }).catch(() => {
      // Confetti is decorative — silently skip on load failure.
    });

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [event, reducedMotion]);

  const tier = event ? getTier(event.toLevel, t) : null;

  const cardVariants = reducedMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { opacity: 0, scale: 0.6 },
        visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 280, damping: 18 } },
        exit: { opacity: 0, scale: 0.9, transition: { duration: 0.2 } },
      };

  return createPortal(
    <AnimatePresence>
      {event && tier && (
        // Backdrop
        <motion.div
          key="levelup-backdrop"
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
          initial={{ opacity: 0, pointerEvents: 'none' }}
          animate={{ opacity: 1, pointerEvents: 'auto' }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
          transition={{ duration: 0.2 }}
          onClick={onDismiss}
        >
          {/* Card */}
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            // `tier.surface` is the tier's three-layer mesh — specular
            // highlight, chroma bloom, deep base — the same plate
            // ProfileTierBanner renders. This card used to fill with
            // `bg-gradient-to-br ${tier.badge}`, which is the BADGE ramp:
            // two adjacent hues in one direction, no light source, and
            // light end to end on the lower tiers. `tier.glow` went with
            // it — coloured shadows are out (see CLAUDE.md), and so is
            // shadow-2xl at this viewport width.
            style={{ background: tier.surface }}
            className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-md"
          >
            {/* Legibility scrim — see CARD_SCRIM. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{ background: CARD_SCRIM }}
            />

            {/* Particles — ambient floaters + outward burst on entry */}
            <Particles
              type={tier.particles}
              burst={!reducedMotion}
              burstColors={getTierColors(event.toLevel)}
            />

            {/* Skip button */}
            <button
              aria-label={t('levelUp.skip')}
              onClick={onDismiss}
              className="absolute top-3 end-3 z-20 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 active:bg-black/50 flex items-center justify-center transition-colors text-white"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Content sits above the scrim and the particle layer, both of
                which are absolutely positioned and would otherwise paint
                over it. */}
            <div className="relative z-10 p-6 flex flex-col items-center gap-5">

            {/* Headline */}
            <motion.p
              className="font-heading font-extrabold text-2xl sm:text-3xl tracking-widest text-white drop-shadow-lg uppercase text-center"
              initial={reducedMotion ? {} : { opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4 }}
            >
              {t('levelUp.title')}
            </motion.p>

            {/* Level transition */}
            <motion.div
              className="flex items-center gap-3"
              initial={reducedMotion ? {} : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.3 }}
            >
              {/* These two labels were hardcoded English. Every other string
                  on the card goes through t(); a Japanese or Arabic user got
                  "From"/"To" in the middle of a translated card. */}
              <div className="flex flex-col items-center">
                <span className="text-white/70 text-xs font-medium uppercase tracking-widest mb-0.5">{tFallback('levelUp.from', 'From')}</span>
                <span className="font-heading font-bold text-4xl text-white/80">{event.fromLevel}</span>
              </div>

              <ArrowRight className="w-7 h-7 text-white/80 shrink-0" />

              <div className="flex flex-col items-center">
                <span className="text-white/70 text-xs font-medium uppercase tracking-widest mb-0.5">{tFallback('levelUp.to', 'To')}</span>
                <motion.span
                  className="font-heading font-bold text-5xl text-white drop-shadow-lg"
                  initial={reducedMotion ? {} : { scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.4, type: 'spring', stiffness: 320, damping: 16 }}
                >
                  {event.toLevel}
                </motion.span>
              </div>
            </motion.div>

            {/* Tier subtitle */}
            <motion.p
              className="text-white/80 text-sm font-semibold tracking-wide -mt-2"
              initial={reducedMotion ? {} : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
            >
              {t('levelUp.tierUnlocked').replace('{tier}', tier.name)}
            </motion.p>

            {/* Progress bar */}
            <motion.div
              className="w-full h-3 rounded-full bg-white/20 overflow-hidden"
              initial={reducedMotion ? {} : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
            >
              <motion.div
                className="h-full rounded-full bg-white relative overflow-hidden"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ delay: 0.3, duration: 1.2, ease: 'easeOut' }}
              >
                {/* Shimmer */}
                {!reducedMotion && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear', delay: 0.5 }}
                  />
                )}
              </motion.div>
            </motion.div>

            {/* Continue button.
                The label was `text-foreground`, which is a THEME token: near
                black in light mode, near white in dark mode and pure white
                under every loot theme. On a `bg-white/95` pill that is
                1.09:1 — the button rendered as a blank white capsule for
                anyone not in light mode, which is most of the app. The pill
                is pinned white, so its label has to be pinned dark too;
                there is no token that stays dark across themes. */}
            <motion.button
              onClick={onDismiss}
              whileHover={reducedMotion ? {} : { scale: 1.02 }}
              whileTap={reducedMotion ? {} : { scale: 0.97 }}
              className="w-full py-3 rounded-full bg-white/95 hover:bg-white active:bg-white text-slate-900 font-heading font-bold text-base transition-colors shadow-md"
            >
              {t('levelUp.continue')}
            </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}