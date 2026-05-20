// src/lib/data/prestige.js
// Prestige System — max-level reset with permanent status symbols.

import { supabase } from '@/api/supabaseClient';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_PRESTIGE = 10;
export const MAX_LEVEL    = 100; // adjust to match your XP system

/** Roman numeral labels for prestige tiers */
export const PRESTIGE_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Cosmetic title awarded per tier */
export const PRESTIGE_TITLE = [
  '',
  'The Initiated',
  'Iron Resolve',
  'Steel Will',
  'Bronze Legend',
  'Silver Titan',
  'Gold Elite',
  'Platinum Apex',
  'Diamond Sovereign',
  'Obsidian Myth',
  'The Eternal',
];

/** Flex Coins awarded per prestige (tier × 500) */
export const prestigeCoins = (tier) => tier * 500;

/** Border/badge color per tier */
export const PRESTIGE_COLOR = [
  '',
  'text-slate-400  border-slate-400',
  'text-orange-700 border-orange-700',
  'text-slate-500  border-slate-500',
  'text-amber-600  border-amber-600',
  'text-slate-300  border-slate-300',
  'text-yellow-400 border-yellow-400',
  'text-cyan-300   border-cyan-300',
  'text-blue-400   border-blue-400',
  'text-slate-900  border-slate-900 bg-slate-900',
  'text-violet-400 border-violet-400',
];

// ── Queries ───────────────────────────────────────────────────────────────────

/** Get prestige stats for a user (public-facing) */
export async function getPrestigeProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('prestige_level, lifetime_xp, prestiged_at, prestige_dismissed')
    .eq('id', userId)
    .single();
  return error ? null : data;
}

/** Dismiss the prestige prompt without prestiging */
export async function dismissPrestigePrompt() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('user_profiles')
    .update({ prestige_dismissed: true })
    .eq('id', user.id);
}

/** Restore prestige prompt (called from profile menu "Prestige" button) */
export async function restorePrestigePrompt() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('user_profiles')
    .update({ prestige_dismissed: false })
    .eq('id', user.id);
}

// ── Prestige Action ───────────────────────────────────────────────────────────

/**
 * Trigger a prestige reset for the current user.
 * Calls the DB function `perform_prestige` which atomically:
 *   - Increments prestige_level
 *   - Resets total_xp + current_level to 0 / 1
 *   - Awards Flex Coins
 *   - Appends timestamp to prestiged_at[]
 */
export async function performPrestige() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase.rpc('perform_prestige', { p_user_id: user.id });
  if (error) throw error;

  const result = data;
  if (!result?.ok) throw new Error(result?.error || 'Prestige failed');

  return result; // { ok, prestige_level, coins_awarded }
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

/** All-time prestige leaderboard: ranked by prestige_level desc, then lifetime_xp desc */
export async function getPrestigeLeaderboard(limit = 50) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, avatar_url, prestige_level, lifetime_xp, current_level')
    .gt('prestige_level', 0)
    .order('prestige_level', { ascending: false })
    .order('lifetime_xp',   { ascending: false })
    .limit(limit);
  return error ? [] : (data ?? []);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True if the user is at max level and eligible to prestige */
export function isPrestigeEligible(profile) {
  return (
    profile?.current_level >= MAX_LEVEL &&
    (profile?.prestige_level ?? 0) < MAX_PRESTIGE
  );
}

/** Format prestige badge label: e.g. "P·IV" */
export function prestigeLabel(level) {
  if (!level) return '';
  return `P·${PRESTIGE_ROMAN[level] ?? level}`;
}
