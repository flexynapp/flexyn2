// src/lib/useFeatureGate.js
//
// Progressive-disclosure feature gates. Hides gamification + advanced
// surfaces from brand-new users so the core loop (log workout → see
// progress → repeat) has air to breathe. Returns true when a feature
// is unlocked for the current user.
//
// Thresholds chosen to match natural retention milestones:
//   • workouts_logged — the only signal that the user has actually
//     used the app. Self-reported (profile.total_xp) is too easy to
//     game; this counts real workout_logs rows in the user's history.
//   • days_since_signup — fall-back for users who can't or won't log
//     workouts (e.g. nutrition-only users) so they still eventually
//     unlock social features.
//   • current_level / streak — auxiliary signals.
//
// Usage:
//   const showLeagues = useFeatureGate('leagues', { logs, profile });
//   if (!showLeagues) return null;
//
// The hook is pure-functional + zero-state (just reads the inputs);
// no localStorage / no extra fetches. Safe to call dozens of times
// per render.
//
// Feature → unlock criteria:
//   • core              — always on (workout/cardio/nutrition/goals)
//   • streak            — 1 workout logged
//   • daily_quests      — 1 workout logged
//   • daily_chest       — 3 workouts logged
//   • wellness_detail   — 3 workouts logged (mood/sleep/recovery)
//   • duels             — 5 workouts logged
//   • crews             — 3 workouts logged + following ≥1
//   • leagues           — 5 workouts logged (week-2 onward)
//   • nemesis           — 7 workouts logged + week-1+ since signup
//   • bounties          — 10 workouts logged
//   • gauntlet          — 14-day workout streak OR 20 workouts
//   • trainer_market    — 30 workouts logged
//   • coach             — 3 workouts (so it has data to comment on)
//   • capsules          — 3 workouts logged
//   • prestige          — handled separately (isPrestigeEligible)
//
// Override: a user can flip the global override flag in Settings
// (localStorage 'flexyn.showAdvancedFeatures' = 'true') to unlock
// everything immediately. Power users + dev testing.

import { useMemo } from 'react';

const UNLOCK = {
  // Always-on core surfaces — never hidden.
  core:              () => true,
  workout_logging:   () => true,
  cardio_logging:    () => true,
  nutrition_logging: () => true,
  goals:             () => true,
  hub_feed:          () => true,
  dms:               () => true,
  progress:          () => true,
  settings:          () => true,

  // Gamification — gated. Each is a `(ctx) => boolean`.
  streak:          (c) => c.workouts >= 1,
  daily_quests:    (c) => c.workouts >= 1,
  daily_chest:     (c) => c.workouts >= 3,
  capsules:        (c) => c.workouts >= 3,
  wellness_detail: (c) => c.workouts >= 3,
  coach:           (c) => c.workouts >= 3,
  crews:           (c) => c.workouts >= 3,
  duels:           (c) => c.workouts >= 5,
  leagues:         (c) => c.workouts >= 5,
  nemesis:         (c) => c.workouts >= 7 && c.daysSinceSignup >= 7,
  bounties:        (c) => c.workouts >= 10,
  gauntlet:        (c) => c.workoutStreak >= 14 || c.workouts >= 20,
  trainer_market:  (c) => c.workouts >= 30,
};

/**
 * Compute the unlock context once per render of the parent.
 * Cheap: a couple of object lookups + length read.
 */
export function buildGateContext({ logs, profile, user }) {
  const workouts = Array.isArray(logs) ? logs.length : 0;
  const workoutStreak = Number(profile?.workout_streak) || 0;
  const created = profile?.created_at || user?.created_at;
  let daysSinceSignup = 0;
  if (created) {
    const ms = Date.now() - new Date(created).getTime();
    daysSinceSignup = Math.max(0, Math.floor(ms / 86_400_000));
  }
  return { workouts, workoutStreak, daysSinceSignup };
}

/**
 * Power-user override — flip ALL gates open. Lives in localStorage
 * so it survives reloads; toggled from Settings (future) or via
 * devtools (`localStorage.setItem('flexyn.showAdvancedFeatures', 'true')`).
 */
function isOverridden() {
  try {
    return localStorage.getItem('flexyn.showAdvancedFeatures') === 'true';
  } catch { return false; }
}

/**
 * Returns true when the feature is unlocked for the current user.
 * Memoized on the (feature, context) tuple so a render that calls
 * `useFeatureGate` for 6 different features only re-evaluates when
 * the underlying counts actually change.
 */
export function useFeatureGate(feature, { logs, profile, user } = {}) {
  return useMemo(() => {
    if (isOverridden()) return true;
    const check = UNLOCK[feature];
    if (!check) return true; // unknown feature → fail-open (don't hide silently)
    const ctx = buildGateContext({ logs, profile, user });
    return !!check(ctx);
  }, [feature, logs, profile, user]);
}

/**
 * Returns the "next unlock" — the feature the user is closest to
 * earning. Used for the "X more workouts to unlock Duels" teaser
 * that itself becomes a retention loop.
 *
 * Walks the locked features in unlock-threshold order and returns the
 * first one not yet unlocked, with a human-readable progress string.
 */
export function nextUnlock({ logs, profile, user } = {}) {
  if (isOverridden()) return null;
  const ctx = buildGateContext({ logs, profile, user });

  // Order matters — earliest unlock first.
  const ladder = [
    { feature: 'streak',          remaining: 1  - ctx.workouts, label: 'Streak tracking' },
    { feature: 'daily_chest',     remaining: 3  - ctx.workouts, label: 'Daily Chest + Capsules' },
    { feature: 'crews',           remaining: 3  - ctx.workouts, label: 'Crews' },
    { feature: 'duels',           remaining: 5  - ctx.workouts, label: 'Duels + Leagues' },
    { feature: 'nemesis',         remaining: 7  - ctx.workouts, label: 'Nemesis' },
    { feature: 'bounties',        remaining: 10 - ctx.workouts, label: 'Bounties' },
    { feature: 'gauntlet',        remaining: 20 - ctx.workouts, label: 'Gauntlet' },
    { feature: 'trainer_market',  remaining: 30 - ctx.workouts, label: 'Trainer Marketplace' },
  ];
  for (const entry of ladder) {
    if (entry.remaining > 0) {
      return {
        feature: entry.feature,
        label: entry.label,
        workoutsRemaining: entry.remaining,
        sub: entry.remaining === 1
          ? '1 workout away'
          : `${entry.remaining} workouts away`,
      };
    }
  }
  return null;
}
