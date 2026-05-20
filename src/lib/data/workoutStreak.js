// src/lib/data/workoutStreak.js
//
// Workout streak — a separate streak from login streak. Counts consecutive
// days the user has actually logged a workout (strength OR cardio). Login
// streak rewards opening the app; workout streak rewards real exercise.
//
// Lifecycle:
//   • Workout.jsx and the cardio components call recordWorkoutDay(user) on
//     successful save.
//   • That increments workout_streak if last_workout_date was yesterday or
//     today, else resets to 1.
//   • longest_workout_streak is bumped when current exceeds previous best.
//
// Reward curve: same shape as login streak but the milestones are tighter
// (workout streaks are harder to maintain).

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { format, differenceInCalendarDays } from 'date-fns';

const STREAK_COIN_TABLE = {
  3: 25, 5: 50, 7: 100, 14: 200, 21: 350,
  30: 600, 60: 1000, 100: 2000,
};

/** Coins awarded when the streak hits day N. */
export function coinsForWorkoutStreakDay(day) {
  if (day <= 0) return 0;
  if (STREAK_COIN_TABLE[day]) return STREAK_COIN_TABLE[day];
  return 0; // only milestone days award coins for workout streak
}

export function eliteCapsuleOnWorkoutStreakDay(day) {
  return day === 30 || day === 60 || day === 100;
}

/**
 * Record that the user completed a workout today. Idempotent for the same
 * day — calling repeatedly only increments once. Returns:
 *   { isNewDay, streak, coinsAwarded, eliteCapsuleAwarded } | null
 *
 * Non-blocking on the calling flow — wrap with .catch(() => {}) at call sites.
 */
export async function recordWorkoutDay(user) {
  if (!user?.id) return null;

  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: profile, error: readErr } = await safeSelect({
    columns: ['workout_streak', 'last_workout_date', 'longest_workout_streak', 'flex_coins'],
    build: (cols) => supabase
      .from('user_profiles')
      .select(cols)
      .eq('id', user.id)
      .maybeSingle(),
  });
  if (readErr || !profile) return null;

  const lastDate = profile.last_workout_date;
  const currentStreak = profile.workout_streak ?? 0;
  const longest = profile.longest_workout_streak ?? 0;

  // Already recorded today
  if (lastDate === today) {
    return { isNewDay: false, streak: currentStreak, coinsAwarded: 0, eliteCapsuleAwarded: false };
  }

  // Compute new streak
  let newStreak;
  if (!lastDate) {
    newStreak = 1;
  } else {
    const diff = differenceInCalendarDays(new Date(today), new Date(lastDate));
    if (diff === 1) {
      newStreak = currentStreak + 1;
    } else {
      newStreak = 1;
    }
  }

  const coinsAwarded = coinsForWorkoutStreakDay(newStreak);
  const eliteCapsule = eliteCapsuleOnWorkoutStreakDay(newStreak);
  const newLongest = Math.max(longest, newStreak);
  const newCoins = (profile.flex_coins ?? 0) + coinsAwarded;

  const { error: writeErr } = await supabase
    .from('user_profiles')
    .update({
      workout_streak:           newStreak,
      last_workout_date:        today,
      longest_workout_streak:   newLongest,
      flex_coins:               newCoins,
    })
    .eq('id', user.id);
  if (writeErr) {
    console.warn('[workoutStreak] update failed:', writeErr);
    return null;
  }

  // Grant elite capsule on milestone days (best-effort)
  if (eliteCapsule) {
    await supabase.from('user_capsules').insert({
      user_id:    user.id,
      user_email: user.email,
      capsule_type: 'elite',
    }).then(({ error }) => {
      if (error) console.warn('[workoutStreak] capsule grant failed:', error);
    });
  }

  return { isNewDay: true, streak: newStreak, coinsAwarded, eliteCapsuleAwarded: eliteCapsule };
}
