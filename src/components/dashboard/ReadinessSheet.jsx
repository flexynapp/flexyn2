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
import SleepLogCard from '@/components/dashboard/SleepLogCard';
import MoodLogCard from '@/components/dashboard/MoodLogCard';
import StepsLogCard from '@/components/dashboard/StepsLogCard';

const MOOD_LABELS = ['Drained', 'Low', 'OK', 'Good', 'Great'];

export default function ReadinessSheet({ open, onClose, readiness, focus, onLogWorkout }) {
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
        ? MOOD_LABELS[Math.max(0, Math.min(4, readiness.mood.mood - 1))]
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
              <div className="min-w-0">
                <p className="text-micro font-semibold tracking-[0.04em] text-primary mb-1">
                  {tFallback('readiness.kicker', 'READINESS · TODAY')}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="font-heading font-bold text-4xl leading-none tabular-nums">{score}</span>
                  <span className="text-sm font-semibold text-muted-foreground">
                    / 100 · {readiness?.label}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={tFallback('common.close', 'Close')}
                className="shrink-0 w-9 h-9 -me-2 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary/60 active:bg-secondary/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── the three logs ─────────────────────────────────────── */}
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                <h3 className="font-heading font-bold text-sm tracking-tight">
                  {tFallback('readiness.logHeading', "Log tonight's signals")}
                </h3>
              </div>
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
              <p className="text-micro font-semibold tracking-[0.04em] text-muted-foreground mb-3">
                {tFallback('readiness.breakdownHeading', 'WHAT MADE YOUR SCORE')}
              </p>
              <ul className="space-y-2.5">
                {rows.map((r) => (
                  <li key={r.name} className="flex gap-3 items-start">
                    <span className="shrink-0 mt-0.5 w-7 h-7 rounded-sm bg-secondary/60 text-muted-foreground flex items-center justify-center">
                      <r.Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold">{r.name}</p>
                        <p className="text-xs font-bold tabular-nums shrink-0">
                          {r.d?.logged
                            ? <span className="text-foreground">{r.value}</span>
                            : <span className="text-muted-foreground/70 font-medium italic">
                                {tFallback('readiness.notLogged', 'not logged')}
                              </span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.d?.logged ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                            style={{ width: `${Math.max(0, Math.min(100, r.d?.score ?? 0))}%` }}
                          />
                        </div>
                        <span className="text-micro font-semibold tabular-nums text-muted-foreground shrink-0 w-14 text-end">
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
              onClick={onClose}
              className="w-full mt-5 rounded-2xl bg-primary text-primary-foreground font-heading font-bold text-body h-12 shadow-md hover:brightness-105 active:scale-[0.98] transition-all"
            >
              {tFallback('common.done', 'Done')}
            </button>
          </div>
        </motion.div>
      </div>
  );
}
