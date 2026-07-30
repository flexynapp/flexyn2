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
import { safeSelect } from '@/api/safeSelect';
import { format, differenceInCalendarDays } from 'date-fns';

/** Streak day → coin reward. Falls through to a baseline for any day not listed. */
const STREAK_COIN_TABLE = {
  1: 5,    2: 10,   3: 20,   5: 50,
  7: 100,  14: 150, 21: 250,
  30: 500, 60: 750, 100: 1500,
};

/**
 * Streak day → coin reward. Milestone days only.
 *
 * This used to fall through to `min(5 + day × 5, 200)` for any day not in the
 * table, which meant every day past day 39 minted 200 coins in perpetuity —
 * the single compounding faucet in the economy. Over six months that fallback
 * alone paid 32,295 coins, more than every other source combined, against a
 * shop whose most expensive item costs 1,000. See C3/C4 in
 * docs/coin-economy-audit-2026-07-29.md.
 *
 * Milestone-only also makes this consistent with `coinsForWorkoutStreakDay`,
 * which has always returned 0 off-milestone. Two streak systems paying on two
 * different models was the asymmetry that hid this.
 *
 * The milestones themselves are untouched — day 30 still pays 500, day 100
 * still pays 1,500. What's gone is the silent daily drip between them.
 */
export function coinsForStreakDay(day) {
  if (day <= 0) return 0;
  return STREAK_COIN_TABLE[day] ?? 0;
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

  const { data: profile, error: readErr } = await safeSelect({
    columns: ['login_streak', 'last_login_date', 'longest_login_streak', 'streak_freezes_available', 'flex_coins'],
    build: (cols) => supabase
      .from('user_profiles')
      .select(cols)
      .eq('id', user.id)
      .maybeSingle(),
  });
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

  let newLongest = Math.max(longest, newStreak);
  let newFreezes = freezeUsed ? Math.max(freezes - 1, 0) : freezes;

  // Streak counters via advance_login_streak (migration 173). The
  // 142/173 privileged-column trigger blocks direct client writes of
  // login_streak / last_login_date / longest_login_streak /
  // streak_freezes_available, so the server re-runs the streak math and
  // returns the authoritative post-state — which overrides the local
  // computation above (kept for the pre-173 fallback below).
  // flex_coins is intentionally NOT part of this write; see the
  // increment_flex_coins call below.
  const { data: advanced, error: advanceErr } = await supabase
    .rpc('advance_login_streak', { p_today: today });
  if (!advanceErr && advanced) {
    if (advanced.is_new_day !== true) {
      // Another tab/device already recorded today's login.
      return { isNewDay: false, streak: advanced.streak ?? currentStreak, coinsAwarded: 0, eliteCapsuleAwarded: false, freezeUsed: false };
    }
    newStreak  = advanced.streak ?? newStreak;
    newLongest = advanced.longest ?? newLongest;
    freezeUsed = advanced.freeze_used === true;
    newFreezes = advanced.freezes_remaining ?? newFreezes;
  } else if (advanceErr && (advanceErr.code === '42883' || advanceErr.code === '42P01')) {
    // Pre-173 host: the RPC doesn't exist, but neither does the
    // write-blocking trigger — the legacy direct UPDATE still works.
    const { error: writeErr } = await supabase
      .from('user_profiles')
      .update({
        login_streak: newStreak,
        last_login_date: today,
        longest_login_streak: newLongest,
        streak_freezes_available: newFreezes,
      })
      .eq('id', user.id);
    if (writeErr) {
      console.warn('[loginStreak] update failed:', writeErr);
      return { isNewDay: false, streak: currentStreak, coinsAwarded: 0, eliteCapsuleAwarded: false, freezeUsed: false };
    }
  } else {
    console.warn('[loginStreak] advance_login_streak failed:', advanceErr);
    return { isNewDay: false, streak: currentStreak, coinsAwarded: 0, eliteCapsuleAwarded: false, freezeUsed: false };
  }

  const coinsAwarded = coinsForStreakDay(newStreak);
  const eliteCapsule = eliteCapsuleOnStreakDay(newStreak);

  // Credit coins via the atomic delta RPC (migration 030) so a concurrent
  // grant from another path (capsule open, quest claim, marketplace credit)
  // can't be overwritten. Previously this was a read-flex_coins → add →
  // write-flex_coins dance inside the streak UPDATE above; that lost any
  // grant that landed between the initial profile read and the write.
  //
  // Track whether coins actually landed — the caller may surface a
  // "+N coins" toast off coinsAwarded, so we don't want to claim a
  // grant that never made it to the DB.
  let coinsLanded = coinsAwarded === 0;
  if (coinsAwarded > 0) {
    const { error: coinsErr } = await supabase.rpc('increment_flex_coins', { p_delta: coinsAwarded });
    if (!coinsErr) {
      coinsLanded = true;
    } else {
      // Pre-030 host — fall back to the legacy read-modify-write so the
      // streak coin grant still lands there (pre-030 also predates the
      // 142/173 trigger, so the direct write is allowed). On any other
      // failure, don't RMW: mig 142/173 rejects direct flex_coins
      // writes with 42501, and the race window was the documented bug
      // anyway. coinsLanded stays false so the caller's toast doesn't lie.
      if (coinsErr.code === '42883' || coinsErr.code === '42P01') {
        const fallbackCoins = (profile.flex_coins ?? 0) + coinsAwarded;
        const { error: fallbackErr } = await supabase
          .from('user_profiles')
          .update({ flex_coins: fallbackCoins })
          .eq('id', user.id);
        if (fallbackErr) console.warn('[loginStreak] fallback flex_coins write failed:', fallbackErr);
        else coinsLanded = true;
      } else {
        console.warn('[loginStreak] increment_flex_coins failed (coins not granted):', coinsErr);
      }
    }
  }

  // Grant elite capsule on milestone days. Track success so the
  // return value reflects reality — LoginStreakSync surfaces an
  // "Elite capsule earned!" toast + notification row off
  // eliteCapsuleAwarded; claiming success when the insert errored
  // would lie to the user the same way coinsAwarded did.
  //
  // The previous block tried to import a `_grantCapsuleNoExport` name
  // that has never existed in capsules.js (the actual private helper
  // is `_grantCapsule` and isn't exported); the unused destructure
  // sat as dead code for the entire life of this function.
  let capsuleLanded = false;
  if (eliteCapsule) {
    const { error: capsuleErr } = await supabase.from('user_capsules').insert({
      user_id:    user.id,
      user_email: user.email,
      capsule_type: 'elite',
    });
    if (capsuleErr) {
      console.warn('[loginStreak] elite capsule grant failed:', capsuleErr);
    } else {
      capsuleLanded = true;
    }
  }

  return {
    isNewDay: true,
    streak: newStreak,
    coinsAwarded: coinsLanded ? coinsAwarded : 0,
    eliteCapsuleAwarded: eliteCapsule && capsuleLanded,
    freezeUsed,
  };
}
