// src/components/dashboard/ReadinessSheet.jsx
//
// The Readiness explainer, grown into the home for the three recovery
// logs. It answers "why is my score 82?" AND lets you fix the answer in
// the same place, which is what the old split could not do: the explainer
// lived here and the loggers lived six cards down the page.
//
// This also repairs a link that the dashboard cleanup would otherwise have
// broken. The explainer's "Log sleep" / "Log mood" buttons called
// goLogReadinessSignal('recovery'), which expanded the Nutrition & Recovery
// section and scrolled to [data-recovery-section]. With that section gone
// those buttons would have scrolled to nothing — so the loggers moved in
// here instead, and the buttons became unnecessary: the controls are above
// the breakdown that asks for them.
//
// Lazy-loaded from Dashboard (see the lazy-loading rule in CLAUDE.md), so
// SleepLogCard / MoodLogCard / StepsLogCard are no longer in the eager
// dashboard chunk — they load with the sheet on first open.

import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Moon, Star, Smile, Dumbbell, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import ReadinessRing, { readinessColors } from '@/components/dashboard/ReadinessRing';
import SleepLogCard from '@/components/dashboard/SleepLogCard';
import MoodLogCard from '@/components/dashboard/MoodLogCard';
import StepsLogCard from '@/components/dashboard/StepsLogCard';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { MOOD_LABELS } from '@/lib/data/moodLogs';
import { requestCommitDailyLogs } from '@/lib/dailyLogCommit';

// The mood scale is MOOD_LABELS in moodLogs.js — Awful / Meh / Okay / Good
// / On fire — and this file had its own: Drained / Low / OK / Good / Great.
// Both rendered IN THIS SHEET, about 200px apart: the breakdown row called a
// mood "Drained" while MoodLogCard above it called the same value "Awful".
// The local copy was also raw English with no tFallback, so it stayed
// English in all 15 languages while the card beside it translated.

export default function ReadinessSheet({ open, onClose, readiness, focus, onLogWorkout }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const { tFallback } = useLanguage();
  const sleepRef = useRef(null);
  const moodRef = useRef(null);
  const stepsRef = useRef(null);

  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Tapping a Tonight column opens the sheet already looking at that
  // signal. Deferred a tick so the sheet has laid out before we scroll.
  useEffect(() => {
    if (!open || !focus) return undefined;
    const target = { sleep: sleepRef, mood: moodRef, steps: stepsRef }[focus];
    const id = setTimeout(() => {
      try { target?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      catch { /* older WebViews — the card is still on screen */ }
    }, 120);
    return () => clearTimeout(id);
  }, [open, focus]);

  if (!open) return null;

  const b = readiness?.breakdown || {};
  const score = readiness?.score ?? 0;

  const rows = [
    {
      Icon: Moon,
      name: tFallback('readiness.row.sleep', "Last night's sleep"),
      weight: '40%',
      d: b.sleep,
      value: b.sleep?.logged ? `${b.sleep.value} hr` : null,
    },
    {
      Icon: Star,
      name: tFallback('readiness.row.quality', 'Sleep quality'),
      weight: '20%',
      d: b.quality,
      value: b.quality?.logged ? `${b.quality.value} / 5` : null,
    },
    {
      Icon: Smile,
      name: tFallback('readiness.row.mood', 'Mood / soreness'),
      weight: '25%',
      d: b.soreness,
      value: readiness?.mood?.mood
        ? (() => {
            const i = Math.max(0, Math.min(4, readiness.mood.mood - 1));
            return tFallback(`mood.label.${i + 1}`, MOOD_LABELS[i]);
          })()
        : (readiness?.sleep?.soreness ? `Soreness ${readiness.sleep.soreness}/5` : null),
    },
    {
      Icon: Dumbbell,
      name: tFallback('readiness.row.recency', 'Days since last workout'),
      weight: '15%',
      d: b.recency,
      value: b.recency?.logged
        ? (b.recency.value === 0
          ? tFallback('readiness.trainedToday', 'Trained today')
          : `${b.recency.value} day${b.recency.value === 1 ? '' : 's'} ago`)
        : null,
      // Training is the only signal you can't log from this sheet, so it
      // keeps its route out.
      cta: { label: tFallback('readiness.logWorkout', 'Log a workout'), target: 'workout' },
    },
  ];

  const allLogged = rows.every((r) => r.d?.logged);

  // No AnimatePresence: Dashboard unmounts this component on close, so an
  // exit animation would never get to run. Entry animates, exit is instant —
  // same as every other dismissible surface on the page today.
  return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 bg-black/55"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl bg-card border-t border-border pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          {/* Grab handle — the sheet is swipe-dismissible on iOS by habit,
              and the handle is what tells the user that before they try. */}
          <div className="sticky top-0 z-10 bg-card pt-2.5 pb-1 flex justify-center">
            <span className="w-10 h-1 rounded-full bg-foreground/20" aria-hidden="true" />
          </div>

          <div className="px-4 md:px-6 pb-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-micro font-semibold tracking-[0.04em] text-primary">
                {tFallback('readiness.kicker', 'READINESS · TODAY')}
              </p>
              {/* Board 02 gives the close a resting fill rather than one that
                  only appears on hover — there is no hover on the phones this
                  ships to, so the control was invisible until tapped. */}
              <button
                type="button"
                onClick={onClose}
                aria-label={tFallback('common.close', 'Close')}
                className="shrink-0 w-8 h-8 -me-1 rounded-full flex items-center justify-center bg-foreground/[0.08] text-muted-foreground hover:bg-foreground/[0.14] active:bg-foreground/[0.14] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* The dial, repeated from the card you tapped to get here — board
                02 leads with it so the sheet confirms what you opened rather
                than restating the number in a different shape.

                The score is text-title (20px) where the drawing has 24. The
                app's type scale has no 24px step and CLAUDE.md forbids
                inventing a seventh, so it takes the nearest one down. */}
            <div className="flex items-center gap-3 mt-2">
              <ReadinessRing score={score} color={readinessColors(readiness?.label).ring}>
                <span className="font-heading font-black text-title tabular-nums">{score}</span>
              </ReadinessRing>
              <div className="min-w-0">
                <p className="font-heading font-bold text-title leading-tight">{readiness?.label}</p>
                <p className="text-caption text-muted-foreground leading-snug mt-1">
                  {tFallback('readiness.blend', 'Blended from four signals. The more you log, the less we estimate.')}
                </p>
              </div>
            </div>

            {/* ── the three logs ─────────────────────────────────────── */}
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                <h3 className="font-heading font-bold text-body tracking-tight">
                  {tFallback('readiness.logHeading', "Log tonight's signals")}
                </h3>
              </div>
              {/* Board 02 puts a line here saying what these three controls
                  are — without it the section is a heading and three cards
                  the user has already seen collapsed on the page. */}
              <p className="text-micro text-muted-foreground mb-2 px-1">
                {tFallback('readiness.logSub', 'Full controls for the three signals the Tonight row shows on the page.')}
              </p>
              <div className="space-y-2">
                <div ref={sleepRef}>
                  <ErrorBoundary label="SleepLogCard"><SleepLogCard /></ErrorBoundary>
                </div>
                <div ref={moodRef}>
                  <ErrorBoundary label="MoodLogCard"><MoodLogCard /></ErrorBoundary>
                </div>
                <div ref={stepsRef}>
                  <ErrorBoundary label="StepsLogCard"><StepsLogCard /></ErrorBoundary>
                </div>
              </div>
            </div>

            {/* ── why the score is what it is ────────────────────────── */}
            <div className="mt-6 pt-4 border-t border-border">
              {/* "WHAT MADE YOUR 82", not "…YOUR SCORE". The drawing names
                  the number the user is looking at, which is the question
                  this section exists to answer. */}
              <p className="text-micro font-semibold tracking-[0.04em] text-muted-foreground mb-3">
                {tFallback('readiness.breakdownHeading', 'WHAT MADE YOUR {n}').replace('{n}', score)}
              </p>
              <ul className="space-y-2.5">
                {rows.map((r) => (
                  <li key={r.name} className="flex gap-3 items-start">
                    <span className="shrink-0 mt-0.5 w-7 h-7 rounded-sm bg-secondary text-muted-foreground flex items-center justify-center">
                      <r.Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-caption font-semibold">{r.name}</p>
                        <p className="text-xs font-bold tabular-nums shrink-0">
                          {r.d?.logged
                            ? <span className="text-foreground">{r.value}</span>
                            : <span className="text-muted-foreground/70 font-medium italic">
                                {tFallback('readiness.notLogged', 'not logged')}
                              </span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {/* 4px on foreground/12, per the drawing. h-1.5 on
                            --secondary made the track read as a filled bar of
                            its own next to the tile beside it. */}
                        <div className="flex-1 h-1 rounded-full bg-foreground/[0.12] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.d?.logged ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                            style={{ width: `${Math.max(0, Math.min(100, r.d?.score ?? 0))}%` }}
                          />
                        </div>
                        {/* Primary, not muted. This is the answer to the
                            question the section asks, and it was rendering in
                            the same grey as the weight caption below it. */}
                        <span className="text-micro font-bold tabular-nums text-primary shrink-0 w-14 text-end">
                          +{r.d?.contribution ?? 0} pts
                        </span>
                      </div>
                      <p className="text-micro text-muted-foreground/70 leading-snug mt-0.5">
                        {r.d?.logged
                          ? `${tFallback('readiness.scored', 'Scored')} ${r.d.score}/100 · ${tFallback('readiness.weighted', 'weighted')} ${r.weight}`
                          : tFallback('readiness.estimate', 'No data yet — using a neutral estimate. Log it above to sharpen your score.')}
                      </p>
                      {r.cta && (
                        <button
                          type="button"
                          onClick={() => { onClose(); onLogWorkout?.(); }}
                          className="mt-1.5 inline-flex items-center gap-0.5 text-micro font-bold text-primary hover:underline"
                        >
                          {r.cta.label} <span aria-hidden="true">→</span>
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-micro text-muted-foreground/80 leading-relaxed mt-4">
                {allLogged
                  ? tFallback('readiness.allLogged', 'Nothing estimated today — all four signals are logged.')
                  : tFallback('readiness.footer', 'The more you log, the less we estimate — and the more the number reflects you.')}
              </p>
            </div>

            <button
              type="button"
              // Board 02 draws this as "Save & close", and that label is
              // right — it was the BEHAVIOUR that was wrong. The cards are
              // asked to flush before the sheet goes, so a typed step count
              // is written rather than dropped.
              //
              // An event rather than a blur: blur needs the element to hold
              // real focus, and a backgrounded document dispatches no focus
              // events at all. "True as long as the browser cooperates" is
              // not a promise worth making about someone's data.
              onClick={() => { requestCommitDailyLogs(); onClose(); }}
              // It shipped labelled "Save" while only calling onClose:
              // every control in the sheet commits on its own (mood on tap,
              // sleep on interaction, steps on blur/Enter/its own check). A
              // full-width primary CTA reading "Save" over three self-saving
              // cards claimed those taps were uncommitted — and StepsLogCard
              // sits directly above it with a REAL save button, so typing a
              // count and reaching for the biggest save-looking control on
              // screen dismissed the sheet and dropped the number. The steps
              // input commits on blur, and this handler forces that blur, so
              // the drawn promise is kept rather than reworded away.
              //
              // Drawn at 52px, which is no step on the height scale. --fluid-cta-h
              // is the app's own answer for exactly this control (clamp 48→56)
              // and lands on ~52 at the 390pt the board was drawn at.
              className="w-full mt-5 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-body h-[var(--fluid-cta-h)] shadow-md hover:brightness-105 active:scale-[0.98] transition-all"
            >
              {tFallback('readiness.saveClose', 'Save & close')}
            </button>
          </div>
        </motion.div>
      </div>
  );
}
