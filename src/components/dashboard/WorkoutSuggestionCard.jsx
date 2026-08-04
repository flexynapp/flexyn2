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
import { Lightbulb, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/lib/LanguageContext';
import { computeSuggestion } from '@/lib/workoutSuggestion';

// Map focus → emoji prefix + English-label fallback. The label is
// resolved via tFallback at render time so non-English locales can
// translate it via the `suggestion.focusLabel.*` keys; the emoji
// stays in the fallback string so untranslated locales still get the
// visual cue.
const FOCUS_LABEL_FALLBACK = {
  legs:      '🦵 Legs day',
  chest:     '💪 Chest day',
  back:      '🔱 Back day',
  shoulders: '🪨 Shoulders day',
  arms:      '💪 Arms day',
  core:      '🎯 Core focus',
  cardio:    '🏃 Light cardio',
  recovery:  '🌿 Recovery day',
};

export default function WorkoutSuggestionCard({ logs = [], cardioLogs = [] }) {
  const { tFallback } = useLanguage();
  const navigate = useNavigate();

  const suggestion = useMemo(
    () => computeSuggestion({ logs, cardioLogs }),
    [logs, cardioLogs]
  );

  if (!suggestion) return null;

  const label = tFallback(
    `suggestion.focusLabel.${suggestion.focus}`,
    FOCUS_LABEL_FALLBACK[suggestion.focus] || suggestion.focus
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="overflow-hidden border-border/60">
        <button
          onClick={() => navigate('/workout')}
          className="w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors"
        >
          <div className="shrink-0 w-9 h-9 rounded-full bg-primary/12 text-primary flex items-center justify-center">
            <Lightbulb className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-micro font-bold uppercase tracking-[0.18em] text-primary">
                {tFallback('suggestion.kicker', 'Tomorrow')}
              </span>
              <span className="text-sm font-heading font-bold">{label}</span>
            </div>
            <p className="text-micro text-muted-foreground leading-snug mt-0.5 truncate">
              {tFallback(`suggestion.reason.${suggestion.focus}`, suggestion.reason)}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
        </button>
      </Card>
    </motion.div>
  );
}
