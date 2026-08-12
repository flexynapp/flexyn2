// src/lib/data/me.js
// Reads / writes the currently authenticated user's profile.
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
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
  if (data.display_name !== undefined) textFields.display_name = data.display_name;
  if (data.bio !== undefined) textFields.bio = data.bio;
  if (data.city !== undefined) textFields.city = data.city;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.auth.updateMe(data);
};

/**
 * Change the @handle.
 *
 * Goes through an RPC because none of the rules can be enforced here: the
 * handle has to be unique, it can only be changed every 30 days, and
 * `user_profiles` accepts direct PATCHes — so a check in this file would be
 * one HTTP call away from being skipped entirely. Migration 350 adds the
 * unique index, a trigger that refuses direct handle CHANGES, and this
 * function, which derives the user from `auth.uid()` rather than a parameter.
 *
 * Returns the server's verdict rather than throwing, because every outcome is
 * something the UI has to say out loud:
 *
 *   { ok: true,  reason: 'changed' | 'unchanged', username, next_change_at? }
 *   { ok: false, reason: 'taken' | 'cooldown' | 'invalid' | 'reserved'
 *                        | 'rejected' | 'not_signed_in', next_change_at? }
 *
 * The caller patches the profile cache with `username` FROM THIS RESULT, never
 * with what it sent: the server lowercases and strips a leading '@', so the
 * stored value and the submitted one differ on most successful calls.
 */
export const setUsername = async (username) => {
  const { data, error } = await supabase.rpc('set_username', { p_username: username });
  if (error) {
    // A missing function means the migration has not been run yet. Say that
    // rather than reporting the handle as taken, which is what a generic
    // failure branch would have implied.
    const missing = error.code === 'PGRST202' || /set_username/.test(error.message || '');
    return { ok: false, reason: missing ? 'unavailable' : 'rejected', error };
  }
  return data || { ok: false, reason: 'rejected' };
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
export const resetForDeletion = async () => {
  // Privileged columns (XP / coins / streaks / leaderboard totals /
  // league tier / grant markers) are rejected on direct client writes
  // by the mig 142/173 trigger (42501) — zero them via the SECURITY
  // DEFINER reset_my_profile_stats RPC. Pre-173 hosts don't have the
  // RPC (42883), but don't have the trigger either, so the legacy
  // payload fields below still work there.
  let privilegedStatsHandled = false;
  const { error: resetErr } = await supabase.rpc('reset_my_profile_stats');
  if (!resetErr) {
    privilegedStatsHandled = true;
  } else if (resetErr.code !== '42883' && resetErr.code !== '42P01') {
    // 173+ host but the reset genuinely failed — surface it rather than
    // silently leaving stats behind (the trigger would 42501 the
    // fallback fields anyway).
    throw resetErr;
  }

  return db.auth.updateMe({
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

    // Open cumulative counter (not in the 142/173 privileged blocklist)
    achievements_unlocked_count: 0,

    // Privileged stats — pre-173 hosts only; 173+ already zeroed via
    // reset_my_profile_stats above.
    ...(privilegedStatsHandled ? {} : {
      total_xp: 0,
      current_level: 1,
      total_volume_lbs: 0,
      total_distance_meters: 0,
      flex_coins: 0,
      workout_streak: 0,
      longest_workout_streak: 0,
      login_streak: 0,
      longest_login_streak: 0,
      league_tier: 'bronze',
      level_capsules_awarded_through: 0,   // mig 070
      milestone_capsules_awarded: 0,
      last_daily_chest_at: null,           // mig 068
      overthrow_count: 0,
    }),

    // One-time grant flags that remain client-writable — clearing these
    // means the user gets the corresponding reward again on their next
    // eligible event (mirrors "fresh start" UX).
    first_workout_capsule_granted: false,
    nemesis_opt_out: false,

    // Onboarding state — back to gate so the next sign-in shows
    // Onboarding rather than dropping them on a half-built Dashboard.
    onboarding_complete: false,
    onboarding_completed: false,
    onboarding_completed_at: null,

    account_reset_at: new Date().toISOString(),
  });
};