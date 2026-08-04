// src/components/workout/ComebackScreen.jsx
//
// Full-screen overlay shown to returning users after 7+ days away.
// Tone: matter-of-fact, forward-looking, zero judgment. No streak guilt.
//
// Props:
//   daysSince     — number of days since last workout
//   workoutLogs   — all of the user's workout logs (for session generation)
//   userProfile   — for bodyweight estimates
//   onStartSession(exercises, title) — loads the comeback session into workout flow
//   onSkip        — user bypasses the protocol, goes to normal workout

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { format, subDays } from 'date-fns';
import { Dumbbell, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';

// ── Comeback session generator ────────────────────────────────────────────────
// Pulls exercises the user has done before from the 30 days prior to absence.
// Scales everything to 65% of their typical volume.
// Caps at 45 minutes (~5 exercises, 3 sets each).

function buildComebackSession(workoutLogs, daysSince, userProfile = {}) {
  // The absence window: anything older than (daysSince) days
  const absenceStart = subDays(new Date(), daysSince);
  const lookbackEnd  = new Date(absenceStart);
  const lookbackStart = subDays(lookbackEnd, 30);

  // Filter logs to the 30-day window before absence
  const priorLogs = workoutLogs.filter(log => {
    if (!log.date) return false;
    const d = new Date(log.date);
    return d >= lookbackStart && d <= lookbackEnd;
  });

  if (priorLogs.length === 0) return null; // edge case: no prior logs in window

  // Aggregate: per exercise: sum of (weight × reps) across all logged sets → avg per session
  const exerciseMap = {};
  for (const log of priorLogs) {
    for (const ex of (log.exercises || [])) {
      const name = ex.name?.trim();
      if (!name) continue;
      const groups = ex.muscle_groups?.length ? ex.muscle_groups : (ex.muscle_group ? [ex.muscle_group] : []);
      if (!exerciseMap[name]) {
        exerciseMap[name] = { name, groups, sessions: 0, totalSets: 0, sumWeight: 0, sumReps: 0 };
      }
      const entry = exerciseMap[name];
      entry.sessions++;
      for (const set of (ex.sets || [])) {
        entry.totalSets++;
        entry.sumWeight += Number(set.weight) || 0;
        entry.sumReps   += Number(set.reps)   || 0;
      }
    }
  }

  if (Object.keys(exerciseMap).length === 0) return null;

  // Sort by frequency (sessions desc), then take top 5
  const sorted = Object.values(exerciseMap)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5);

  // Build scaled exercises
  const SCALE = 0.65;
  const exercises = sorted.map(entry => {
    const setsPerSession = Math.round(entry.totalSets / Math.max(1, entry.sessions));
    const avgWeight      = entry.sumWeight / Math.max(1, entry.totalSets);
    const avgReps        = Math.round(entry.sumReps / Math.max(1, entry.totalSets));

    // Round scaled weight to a sensible plate step. Stored unit is
    // LBS, so for lbs users we round to the nearest 5 lb plate; for
    // KG users we round to the nearest 2.5 kg (≈ 5.5 lb) so the
    // displayed kg value lands on a clean half-kilo. Previously the
    // round was always to nearest 5 lb regardless of unit, so kg
    // users saw ugly fractional values like 59.0 kg, 70.3 kg.
    // (Audit 09 #H-10.)
    const KG_STEP_LBS = 2.5 * 2.20462;          // 5.51155 lbs ≈ 2.5 kg
    const step = userProfile?.weight_unit === 'kg' ? KG_STEP_LBS : 5;
    const scaledWeight = Math.max(0, Math.round((avgWeight * SCALE) / step) * step);
    const scaledSets   = Math.max(2, Math.min(3, setsPerSession)); // cap at 3 sets
    const scaledReps   = Math.max(8, avgReps); // don't go lower than 8 reps

    return {
      name:          entry.name,
      muscle_group:  entry.groups[0] || '',
      muscle_groups: entry.groups,
      comeback:      true, // flag for XP bonus detection
      sets: Array.from({ length: scaledSets }, () => ({
        weight: scaledWeight || null,
        reps:   scaledReps,
      })),
    };
  });

  return exercises;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ComebackScreen({ daysSince, workoutLogs = [], userProfile = {}, onStartSession, onSkip }) {
  const [loading, setLoading] = useState(false);

  const weekLabel = format(new Date(), "'Week of' MMM d");
  const hasPriorHistory = workoutLogs.length >= 3;

  const handleLetGo = async () => {
    if (!hasPriorHistory) {
      // Not enough history — skip to normal workout
      onSkip();
      return;
    }

    setLoading(true);
    try {
      const exercises = buildComebackSession(workoutLogs, daysSince, userProfile);
      if (!exercises || exercises.length === 0) {
        toast.info('Not enough history to build a comeback session. Loading your normal workout.');
        onSkip();
        return;
      }
      const title = `Comeback Session — ${weekLabel}`;
      onStartSession(exercises, title);
    } catch (e) {
      console.error('[comeback]', e);
      toast.error('Could not build comeback session. Loading normal workout.');
      onSkip();
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-background flex flex-col items-center justify-center px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Icon */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 24 }}
        className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-8"
      >
        <Dumbbell className="w-8 h-8 text-primary" />
      </motion.div>

      {/* Copy */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18 }}
        className="text-center mb-10 max-w-xs"
      >
        <h1 className="font-heading font-black text-3xl text-foreground mb-3 leading-tight">
          Welcome back.
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {`It's been ${daysSince} day${daysSince !== 1 ? 's' : ''}.`}
          {hasPriorHistory
            ? " Here's a session to ease back in."
            : ' Ready to get started?'}
        </p>
        {hasPriorHistory && (
          <p className="text-xs text-muted-foreground/60 mt-2">
            Scaled to 65% of your typical volume — same exercises, lighter load.
          </p>
        )}
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26 }}
        className="w-full max-w-xs space-y-3"
      >
        <Button
          onClick={handleLetGo}
          disabled={loading}
          className="w-full h-12 text-base font-semibold gap-2"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Building your session…</>
            : <><Sparkles className="w-4 h-4" /> {hasPriorHistory ? "Let's go" : 'Start workout'}</>
          }
        </Button>

        <button
          onClick={onSkip}
          className="w-full text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors py-2"
        >
          Skip — take me to my normal workout
          <ArrowRight className="inline w-3.5 h-3.5 ms-1" />
        </button>
      </motion.div>
    </motion.div>
  );
}
