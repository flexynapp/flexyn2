// src/components/progress/TrainingPatternCard.jsx
//
// "You usually train Mon · Wed · Fri at 6:30 PM" insight surfaced on
// the Progress page. People are flattered when an app notices their
// patterns — pure relationship warmth, like Strava's "you're a Tuesday
// person."
//
// Reads from already-fetched workout logs (no additional server hits).
// Renders nothing for users without enough data to declare a pattern
// (< MIN_OCCURRENCES of any day in the trailing 8-week window).

import { motion } from 'framer-motion';
import { Calendar } from 'lucide-react';
import { useMemo } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { computeTrainingPattern } from '@/lib/data/trainingPatterns';

export default function TrainingPatternCard({ workoutLogs = [] }) {
  const { tFallback } = useLanguage();
  const pattern = useMemo(() => computeTrainingPattern(workoutLogs), [workoutLogs]);
  if (!pattern) return null;

  const daysLabel = pattern.days.join(' · ');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex items-center gap-3 p-3 rounded-xl bg-secondary/40 border border-border/60"
    >
      <div className="w-8 h-8 rounded-lg bg-primary/12 flex items-center justify-center shrink-0">
        <Calendar className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {tFallback('trainingPattern.kicker', 'Your training rhythm')}
        </p>
        <p className="text-sm font-medium leading-tight mt-0.5">
          <span className="text-foreground">{daysLabel}</span>
          <span className="text-muted-foreground"> at </span>
          <span className="text-foreground tabular-nums">{pattern.medianHourLabel}</span>
        </p>
      </div>
    </motion.div>
  );
}
