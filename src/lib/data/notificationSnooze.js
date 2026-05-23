// src/lib/data/notificationSnooze.js
//
// Per-category notification snooze. Wraps the
// `snooze_notification_category` RPC (migration 127). Categories
// follow the same names the on/off prefs use (singular form per the
// mig-083 unification: streak, quests, league, social, achievements,
// engagement, competitive).
//
// Snooze is temporary — the push trigger checks if `now() < expiry`
// and short-circuits delivery during that window. In-app rows still
// insert, so the user sees them next time they open the app.

import { supabase } from '@/api/supabaseClient';

/**
 * Set or clear the snooze for a category.
 * @param {string} category — e.g. 'streak', 'quests'
 * @param {number} minutes  — 0 / null clears; 1..1440 sets the window
 * @returns {Promise<string|null>} expiry ISO timestamp, or null on clear/error
 */
export async function snoozeCategory(category, minutes) {
  if (!category) return null;
  try {
    const { data, error } = await supabase.rpc('snooze_notification_category', {
      p_category: category,
      p_minutes:  Number.isFinite(minutes) ? Math.floor(minutes) : null,
    });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[notificationSnooze] RPC failed:', error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn('[notificationSnooze] threw:', err?.message || err);
    return null;
  }
}

/**
 * Pure helper — given the `notification_snoozes` JSONB blob from the
 * user_profiles row, return the active snooze expiry for a category
 * (or null when not snoozed / expired).
 */
export function getSnoozeExpiry(snoozes, category) {
  if (!snoozes || typeof snoozes !== 'object') return null;
  const raw = snoozes[category];
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t <= Date.now()) return null;
  return new Date(t);
}
