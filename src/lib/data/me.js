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
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return db.auth.updateMe(data);
};
export const logout = () => db.auth.logout();

/**
 * Reset every cumulative counter and clear profile fields on the
 * current user's record. Used as part of account deletion. This makes
 * the row "ghost-like" so the existing filterAfterReset and ghost-user
 * filters in the leaderboards hide the account.
 */
export const resetForDeletion = () => db.auth.updateMe({
  total_xp: 0,
  achievements_unlocked_count: 0,
  total_volume_lbs: 0,
  total_distance_meters: 0,
  username: '',
  gender: null,
  birthday: null,
  height_inches: null,
  weight_lbs: null,
  country_code: null,
  state_code: null,
  avatar_url: null,
  onboarding_complete: false,
  onboarding_completed_at: null,
  account_reset_at: new Date().toISOString(),
});