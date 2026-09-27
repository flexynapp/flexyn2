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
