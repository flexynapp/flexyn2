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

function getTierColors(level) {
  if (level >= 91) return ['#fbbf24', '#f97316', '#ef4444']; // Legendary
  if (level >= 81) return ['#06b6d4', '#3b82f6', '#6366f1']; // Diamond
  return ['#fbbf24', '#f97316', '#a855f7']; // Default
}

export default function LevelUpOverlay({ event, onDismiss }) {
  const { t } = useLanguage();
  const dismissTimerRef = useRef(null);
  const reducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (!event) return;
    dismissTimerRef.current = setTimeout(onDismiss, 6000);
    return () => clearTimeout(dismissTimerRef.current);
  }, [event, onDismiss]);

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
      t1 = setTimeout(() => {
        confetti({ particleCount: 80, spread: 70, origin: { x: 0.2, y: 0.6 }, colors });
      }, 300);
      t2 = setTimeout(() => {
        confetti({ particleCount: 80, spread: 70, origin: { x: 0.8, y: 0.6 }, colors });
      }, 500);
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
            className={`relative w-full max-w-sm rounded-3xl overflow-hidden bg-gradient-to-br ${tier.badge} shadow-2xl ${tier.glow} p-6 flex flex-col items-center gap-5`}
          >
            {/* Particles */}
            <Particles type={tier.particles} />

            {/* Skip button */}
            <button
              aria-label={t('levelUp.skip')}
              onClick={onDismiss}
              className="absolute top-3 end-3 w-8 h-8 rounded-full bg-black/20 hover:bg-black/35 flex items-center justify-center transition-colors text-white"
            >
              <X className="w-4 h-4" />
            </button>

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
              <div className="flex flex-col items-center">
                <span className="text-white/60 text-xs font-medium uppercase tracking-widest mb-0.5">From</span>
                <span className="font-heading font-bold text-4xl text-white/70">{event.fromLevel}</span>
              </div>

              <ArrowRight className="w-7 h-7 text-white/80 shrink-0" />

              <div className="flex flex-col items-center">
                <span className="text-white/60 text-xs font-medium uppercase tracking-widest mb-0.5">To</span>
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

            {/* Continue button */}
            <motion.button
              onClick={onDismiss}
              whileHover={reducedMotion ? {} : { scale: 1.02 }}
              whileTap={reducedMotion ? {} : { scale: 0.97 }}
              className="w-full py-3 rounded-full bg-white/95 hover:bg-white text-foreground font-heading font-bold text-base transition-colors shadow-lg"
            >
              {t('levelUp.continue')}
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}