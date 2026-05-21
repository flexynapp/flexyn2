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
import { reportError } from '@/lib/reportError';
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
  // Per-update errors are caught + reported so a single failing update
  // doesn't abort the others, but they're NOT silently swallowed:
  // previously each failure just console.warn'd and the function returned
  // success regardless. If a quest update failed (RLS, network, schema
  // drift), the user's progress silently stalled and they'd never see a
  // "claim reward" button — the quest's progress < target so it never
  // showed as complete. Now each failure ships to Sentry with feature
  // context so we can see the pattern.
  const failures = [];
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
    if (error) {
      failures.push({ questRowId: row.id, questId: row.quest_id, error });
    }
  }));
  if (failures.length) {
    reportError(new Error(`[quests] ${failures.length} quest progress update(s) failed`), {
      feature: 'quests.recordAction',
      level: 'warning',
      userEmail: user.email,
      actionType,
      failures: failures.map(f => ({ questRowId: f.questRowId, questId: f.questId, code: f.error?.code })),
    });
  }
}

/**
 * Claim a completed quest's coin reward. Atomically marks the quest
 * claimed AND credits flex_coins via the claim_quest_atomic RPC
 * (migration 068). Idempotent — already-claimed quests return
 * { success: false, newCoinBalance: <current> }.
 *
 * Previously this was a read-then-write-coins-then-mark-claimed dance
 * that lost coin grants when a concurrent flex_coins update landed
 * between the read and the write (rapid double-tap, two tabs, network
 * retry). The RPC does the whole flip in one transaction with
 * delta-arithmetic on flex_coins, so concurrent grants from other
 * paths (marketplace credit, streak milestone, etc.) compose
 * correctly.
 *
 * Returns { success, newCoinBalance, coinsAwarded }.
 */
export async function claimQuest(user, questRowId) {
  if (!user?.id || !questRowId) {
    return { success: false, newCoinBalance: null, coinsAwarded: 0 };
  }

  const { data, error } = await supabase.rpc('claim_quest_atomic', {
    p_quest_row_id: questRowId,
  });
  if (error) {
    console.warn('[quests] claim_quest_atomic failed:', error);
    return { success: false, newCoinBalance: null, coinsAwarded: 0 };
  }

  // RPC shape: { success, already_claimed, coins_awarded, new_balance }
  return {
    success:        !!data?.success,
    newCoinBalance: data?.new_balance ?? null,
    coinsAwarded:   data?.coins_awarded ?? 0,
  };
}

/** Annotate a stored quest row with its full catalog definition for rendering. */
export function annotateQuest(row) {
  const def = getQuestDefinition(row.quest_id);
  return { ...row, definition: def };
}
