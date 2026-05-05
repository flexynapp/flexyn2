// src/lib/data/loginStreak.js
//
// Login streak system. Call recordLogin(user) on app open / dashboard mount.
// Idempotent — calling multiple times in the same day doesn't change anything.
//
// Streak math:
//   - last_login_date == today          → no change
//   - last_login_date == yesterday      → streak += 1, reward issued
//   - last_login_date < yesterday       → use streak_freeze if available,
//                                         otherwise reset to 1
//
// Reward curve (coins on streak day N):
//   Day 1: 5         Day 7: 100        Day 30: 500
//   Day 2: 10        Day 14: 150       Day 60: 750
//   Day 3: 20        Day 21: 250       Day 100: 1500 + elite capsule
//   Day 5: 50

import { supabase } from '@/api/supabaseClient';
import { format, differenceInCalendarDays } from 'date-fns';

/** Streak day → coin reward. Falls through to a baseline for any day not listed. */
const STREAK_COIN_TABLE = {
  1: 5,    2: 10,   3: 20,   5: 50,
  7: 100,  14: 150, 21: 250,
  30: 500, 60: 750, 100: 1500,
};

/** Streak day → base coin reward (linear interpolation between table entries). */
export function coinsForStreakDay(day) {
  if (day <= 0) return 0;
  if (STREAK_COIN_TABLE[day]) return STREAK_COIN_TABLE[day];
  // Default curve: 5 + 5×day, capped at 200 for arbitrary days
  return Math.min(5 + day * 5, 200);
}

/** Check whether a milestone elite capsule should drop on this streak day. */
export function eliteCapsuleOnStreakDay(day) {
  return day === 30 || day === 60 || day === 100;
}

/**
 * Record a login. Returns:
 *   { isNewDay, streak, coinsAwarded, eliteCapsuleAwarded, freezeUsed }
 * Safe to call multiple times in the same day — no-op after first.
 */
export async function recordLogin(user) {
  if (!user?.id) {
    return { isNewDay: false, streak: 0, coinsAwarded: 0, eliteCapsuleAwarded: false, freezeUsed: false };
  }

  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: profile, error: readErr } = await supabase
    .from('user_profiles')
    .select('login_streak, last_login_date, longest_login_streak, streak_freezes_available, flex_coins')
    .eq('id', user.id)
    .maybeSingle();
  if (readErr || !profile) {
    return { isNewDay: false, streak: 0, coinsAwarded: 0, eliteCapsuleAwarded: false, freezeUsed: false };
  }

  const lastLogin = profile.last_login_date;        // null on first ever
  const currentStreak = profile.login_streak ?? 0;
  const longest = profile.longest_login_streak ?? 0;
  const freezes = profile.streak_freezes_available ?? 0;

  // Already logged in today → no-op
  if (lastLogin === today) {
    return {
      isNewDay: false,
      streak: currentStreak,
      coinsAwarded: 0,
      eliteCapsuleAwarded: false,
      freezeUsed: false,
    };
  }

  // Compute new streak
  let newStreak;
  let freezeUsed = false;
  if (!lastLogin) {
    newStreak = 1; // very first login
  } else {
    const diff = differenceInCalendarDays(new Date(today), new Date(lastLogin));
    if (diff === 1) {
      newStreak = currentStreak + 1;
    } else if (diff > 1 && freezes > 0) {
      // Auto-spend a freeze to preserve the streak
      newStreak = currentStreak + 1;
      freezeUsed = true;
    } else {
      newStreak = 1; // streak broken
    }
  }

  const coinsAwarded = coinsForStreakDay(newStreak);
  const eliteCapsule = eliteCapsuleOnStreakDay(newStreak);
  const newLongest = Math.max(longest, newStreak);
  const newCoins = (profile.flex_coins ?? 0) + coinsAwarded;
  const newFreezes = freezeUsed ? Math.max(freezes - 1, 0) : freezes;

  const updates = {
    login_streak: newStreak,
    last_login_date: today,
    longest_login_streak: newLongest,
    streak_freezes_available: newFreezes,
    flex_coins: newCoins,
  };

  const { error: writeErr } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', user.id);
  if (writeErr) {
    console.warn('[loginStreak] update failed:', writeErr);
    return { isNewDay: false, streak: currentStreak, coinsAwarded: 0, eliteCapsuleAwarded: false, freezeUsed: false };
  }

  // Grant elite capsule on milestone days. Don't block the return on this.
  if (eliteCapsule) {
    try {
      const { _grantCapsuleNoExport } = await import('@/lib/data/capsules');
      // Fall through to direct insert if helper isn't exposed
    } catch { /* ignore */ }
    // Direct insert (we don't expose the private _grantCapsule)
    await supabase.from('user_capsules').insert({
      user_id: user.id,
      user_email: user.email,
      capsule_type: 'elite',
    }).then(({ error }) => {
      if (error) console.warn('[loginStreak] elite capsule grant failed:', error);
    });
  }

  return {
    isNewDay: true,
    streak: newStreak,
    coinsAwarded,
    eliteCapsuleAwarded: eliteCapsule,
    freezeUsed,
  };
}
