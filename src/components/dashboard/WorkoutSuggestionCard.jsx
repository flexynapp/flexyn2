// src/components/dashboard/WorkoutSuggestionCard.jsx
//
// "Tomorrow's focus" card on the Dashboard. Reads from the user's
// existing rawLogs prop (no extra round-trip) and runs the
// computeSuggestion heuristic in src/lib/workoutSuggestion.js to
// pick a muscle-group focus + reason for tomorrow.
//
// Renders nothing when there isn't enough data — fewer than 2
// workouts in the past 7 days makes any suggestion based on noise,
// not signal. We'd rather show empty space than a wrong guess.

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import {
  Lightbulb, ArrowRight,
  Dumbbell, Grip, Footprints, Mountain, HeartPulse, Target, Leaf,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/lib/LanguageContext';
import { computeSuggestion } from '@/lib/workoutSuggestion';

// Map focus → icon + English-label fallback.
//
// The emoji used to live INSIDE the translatable fallback string
// ('🦵 Legs day'), which is the worst place for it: every translator
// inherits the glyph, it can't be restyled, and it rendered next to a
// generic Lightbulb badge that was already doing the icon's job. Icon
// and label are separate concerns now — the badge shows the focus, the
// string is pure translatable text. (Verified no `suggestion.focusLabel.*`
// key is translated yet, so nothing carries a stale glyph.)
//
// Same icon vocabulary as TodaysPlanCard on purpose: "legs" must not be
// Footprints on one card and something else on the card below it.
const FOCUS_META = {
  legs:      { Icon: Footprints, label: 'Legs day' },
  chest:     { Icon: Dumbbell,   label: 'Chest day' },
  back:      { Icon: Grip,       label: 'Back day' },
  shoulders: { Icon: Mountain,   label: 'Shoulders day' },
  arms:      { Icon: Dumbbell,   label: 'Arms day' },
  core:      { Icon: Target,     label: 'Core focus' },
  cardio:    { Icon: HeartPulse, label: 'Light cardio' },
  recovery:  { Icon: Leaf,       label: 'Recovery day' },
};

// The reason's group names arrive as slugs ("chest"); name them in the
// reader's language before they go into the sentence.
function groupVars(vars = {}, tFallback) {
  const out = { ...vars };
  for (const k of ['group', 'most']) {
    if (out[k]) out[k] = tFallback(`suggestion.group.${out[k]}`, out[k]);
  }
  return out;
}

export default function WorkoutSuggestionCard({ logs = [], cardioLogs = [] }) {
  const { tFallback } = useLanguage();
  const navigate = useNavigate();

  const suggestion = useMemo(
    () => computeSuggestion({ logs, cardioLogs }),
    [logs, cardioLogs]
  );

  if (!suggestion) return null;

  const meta = FOCUS_META[suggestion.focus];
  const label = tFallback(
    `suggestion.focusLabel.${suggestion.focus}`,
    meta?.label || suggestion.focus
  );
  // Lightbulb is the fallback for a focus we have no icon for, so the
  // badge is never empty.
  const FocusIcon = meta?.Icon || Lightbulb;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <Card className="overflow-hidden border-border/60">
        <button
          onClick={() => navigate('/workout')}
          // cq-stack: [icon 36][text][arrow 16] with px-4 and two gap-3s
          // leaves the text column ~60px in a half-width dashboard slot — the
          // same width that reduced a quest title to "Train fo…".
          className="w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors cq-stack"
        >
          <div className="shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <FocusIcon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-micro font-bold tracking-[0.04em] text-primary">
                {tFallback('suggestion.kicker', 'Tomorrow')}
              </span>
              <span className="text-sm font-heading font-bold">{label}</span>
            </div>
            <p className="text-micro text-muted-foreground leading-snug mt-0.5 truncate">
              {suggestion.reasonKey
                ? tFallback(suggestion.reasonKey, suggestion.reason, groupVars(suggestion.reasonVars, tFallback))
                : suggestion.reason}
            </p>
          </div>
          {/* The whole row is the tap target. */}
          <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground rtl:scale-x-[-1] cq-hide" aria-hidden="true" />
        </button>
      </Card>
    </motion.div>
  );
}
