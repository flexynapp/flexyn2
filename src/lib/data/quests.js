// src/lib/data/quests.js
// Daily quest data layer — backed by Supabase user_daily_quests + user_profiles.
//
// Lifecycle:
//   1. ensureTodaysQuests(user) — idempotent; creates the day's 3 rows if absent
//   2. listTodaysQuests(user) — read for UI
//   3. recordAction(user, actionType, amount) — bumps progress on matching quests
//   4. claimQuest(user, questRowId) — credits coins, marks claimed_at
//
// Local-time policy: "today" is the user's local calendar date (YYYY-MM-DD).
// Otherwise users in different timezones would see resets at the wrong hour.

import { supabase } from '@/api/supabaseClient';
import { format } from 'date-fns';
import {
  QUEST_CATALOG,
  QUEST_DIFFICULTY,
  pickDailyQuests,
  getQuestDefinition,
} from '@/lib/questCatalog';

/** Today as a local YYYY-MM-DD string. */
export function todayDateString() {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Ensure today's three quests exist in the DB for this user. Idempotent —
 * subsequent calls in the same day are no-ops.
 *
 * Returns the day's quest rows (3 rows on success, [] if user not authed).
 */
export async function ensureTodaysQuests(user) {
  if (!user?.id || !user?.email) return [];
  const today = todayDateString();

  // Already populated?
  const { data: existing, error: readErr } = await supabase
    .from('user_daily_quests')
    .select('*')
    .eq('user_id', user.id)
    .eq('quest_date', today);
  if (readErr) {
    console.warn('[quests] read failed:', readErr);
    return [];
  }
  if (existing && existing.length > 0) return existing;

  // Pick + insert today's set
  const picked = pickDailyQuests(user.id, today);
  if (picked.length === 0) return [];

  const rows = picked.map(q => ({
    user_id:     user.id,
    user_email:  user.email,
    quest_date:  today,
    quest_id:    q.id,
    difficulty:  q.difficulty,
    coin_reward: QUEST_DIFFICULTY[q.difficulty].coinReward,
    progress:    0,
    target:      q.target,
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from('user_daily_quests')
    .insert(rows)
    .select();
  if (insertErr) {
    // Race condition: another tab created them concurrently. Re-read.
    if (insertErr.code === '23505') {
      const { data: refetched } = await supabase
        .from('user_daily_quests')
        .select('*')
        .eq('user_id', user.id)
        .eq('quest_date', today);
      return refetched ?? [];
    }
    console.warn('[quests] insert failed:', insertErr);
    return [];
  }
  return inserted ?? [];
}

/** Read today's quests for this user. Does NOT auto-create — call ensureTodaysQuests first. */
export async function listTodaysQuests(user) {
  if (!user?.id) return [];
  const { data, error } = await supabase
    .from('user_daily_quests')
    .select('*')
    .eq('user_id', user.id)
    .eq('quest_date', todayDateString())
    .order('difficulty', { ascending: true });
  if (error) {
    console.warn('[quests] list failed:', error);
    return [];
  }
  return data ?? [];
}

/**
 * Increment progress on every quest of the given action type that's still
 * incomplete. Safely no-ops when the user has no quests yet (e.g. brand-new
 * users whose Dashboard hasn't run ensureTodaysQuests yet).
 *
 * @param {Object} user — { id, email }
 * @param {string} actionType — one of ACTION_TYPES from questCatalog
 * @param {number} amount — increment delta (default 1)
 */
export async function recordAction(user, actionType, amount = 1) {
  if (!user?.id || !actionType || amount <= 0) return;

  // Read today's quests
  const today = todayDateString();
  const { data: rows, error: readErr } = await supabase
    .from('user_daily_quests')
    .select('*')
    .eq('user_id', user.id)
    .eq('quest_date', today);
  if (readErr || !rows) return;

  // Find quests subscribed to this action type that aren't complete yet
  const matching = rows.filter(row => {
    const def = QUEST_CATALOG[row.quest_id];
    if (!def) return false;
    if (def.actionType !== actionType) return false;
    return row.progress < row.target;
  });

  if (matching.length === 0) return;

  // Bump each matching quest. Use Promise.all — they're independent updates.
  await Promise.all(matching.map(async row => {
    const newProgress = Math.min(row.progress + amount, row.target);
    const updates = { progress: newProgress };
    if (newProgress >= row.target && !row.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from('user_daily_quests')
      .update(updates)
      .eq('id', row.id);
    if (error) console.warn('[quests] progress update failed:', error);
  }));
}

/**
 * Claim a completed quest's coin reward. Credits the user's flex_coins and
 * marks the quest row claimed_at. Idempotent — already-claimed quests no-op.
 *
 * Returns { success, newCoinBalance, coinsAwarded }.
 */
export async function claimQuest(user, questRowId) {
  if (!user?.id || !questRowId) {
    return { success: false, newCoinBalance: null, coinsAwarded: 0 };
  }

  // Read the quest row
  const { data: row, error: readErr } = await supabase
    .from('user_daily_quests')
    .select('*')
    .eq('id', questRowId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readErr || !row) return { success: false, newCoinBalance: null, coinsAwarded: 0 };

  if (row.claimed_at) return { success: false, newCoinBalance: null, coinsAwarded: 0 };
  if (!row.completed_at) return { success: false, newCoinBalance: null, coinsAwarded: 0 };

  // Credit coins + mark claimed in parallel — but read coins first to avoid race
  const { data: profile, error: pErr } = await supabase
    .from('user_profiles')
    .select('flex_coins')
    .eq('id', user.id)
    .maybeSingle();
  if (pErr) return { success: false, newCoinBalance: null, coinsAwarded: 0 };

  const newBalance = (profile?.flex_coins ?? 0) + row.coin_reward;
  const claimedAt = new Date().toISOString();

  const [coinsRes, claimRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .update({ flex_coins: newBalance })
      .eq('id', user.id),
    supabase
      .from('user_daily_quests')
      .update({ claimed_at: claimedAt })
      .eq('id', questRowId),
  ]);

  if (coinsRes.error || claimRes.error) {
    return { success: false, newCoinBalance: null, coinsAwarded: 0 };
  }
  return { success: true, newCoinBalance: newBalance, coinsAwarded: row.coin_reward };
}

/** Annotate a stored quest row with its full catalog definition for rendering. */
export function annotateQuest(row) {
  const def = getQuestDefinition(row.quest_id);
  return { ...row, definition: def };
}
