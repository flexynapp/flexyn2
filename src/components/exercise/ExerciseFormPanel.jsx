// src/components/exercise/ExerciseFormPanel.jsx
//
// "How to" — the start / middle / end triptych for one exercise, behind a
// disclosure.
//
// COLLAPSED BY DEFAULT, and that is the whole design. Someone who already
// knows what a Barbell Row is should not pay ~120px of a 390px screen for a
// picture of one, on every exercise, forever. Someone who does not know is
// one tap away, and that tap is the strongest signal we get that the picture
// is wanted. Same reasoning as EvidencePanel in CoachPlanCard, whose shape
// this deliberately mirrors so the two disclosures read as one idea.
//
// It renders NOTHING when the exercise has no pose. 39 of the catalog are
// drawn and the app's vocabulary is larger, so a missing diagram is the
// normal case, not an error — and a "no diagram available" row would be a
// worse card than no row at all.
//
// The figure is lazy. Geometry + 117 poses is ~35 KB that nobody who leaves
// this collapsed should download, which is the same rule the repo already
// applies to modals and tabs (see the lazy-loading note in CLAUDE.md).

import React, { useState, Suspense } from 'react';
import { ChevronDown, Shapes } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { posesFor } from '@/lib/data/exercisePoses';

const ExerciseDiagram = React.lazy(() =>
  import('@/components/exercise/ExerciseFigure').then((m) => ({ default: m.ExerciseDiagram })),
);

/**
 * @param {string} exerciseName  canonical English name, as stored
 * @param {string} className     spacing from the caller, since the two hosts
 *                               sit in cards with different rhythms
 */
export default function ExerciseFormPanel({ exerciseName, className = '' }) {
  const { tFallback } = useLanguage();
  const [open, setOpen] = useState(false);

  const poses = posesFor(exerciseName);
  if (!poses) return null;

  // TODO(i18n): the cues live in English in exercisePoses.js and are the
  // single source, so tFallback resolves to them until a translator adds
  // `exerciseCues.*` to a part file. Per CLAUDE.md these are prose on a
  // prominent surface, so English-only beats machine translation — but they
  // ARE currently English in all 15 languages. Do not call this done.
  const slug = exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const labels = poses.labels.map((label, i) => tFallback(`exerciseCues.${slug}.${i}`, label));

  return (
    <div className={`rounded-xl border border-border bg-secondary/30 overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // Named, not just "How to": on the Workout page every exercise card
        // carries one of these, so an unnamed control gives a screen-reader
        // user a column of identical buttons.
        aria-label={tFallback('exerciseForm.showFor', `How to do ${exerciseName}`)}
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
        <div className="px-3 pb-2.5">
          <Suspense fallback={null}>
            <ExerciseDiagram frames={poses.frames} labels={labels} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
