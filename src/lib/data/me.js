// src/lib/data/me.js
// Reads / writes the currently authenticated user's profile.
import { db } from '@/api/db';
import { containsProfanity } from '@/lib/profanityFilter';

export const get = () => db.auth.me();

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

export const update = (data) => {
  const textFields = {};
  if (data.username !== undefined) textFields.username = data.username;
  if (data.bio !== undefined) textFields.bio = data.bio;
  if (data.city !== undefined) textFields.city = data.city;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.auth.updateMe(data);
};
export const logout = () => db.auth.logout();

/**
 * Reset every cumulative counter and clear profile fields on the
 * current user's record. Used as part of account deletion. This makes
 * the row "ghost-like" so the existing filterAfterReset and ghost-user
 * filters in the leaderboards hide the account.
 *
 * IMPORTANT: also clears one-time grant flags so re-onboarding feels
 * like a fresh start. Without these resets, a user who resets and
 * re-onboards would silently miss the day-1 capsule reward, the
 * level-up rewards (because the awarded-through counter was at their
 * old peak level), the daily chest (locked to "already claimed today"),
 * and the achievement-milestone capsules. The audit caught this on
 * the first-workout reward specifically; all four flags share the
 * same bug class so they're all reset here.
 *
 * Unknown columns: db.js's create/updateMe retries on 42703 / PGRST204
 * and strips the missing column, so this is safe on hosts that
 * haven't applied every migration in the chain.
 */
export const resetForDeletion = () => db.auth.updateMe({
  // Identity / profile fields
  username: '',
  gender: null,
  birthday: null,
  height_inches: null,
  weight_lbs: null,
  country_code: null,
  state_code: null,
  avatar_url: null,
  bio: null,
  city: null,

  // Cumulative stats — back to zero
  total_xp: 0,
  current_level: 1,
  achievements_unlocked_count: 0,
  total_volume_lbs: 0,
  total_distance_meters: 0,
  flex_coins: 0,

  // Streaks
  workout_streak: 0,
  longest_workout_streak: 0,
  login_streak: 0,
  longest_login_streak: 0,

  // League tier — start over from bronze
  league_tier: 'bronze',

  // One-time grant flags — clearing these is what was missing before.
  // Each unlocked here means the user gets the corresponding reward
  // again on their next eligible event (mirrors "fresh start" UX).
  first_workout_capsule_granted: false,
  level_capsules_awarded_through: 0,   // mig 070
  milestone_capsules_awarded: 0,
  last_daily_chest_at: null,           // mig 068

  // Nemesis / prestige state — start clean
  overthrow_count: 0,
  nemesis_opt_out: false,

  // Onboarding state — back to gate so the next sign-in shows
  // Onboarding rather than dropping them on a half-built Dashboard.
  onboarding_complete: false,
  onboarding_completed: false,
  onboarding_completed_at: null,

  account_reset_at: new Date().toISOString(),
});