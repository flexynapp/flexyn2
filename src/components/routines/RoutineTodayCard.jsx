// src/components/routines/RoutineTodayCard.jsx
//
// "Today's plan" card on the Workout start screen. Reads the user's ACTIVE
// routine and shows today's day — one tap to start it pre-loaded with the
// lifts they picked. Plus a square "My Routine" button to manage routines,
// and a playful "Up for a challenge?" add-on. Falls back to a build-CTA when
// no routine is active, and a calm card on rest days.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarDays, Play, Moon, Sparkles, Dumbbell, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { getActiveRoutine, todayIndex, DAY_NAMES_FULL } from '@/lib/data/routines';
import { useLanguage } from '@/lib/LanguageContext';

export default function RoutineTodayCard({ onStart, onOpenRoutines, onChallenge }) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const { data: routine } = useQuery({
    queryKey: ['activeRoutine', user?.id],
    queryFn: getActiveRoutine,
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const idx = todayIndex();
  const dayName = DAY_NAMES_FULL[idx];
  const day = routine?.days?.[idx] || null;
  const hasExercises = !!day && !day.isRest && Array.isArray(day.exercises) && day.exercises.length > 0;

  // No active routine yet → build CTA.
  if (!routine) {
    return (
      <motion.button
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        onClick={onOpenRoutines}
        className="w-full mb-4 rounded-3xl border border-dashed border-primary/40 bg-primary/[0.05] p-4 text-start flex items-center gap-3"
      >
        <div className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
          <CalendarDays className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-sm">{tFallback("routineTodayCard.buildYourRoutine", "Build your routine")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Set up your week — label your days and add the lifts you actually do.</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </motion.button>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
      <Card className="overflow-hidden border-primary/40">
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="kicker text-primary">{dayName} · today</span>
          <span className="text-micro text-muted-foreground truncate">{routine.name}</span>
          <button onClick={onOpenRoutines} aria-label={tFallback("routineTodayCard.myRoutine", "My Routine")}
            className="ms-auto w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary shrink-0">
            <CalendarDays className="w-4 h-4" />
          </button>
        </div>

        {day?.isRest ? (
          <div className="px-4 pb-4 pt-2 flex items-center gap-3">
            <Moon className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-heading font-bold">{tFallback("progress.analytics.restDay", "Rest day")}</p>
              <p className="text-xs text-muted-foreground">Recover up — you earned it.</p>
            </div>
          </div>
        ) : hasExercises ? (
          <div className="px-4 pb-4 pt-2">
            <p className="font-heading font-bold text-lg leading-tight">{day.label || 'Today'}</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3 truncate">
              {day.exercises.map(e => e.name).slice(0, 4).join(' · ')}{day.exercises.length > 4 ? '…' : ''}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onStart(day.exercises, day.label)}
                className="flex-1 h-11 rounded-2xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" /> Start {day.label || 'workout'}
              </button>
              <button
                onClick={() => onChallenge(day.focus, day.exercises, day.label)}
                aria-label={tFallback("routineTodayCard.upForAChallenge", "Up for a challenge")}
                title={tFallback("routineTodayCard.upForAChallengeAdd", "Up for a challenge. Add a bonus finisher")}
                className="h-11 px-3 rounded-2xl border border-primary/40 text-primary font-bold text-sm flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4" /> {tFallback("routineTodayCard.challenge", "Challenge")}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={onOpenRoutines} className="w-full px-4 pb-4 pt-2 text-start flex items-center gap-3">
            <Dumbbell className="w-5 h-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-heading font-bold">{day?.label || `${dayName} — not set up`}</p>
              <p className="text-xs text-muted-foreground">{tFallback('routineToday.addHint', "Tap to add today's lifts to your routine.")}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
      </Card>
    </motion.div>
  );
}
