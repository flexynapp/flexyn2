// src/components/exercise/ExerciseFormPanel.jsx
//
// "How to" — the step-by-step guide for one exercise, behind a disclosure.
//
// COLLAPSED BY DEFAULT, and that is the whole design. Someone who already
// knows what a Barbell Row is should not pay ~120px of a 390px screen for
// instructions on every exercise, forever. Someone who does not know is one
// tap away, and that tap is the strongest signal we get that the guide is
// wanted. Same reasoning as EvidencePanel in CoachPlanCard, whose shape this
// deliberately mirrors so the two disclosures read as one idea.
//
// ── Two layers, and why ─────────────────────────────────────────────────────
//
// WORDS come from `exerciseGuides.js` and cover all 396 catalog exercises.
// FIGURES come from `exercisePoses.js` and cover 39. The words are the
// guarantee; the figure is the bonus when the movement happens to be drawn.
//
// This used to be figure-only, which meant the panel rendered NOTHING for
// about 90% of what the app can program — including Squat and Deadlift, the
// first two lifts in the default starter plan. A user opening their plan saw a
// guide under Overhead Press and nothing under the squat directly above it,
// which reads as a broken feature rather than as a missing diagram.
//
// It still renders nothing when there is no guide at all — a custom exercise
// the user typed in themselves. An empty result is honest and recoverable;
// invented instructions are not. See rule 2 in exerciseGuides.js.
//
// The figure is lazy. Geometry + the poses are ~35 KB that nobody who leaves
// this collapsed should download, which is the same rule the repo already
// applies to modals and tabs (see the lazy-loading note in CLAUDE.md).

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { ChevronDown, Shapes, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { posesFor } from '@/lib/data/exercisePoses';
import { guideFor } from '@/lib/exerciseGuides';

const ExerciseDiagram = React.lazy(() =>
  import('@/components/exercise/ExerciseFigure').then((m) => ({ default: m.ExerciseDiagram })),
);

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * @param {string} exerciseName  canonical English name, as stored
 * @param {string} className     spacing from the caller, since the hosts sit
 *                               in cards with different rhythms
 * @param {boolean} [open]       CONTROLLED mode. Pass it when the trigger
 *                               lives elsewhere (the active logger opens the
 *                               guide from the exercise ⋯ menu). The panel
 *                               then renders nothing while closed, its own
 *                               header only folds it away again, and opening
 *                               brings it into view. Omit it and the panel
 *                               keeps its own disclosure, as everywhere else.
 * @param {(open: boolean) => void} [onOpenChange]
 */
export default function ExerciseFormPanel({ exerciseName, className = '', open: openProp, onOpenChange }) {
  const { tFallback } = useLanguage();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : openState;
  const setOpen = (next) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (controlled) onOpenChange?.(value);
    else setOpenState(value);
  };
  const rootRef = useRef(null);

  // Opened from a menu, the panel appears somewhere the eye was not. Bring
  // its top into view, clear of the pinned session bar above and the rest
  // timer and tab bar below. Measured by hand: a 'nearest' scrollIntoView
  // skips an element that is technically on screen under the tab bar.
  useEffect(() => {
    if (!controlled || !open) return undefined;
    const id = setTimeout(() => {
      const el = rootRef.current;
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      const r = el.getBoundingClientRect();
      const top = 180;
      const floor = window.innerHeight - 160;
      let dy = 0;
      if (r.top < top) dy = r.top - top;
      else if (r.bottom > floor) dy = Math.min(r.bottom - floor, r.top - top);
      if (dy) {
        try { window.scrollBy({ top: dy, behavior: 'smooth' }); } catch { /* noop */ }
      }
    }, 60);
    return () => clearTimeout(id);
  }, [controlled, open]);

  const guide = guideFor(exerciseName);
  const poses = posesFor(exerciseName);
  if (!guide && !poses) return null;
  if (controlled && !open) return null;

  // TODO(i18n): the cues and the written steps live in English in
  // exercisePoses.js / exerciseGuides.js and are the single source, so
  // tFallback resolves to them until a translator adds `exerciseCues.*` and
  // `exerciseGuide.*` to a part file. Per CLAUDE.md these are prose on a
  // prominent surface, so English-only beats machine translation — but they
  // ARE currently English in all 15 languages. Do not call this done.
  const slug = slugify(exerciseName);
  const cues = poses ? poses.labels.map((label, i) => tFallback(`exerciseCues.${slug}.${i}`, label)) : null;
  // Keyed by the GUIDE's pattern id, not the exercise name: every one of the
  // 23 squat variants shares one set of strings, so a translator writes them
  // once rather than 23 times — and a new catalog entry that resolves to an
  // existing pattern arrives already translated.
  const steps = guide
    ? guide.steps.map((text, i) => tFallback(`exerciseGuide.${guide.id}.step.${i}`, text))
    : [];
  const watch = guide ? tFallback(`exerciseGuide.${guide.id}.watch`, guide.watch) : null;

  return (
    <div ref={rootRef} className={`rounded-xl border border-border bg-secondary/30 overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // Named, not just "How to": on the Workout page every exercise card
        // carries one of these, so an unnamed control gives a screen-reader
        // user a column of identical buttons.
        aria-label={tFallback('exerciseForm.showFor', 'How to do {name}', { name: exerciseName })}
        className="w-full flex items-center gap-2 px-3 py-2 text-start"
      >
        <Shapes className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 min-w-0 text-micro font-semibold leading-tight">
          {tFallback('exerciseForm.howTo', 'How to do it')}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-3 pb-2.5 space-y-2">
          {cues && (
            <Suspense fallback={null}>
              <ExerciseDiagram frames={poses.frames} labels={cues} />
            </Suspense>
          )}

          {steps.length > 0 && (
            // An ordered list, because the order is the content. The number
            // sits in its own column so a step that wraps stays aligned under
            // its own text rather than under the digit.
            <ol className="space-y-1.5">
              {steps.map((text, i) => (
                <li key={i} className="flex gap-2 text-micro leading-snug text-foreground/85">
                  <span
                    aria-hidden="true"
                    className="shrink-0 tabular-nums font-bold text-primary w-3.5 text-end"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">{text}</span>
                </li>
              ))}
            </ol>
          )}

          {/* The one thing most likely to go wrong, called out rather than
              buried as a final step. Every guide has exactly one — a list of
              caveats is a list nobody reads. */}
          {watch && (
            <p className="flex gap-2 rounded-lg bg-secondary/60 px-2.5 py-2 text-micro leading-snug text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px text-amber-600 dark:text-amber-500" />
              <span className="min-w-0">
                <span className="font-semibold text-foreground/80">
                  {tFallback('exerciseForm.watchFor', 'Watch for')}
                  {': '}
                </span>
                {watch}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
