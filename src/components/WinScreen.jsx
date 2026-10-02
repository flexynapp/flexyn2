// A staged win screen. Finishing something used to end in a toast and a
// share dialog, which reads the same whether you logged your first
// workout or broke a lift you had chased for months. This takes the whole
// screen and plays the win in beats: the number counts up, then what it
// beat, then the XP bar fills (and levels, if it does), then the rest.
//
// It is generic on purpose. A workout, a PR, a goal, a war or duel win
// all pass the same shape; `size` scales the headline to the win, so a
// PR shouts and an ordinary session does not.
//
// Colour follows the app's rules: foreground for the numbers, success for
// "you beat it", primary only on the one button that acts. No confetti
// here; the celebration helpers own that.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, animate } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useOverlayBackButton } from '@/hooks/useOverlayBackButton';
import prefersReducedMotion from '@/lib/reducedMotion';
import { triggerHaptic } from '@/lib/haptic';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { useLanguage } from '@/lib/LanguageContext';
import { formatNumber } from '@/lib/intl';
import { AnswerLabel, AnswerReason, answerClassName } from '@/components/feedback/buttonAnswer';

// When each beat lands, in ms after open.
const BEATS = { delta: 900, xp: 1400, level: 2300, stats: 2600, actions: 3000 };

function useCountUp(target, run) {
  const [n, setN] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) { setN(target); return undefined; }
    const c = animate(0, target, { duration: 0.8, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => setN(v) });
    return () => c.stop();
  }, [target, run]);
  return n;
}

const rise = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] },
};

export default function WinScreen({
  open, onClose,
  kicker, subject,
  value = 0, unit = '', decimals = 0,
  size = 'standard',
  delta = null,
  xp = null,
  stats = [],
  notes = [],
  primary = null,
  secondary = null,
}) {
  const { tFallback, language } = useLanguage();
  const reduced = prefersReducedMotion();
  const [beat, setBeat] = useState(reduced ? Infinity : 0);
  const timers = useRef([]);

  useBodyScrollLock(open);
  useOverlayBackButton(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    triggerHaptic('success');
    if (reduced) { setBeat(Infinity); return undefined; }
    setBeat(0);
    timers.current = Object.values(BEATS).map((ms) => setTimeout(() => setBeat((b) => b + 1), ms));
    return () => timers.current.forEach(clearTimeout);
  }, [open, reduced]);

  const shown = useCountUp(value, open && !reduced);

  // Level maths from total XP before and after this win.
  let before = null;
  let after = null;
  if (xp && xp.gained > 0) {
    before = calculateLevelFromXp(xp.totalBefore || 0);
    after = calculateLevelFromXp((xp.totalBefore || 0) + xp.gained);
  }
  const levelled = before && after && after.level > before.level;
  // Stage the bar: start where you were, fill (to the top if you levelled),
  // then settle into the new level.
  const barPct = beat < 2 ? (before?.progressPercent ?? 0)
    : levelled && beat < 3 ? 100
    : (after?.progressPercent ?? 0);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="win"
          role="dialog"
          aria-modal="true"
          aria-label={kicker}
          className="fixed inset-0 z-[200] bg-background text-foreground overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => { if (beat < Object.keys(BEATS).length) setBeat(Infinity); }}
        >
          <div className="safe-page min-h-full max-w-md mx-auto flex flex-col gap-6">
            <div className="flex flex-col items-center gap-2 text-center pt-8">
              <span className="kicker text-success">{kicker}</span>
              {subject && <span className="text-base text-muted-foreground">{subject}</span>}
              <span
                className={`font-display tabular-nums ${size === 'hero' ? 'text-[5.5rem]' : 'text-[4rem]'}`}
                aria-live="polite"
              >
                {formatNumber(Number(shown.toFixed(decimals)), language, { maximumFractionDigits: decimals })}
                {unit && <span className="text-2xl font-bold text-muted-foreground ms-1">{unit}</span>}
              </span>
              {delta && beat >= 1 && (
                <motion.span {...rise} className="text-sm font-semibold text-success">{delta}</motion.span>
              )}
            </div>

            <div className="flex flex-col gap-2 flex-1">
              {before && beat >= 2 && (
                <motion.div {...rise} className="flex flex-col items-center gap-3 px-4 py-5 rounded-2xl bg-card border border-border text-center">
                  <span className="font-display text-2xl tabular-nums">
                    {tFallback('win.xpGained', '+{n} XP', { n: formatNumber(xp.gained, language) })}
                  </span>
                  <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-foreground transition-[width] duration-700 ease-out"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  {levelled && beat >= 3 ? (
                    <motion.span
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                      className="px-2.5 py-1 rounded-full bg-success text-success-foreground text-xs font-bold"
                    >
                      {tFallback('win.levelUnlocked', 'Lv. {n} unlocked', { n: after.level })}
                    </motion.span>
                  ) : (
                    <span className="kicker">
                      {levelled
                        ? tFallback('win.levelFromTo', 'Lv. {from} to {to}', { from: before.level, to: after.level })
                        : tFallback('win.levelN', 'Lv. {n}', { n: after.level })}
                    </span>
                  )}
                </motion.div>
              )}

              {stats.length > 0 && beat >= 4 && (
                <motion.div {...rise} className="flex gap-2">
                  {stats.map((s) => (
                    <div key={s.key} className="flex-1 min-w-0 flex flex-col items-center gap-1 px-2 py-4 rounded-2xl bg-card border border-border text-center">
                      <span className="max-w-full font-display text-2xl !leading-tight tabular-nums truncate">{s.value}</span>
                      <span className="kicker">{s.label}</span>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* What else this win earned, as plain lines rather than a
                  message over the screen. Read only, so hairlines and no
                  card. A note that arrives after the beat rises in on its own. */}
              {notes.length > 0 && beat >= 4 && (
                <ul className="flex flex-col divide-y divide-border border-y border-border">
                  {notes.map((n) => (
                    <motion.li key={n.key} {...rise} className="flex flex-col gap-1 py-3 px-1">
                      <span className="text-sm font-semibold">{n.text}</span>
                      {n.sub && <span className="text-xs text-muted-foreground">{n.sub}</span>}
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>

            <motion.div
              className="flex flex-col gap-2 pb-2"
              initial={false}
              animate={{ opacity: beat >= 5 ? 1 : 0.001 }}
              transition={{ duration: 0.3 }}
            >
              {primary && (
                <Button className="h-12 font-heading font-bold text-base" onClick={(e) => { e.stopPropagation(); primary.onClick(); }}>
                  {primary.label}
                </Button>
              )}
              {/* A secondary action can answer on its own button: pass
                  `answer` (from useButtonAnswer) plus doneLabel/failedLabel. */}
              {secondary && (
                <Button
                  variant="outline"
                  className={`h-11 ${answerClassName(secondary.answer?.phase)}`}
                  onClick={(e) => { e.stopPropagation(); secondary.onClick(); }}
                >
                  {secondary.answer ? (
                    <AnswerLabel
                      phase={secondary.answer.phase}
                      idle={secondary.label}
                      done={secondary.doneLabel}
                      failed={secondary.failedLabel}
                    />
                  ) : secondary.label}
                </Button>
              )}
              {secondary?.answer?.reason && <AnswerReason>{secondary.answer.reason}</AnswerReason>}
              <Button variant="ghost" className="h-11 text-muted-foreground" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                {tFallback('win.done', 'Done')}
              </Button>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
