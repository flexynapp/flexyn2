// src/components/workout/StarterPlanHeroCard.jsx
//
// Big "AI Coach built your plan" hero card for first-time visitors to
// the Workout page. The starter regimen is auto-created at the end of
// onboarding (see lib/data/starterRegimen.js) but used to live two
// taps deep under Regimens. This surfaces it as the FIRST thing the
// user sees and turns it into a one-tap session start.
//
// Render condition (decided by the caller):
//   • user has zero workout logs
//   • a regimen named "Your Starter Plan: …" exists
//
// After the user starts (or skips into freestyle), this card unmounts
// naturally because logs.length goes positive.

import React from 'react';
import { motion } from 'framer-motion';
import { Play, Sparkles, Pencil, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

const GOAL_KEYS = {
  strength:  ['workout.starter.goal.strength',  'Strength'],
  muscle:    ['workout.starter.goal.muscle',    'Muscle'],
  lose:      ['workout.starter.goal.lose',      'Fat loss'],
  endurance: ['workout.starter.goal.endurance', 'Endurance'],
  mobility:  ['workout.starter.goal.mobility',  'Mobility'],
};

const LEVEL_KEYS = {
  newbie:     ['workout.starter.level.newbie',     'Beginner'],
  returning:  ['workout.starter.level.returning',  'Returning'],
  consistent: ['workout.starter.level.consistent', 'Consistent'],
  advanced:   ['workout.starter.level.advanced',   'Advanced'],
};

function pickPrimaryGoal(userProfile) {
  // fitness_goals_arr is the canonical array form; fitness_goals is the
  // legacy comma-separated string. Either may be missing on older accounts.
  const arr = Array.isArray(userProfile?.fitness_goals_arr) ? userProfile.fitness_goals_arr : null;
  if (arr && arr.length) return arr[0];
  const raw = typeof userProfile?.fitness_goals === 'string' ? userProfile.fitness_goals : '';
  return raw.split(',').map(s => s.trim()).filter(Boolean)[0] || null;
}

export default function StarterPlanHeroCard({
  regimen,
  userProfile,
  onStart,
  onCustomize,
  onDismiss,
  // False when a paused session outranks this card on the page. The Train
  // tab gets one orange action, so the start button steps down to outline.
  primary = true,
}) {
  const { tFallback } = useLanguage();
  if (!regimen) return null;

  const goalKey  = pickPrimaryGoal(userProfile);
  const goalLabel = goalKey && GOAL_KEYS[goalKey]
    ? tFallback(GOAL_KEYS[goalKey][0], GOAL_KEYS[goalKey][1])
    : goalKey || null;
  const levelKeyRaw = userProfile?.fitness_level || null;
  const levelLabel = levelKeyRaw && LEVEL_KEYS[levelKeyRaw]
    ? tFallback(LEVEL_KEYS[levelKeyRaw][0], LEVEL_KEYS[levelKeyRaw][1])
    : levelKeyRaw || null;
  const daysCount = Array.isArray(userProfile?.training_days)
    ? userProfile.training_days.length
    : null;

  const exercises = Array.isArray(regimen.exercises) ? regimen.exercises : [];
  const preview = exercises.slice(0, 4);
  const overflow = Math.max(0, exercises.length - preview.length);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full mb-4 overflow-hidden rounded-2xl bg-card border border-border p-5 md:p-6"
    >
      {/* Dismiss — removes the card from the Workout page only. The
          regimen itself stays available under Regimens. */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={tFallback('workout.starter.dismissAria', 'Remove starter plan from Workout page')}
          className="absolute top-3 end-3 z-10 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground bg-background/50 hover:bg-background/80 active:bg-background/80 border border-border/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="relative">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-micro font-bold tracking-[0.18em] uppercase text-primary">
            {tFallback('workout.starter.kicker', 'Built by your AI Coach')}
          </span>
        </div>

        <h2 className="font-heading font-bold text-xl md:text-2xl leading-tight">
          {tFallback('workout.starter.title', 'Your starter plan is ready')}
        </h2>

        {/* Context badges — surface the personalization signals onboarding
            already captured so the user sees this plan was custom-fit. */}
        {(goalLabel || levelLabel || daysCount) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {goalLabel && (
              <span className="px-2 py-0.5 rounded-full text-micro font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/25">
                {goalLabel}
              </span>
            )}
            {levelLabel && (
              <span className="px-2 py-0.5 rounded-full text-micro font-bold uppercase tracking-wider bg-secondary/60 text-foreground border border-border">
                {levelLabel}
              </span>
            )}
            {daysCount ? (
              <span className="px-2 py-0.5 rounded-full text-micro font-bold uppercase tracking-wider bg-secondary/60 text-foreground border border-border tabular-nums">
                {tFallback('workout.starter.daysPerWeek', '{n}×/week', { n: daysCount })}
              </span>
            ) : null}
          </div>
        )}

        {/* Exercise preview — proves the plan is real and not a stock copy. */}
        {preview.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {preview.map((ex, i) => (
              <li key={`${ex.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground/90">{ex.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {ex.target_sets || 3} × {ex.target_reps ?? '—'}
                </span>
              </li>
            ))}
            {overflow > 0 && (
              <li className="text-xs text-muted-foreground italic">
                {tFallback('workout.starter.moreCount', '+{n} more', { n: overflow })}
              </li>
            )}
          </ul>
        )}

        <div className="mt-5 flex items-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => onStart?.(regimen)}
            className={`flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-colors ${primary ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/90' : 'border border-border bg-background/60 text-foreground hover:bg-secondary active:bg-secondary'}`}
          >
            <Play className="w-4 h-4 fill-current" />
            {tFallback('workout.starter.startCta', 'Start your first workout')}
          </motion.button>
          {onCustomize && (
            <button
              type="button"
              onClick={() => onCustomize(regimen)}
              className="inline-flex items-center gap-1.5 px-3 py-3 rounded-xl border border-border bg-background/60 text-sm font-semibold text-foreground hover:bg-secondary/50 active:bg-secondary/50 transition-colors"
              aria-label={tFallback('workout.starter.customizeAria', 'Customize starter plan')}
            >
              <Pencil className="w-3.5 h-3.5" />
              {tFallback('workout.starter.customize', 'Customize')}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
