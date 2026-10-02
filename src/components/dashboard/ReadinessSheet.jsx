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
import { useLanguage } from '@/lib/LanguageContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import ReadinessRing, { readinessColors } from '@/components/dashboard/ReadinessRing';
import SleepLogCard from '@/components/dashboard/SleepLogCard';
import MoodLogCard from '@/components/dashboard/MoodLogCard';
import StepsLogCard from '@/components/dashboard/StepsLogCard';
import { MOOD_LABELS } from '@/lib/data/moodLogs';
import { requestCommitDailyLogs } from '@/lib/dailyLogCommit';
import SheetShell from '@/components/sheets/SheetShell';

// The mood scale is MOOD_LABELS in moodLogs.js — Awful / Meh / Okay / Good
// / On fire — and this file had its own: Drained / Low / OK / Good / Great.
// Both rendered IN THIS SHEET, about 200px apart: the breakdown row called a
// mood "Drained" while MoodLogCard above it called the same value "Awful".
// The local copy was also raw English with no tFallback, so it stayed
// English in all 15 languages while the card beside it translated.

export default function ReadinessSheet({ open, onClose, readiness, focus, onLogWorkout }) {
  // Pin the page behind this overlay — see @/lib/scrollLock.
  const { tFallback } = useLanguage();
  const sleepRef = useRef(null);
  const moodRef = useRef(null);
  const stepsRef = useRef(null);


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

  // Three signals, not four. Sleep QUALITY was a scored 20% with no input —
  // its control was removed on 2026-07-12 while its weight stayed, so the
  // row sat permanently at "not logged · log it above to sharpen your
  // score" pointing at a control that no longer existed, and contributed a
  // fixed +14 to every score. Its weight folded into sleep duration, which
  // is what that commit said was already happening.
  // Each signal's hue comes from the chart ramp, not the state hues: the
  // three only need to be told apart, and a state hue would say good or bad.
  const rows = [
    {
      key: 'sleep',
      short: tFallback('readinessBar.short.sleep', 'Sleep'),
      hue: 'bg-chart-1',
      d: b.sleep,
      value: b.sleep?.logged ? tFallback('readinessBar.hours', '{n} h', { n: b.sleep.value }) : null,
    },
    {
      key: 'mood',
      short: tFallback('readinessBar.short.mood', 'Mood'),
      hue: 'bg-chart-2',
      d: b.soreness,
      value: readiness?.mood?.mood
        ? (() => {
            const i = Math.max(0, Math.min(4, readiness.mood.mood - 1));
            return tFallback(`mood.label.${i + 1}`, MOOD_LABELS[i]);
          })()
        : (readiness?.sleep?.soreness
          ? tFallback('readinessBar.soreness', 'Soreness {n}/5', { n: readiness.sleep.soreness })
          : null),
    },
    {
      key: 'rest',
      short: tFallback('readinessBar.short.rest', 'Rest'),
      hue: 'bg-chart-3',
      d: b.recency,
      value: b.recency?.logged
        ? (b.recency.value === 0
          ? tFallback('readiness.trainedToday', 'Trained today')
          : tFallback('readinessBar.daysAgo', '{n} d ago', { n: b.recency.value }))
        : null,
      // Training is the only signal you can't log from this sheet, so it
      // keeps its route out.
      cta: { label: tFallback('readiness.logWorkout', 'Log a workout'), target: 'workout' },
    },
  ];


  // No AnimatePresence: Dashboard unmounts this component on close, so an
  // exit animation would never get to run. Entry animates, exit is instant —
  // same as every other dismissible surface on the page today.
  return (
    <SheetShell open={open} onClose={onClose} kicker={tFallback('readiness.kicker', 'READINESS')} labelledBy="readiness-sheet-title">

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
                {/* readinessColors and ReadinessCard's action map are both
                    keyed by the ENGLISH label, so the score engine keeps
                    returning it; `labelId` is the slug for display. */}
                <p className="font-heading font-bold text-title leading-tight">
                  {readiness?.labelId
                    ? tFallback(`readiness.label.${readiness.labelId}`, readiness.label)
                    : readiness?.label}
                </p>
              </div>
            </div>


            {/* ── what made the score ─────────────────────────────────
               The number drawn as its three parts (2026-10-02). Each segment
               is that signal's real points, so the bar adds up to the score
               above it. An estimated signal is hatched and says "est."; that
               replaced a sentence per row plus two footers that said "the
               more you log, the less we estimate" twice. The log controls
               follow, so the hatched one is answered right below it. */}
            <div className="mt-4" aria-label={tFallback('readiness.breakdownHeading', 'WHAT MADE YOUR {n}', { n: score })}>
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden="true">
                {rows.map((r) => (
                  <div
                    key={r.key}
                    className={r.d?.logged ? r.hue : ''}
                    style={{
                      flex: Math.max(0, r.d?.contribution ?? 0),
                      backgroundImage: r.d?.logged
                        ? undefined
                        : 'repeating-linear-gradient(135deg, hsl(var(--foreground) / 0.35) 0 3px, transparent 3px 6px)',
                    }}
                  />
                ))}
                <div style={{ flex: Math.max(0, 100 - score) }} />
              </div>
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {rows.map((r) => (
                  <li key={r.key} className="min-w-0 flex flex-col">
                    <span className="flex items-center gap-1 text-micro text-muted-foreground">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${r.d?.logged ? r.hue : 'bg-foreground/35'}`} aria-hidden="true" />
                      <span className="truncate">{r.short}</span>
                    </span>
                    <span className="text-caption font-bold tabular-nums">
                      +{r.d?.contribution ?? 0}{' '}
                      <span className={`text-micro font-medium ${r.d?.logged ? 'text-muted-foreground' : 'text-muted-foreground/80 italic'}`}>
                        {r.d?.logged ? r.value : tFallback('readinessBar.est', 'est.')}
                      </span>
                    </span>
                    {r.cta && (
                      <button
                        type="button"
                        onClick={() => { onClose(); onLogWorkout?.(); }}
                        className="mt-0.5 self-start min-h-[32px] text-start text-micro font-bold text-primary hover:underline"
                      >
                        {r.cta.label}&nbsp;<span aria-hidden="true" className="inline-block rtl:scale-x-[-1]">→</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* ── the three logs ─────────────────────────────────────── */}
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                <h3 className="font-heading font-bold text-body tracking-tight">
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
    </SheetShell>
  );
}
