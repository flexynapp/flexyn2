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

// Returned to distinguish the three outcome shapes:
//   • `{ ok: true, expiry }`   — server stored the snooze (expiry is a non-null ISO when minutes > 0)
//   • `{ ok: true, expiry: null }` — server cleared the snooze (minutes was 0/null and RPC succeeded)
//   • `{ ok: false, reason }`  — RPC failed (missing function / permission / other)
//
// The previous return shape was `string|null` — which collapsed
// "cleared successfully" and "RPC threw / function missing" into the
// same `null`. SettingsPanel's clear path then optimistically removed
// the snooze chip from state while the server still had the row,
// silently misleading the user. Wave 54 (Notifications + Settings
// audits) both flagged this. Callers that don't care about the
// distinction can read `.expiry` directly; the destructure is
// backwards-compatible at the API surface even though the shape is
// new.

/**
 * Set or clear the snooze for a category.
 * @param {string} category — e.g. 'streak', 'quests'
 * @param {number} minutes  — 0 / null clears; 1..1440 sets the window
 * @returns {Promise<{ok:boolean, expiry:string|null, reason?:string}>}
 */
export async function snoozeCategory(category, minutes) {
  if (!category) return { ok: false, expiry: null, reason: 'no_category' };
  try {
    const { data, error } = await supabase.rpc('snooze_notification_category', {
      p_category: category,
      p_minutes:  Number.isFinite(minutes) ? Math.floor(minutes) : null,
    });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') {
        return { ok: false, expiry: null, reason: 'pipeline_missing' };
      }
      console.warn('[notificationSnooze] RPC failed:', error);
      return { ok: false, expiry: null, reason: error.code || 'rpc_error' };
    }
    return { ok: true, expiry: data || null };
  } catch (err) {
    console.warn('[notificationSnooze] threw:', err?.message || err);
    return { ok: false, expiry: null, reason: 'threw' };
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
