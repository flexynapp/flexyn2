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

  // Streak counters first — single-writer columns, race-free as a direct
  // UPDATE. flex_coins is intentionally NOT in this update; the coin
  // grant goes through increment_flex_coins below so a concurrent grant
  // from another path (capsule open, quest claim, marketplace credit)
  // can't be overwritten. Previously the read-flex_coins → add → write
  // pattern lost any grant that landed between the read at line ~50
  // and the write here.
  const { error: writeErr } = await supabase
    .from('user_profiles')
    .update({
      workout_streak:           newStreak,
      last_workout_date:        today,
      longest_workout_streak:   newLongest,
    })
    .eq('id', user.id);
  if (writeErr) {
    console.warn('[workoutStreak] update failed:', writeErr);
    return null;
  }

  // Track whether the coins actually landed so the return value
  // doesn't lie to the caller — Workout.jsx pops a "+N coins" toast
  // off coinsAwarded, so claiming coins when neither path succeeded
  // would tell the user they got something they didn't.
  let coinsLanded = coinsAwarded === 0;
  if (coinsAwarded > 0) {
    const { error: coinsErr } = await supabase.rpc('increment_flex_coins', { p_delta: coinsAwarded });
    if (!coinsErr) {
      coinsLanded = true;
    } else {
      // Pre-030 host or transient RPC failure — fall back to the
      // legacy RMW path so the streak grant still lands. Race window
      // is the documented bug we're trying to close; the fallback is
      // strictly for pre-migration deployments.
      if (coinsErr.code !== '42883' && coinsErr.code !== '42P01') {
        console.warn('[workoutStreak] increment_flex_coins failed, falling back to RMW:', coinsErr);
      }
      const fallbackCoins = (profile.flex_coins ?? 0) + coinsAwarded;
      const { error: fallbackErr } = await supabase
        .from('user_profiles')
        .update({ flex_coins: fallbackCoins })
        .eq('id', user.id);
      if (fallbackErr) console.warn('[workoutStreak] fallback flex_coins write failed:', fallbackErr);
      else coinsLanded = true;
    }
  }

  // Grant elite capsule on milestone days. Track success so the
  // return value reflects reality — LoginStreakSync surfaces an
  // "Elite capsule earned!" toast and writes a notification row off
  // eliteCapsuleAwarded; claiming success when the insert errored
  // would lie to the user the same way coinsAwarded did.
  let capsuleLanded = false;
  if (eliteCapsule) {
    const { error: capsuleErr } = await supabase.from('user_capsules').insert({
      user_id:    user.id,
      user_email: user.email,
      capsule_type: 'elite',
    });
    if (capsuleErr) {
      console.warn('[workoutStreak] elite capsule grant failed:', capsuleErr);
    } else {
      capsuleLanded = true;
    }
  }

  return {
    isNewDay: true,
    streak: newStreak,
    coinsAwarded: coinsLanded ? coinsAwarded : 0,
    eliteCapsuleAwarded: eliteCapsule && capsuleLanded,
  };
}
