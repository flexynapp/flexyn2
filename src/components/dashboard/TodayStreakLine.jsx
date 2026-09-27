// src/components/dashboard/TodayStreakLine.jsx
//
// Today's one streak, under the week sentence in the hero (kegan, 2026-09-27:
// Today shows ONE streak, the training streak, and it lives in the hero).
//
// `streak` is consecutive days with a logged session, walked back from today
// or yesterday by Dashboard from the logs it already holds. It is never
// user_profiles.workout_streak, which nothing decays, so a lapsed user would
// be shown a streak they no longer have.
//
// Nothing below two days. One day in a row is already a filled dot right
// above this line, and a zero is not something to show anybody. The icon is
// muted on purpose: orange on this screen belongs to the ring and the one
// button.

import React from 'react';
import { Flame } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';

export const STREAK_MIN_SHOWN = 2;

export default function TodayStreakLine({ streak = 0, trainedToday = false }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const n = Number(streak) || 0;
  if (n < STREAK_MIN_SHOWN) return null;
  return (
    <p className="flex items-center gap-1 text-label font-semibold text-foreground" data-testid="today-streak">
      <Flame className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>
        {trainedToday
          ? tFallback('today.focal.streak', '{n} day streak.', { n: fmt(n) })
          : tFallback('today.focal.streakKeep', 'A session today keeps your {n} day streak.', { n: fmt(n) })}
      </span>
    </p>
  );
}
