// src/lib/data/quests.js
// Daily quest data layer — backed by Supabase user_daily_quests + user_profiles.
//
// Lifecycle:
//   1. ensureTodaysQuests(user) — idempotent; creates the day's rows if absent
//   2. listTodaysQuests(user) — read for UI
//   3. recordAction(user, actionType, amount) — bumps progress on matching quests
//      recordActions(user, [{ type, amount }]) — same, one read for the batch
//   4. claimQuest(user, questRowId) — credits coins + XP + crew XP, marks claimed
//   5. claimPerfectDayBonus(user) — once all of the day's quests are claimed
//
// Local-time policy: "today" is the user's local calendar date (YYYY-MM-DD).
// Otherwise users in different timezones would see resets at the wrong hour.

import { supabase } from '@/api/supabaseClient';
import { format } from 'date-fns';
import { reportError } from '@/lib/reportError';
import { announceQuestCompleted } from '@/lib/questCompletion';
import {
  QUEST_CATALOG,
  QUEST_DIFFICULTY,
  pickDailyQuests,
  getQuestDefinition,
  difficultyRank,
} from '@/lib/questCatalog';

/** Today as a local YYYY-MM-DD string. */
export function todayDateString() {
  return format(new Date(), 'yyyy-MM-dd');
}

// ensureTodaysQuests runs inside the card's queryFn, which refetches every
// 90s and on every window focus. The crew lookup below only changes when
// somebody joins or leaves a crew, so answering it from the network on every
// one of those passes is pure waste — memoise it for five minutes.
//
// Consequence, and it is deliberate: a user who joins a crew sees their first
// crew quest up to five minutes later. The alternative was either a query per
// refetch forever, or wiring crew-join to reach into this module, which
// couples the two features to save one small indexed read.
const CREW_MEMO_MS = 5 * 60 * 1000;
const crewMemo = new Map(); // userId -> { value, at }

/**
 * Does this user belong to a crew? Decides whether the day gets a fourth,
 * crew-tier quest.
 *
 * Never throws and never blocks seeding: a failed read returns false, so the
 * user gets the ordinary three quests rather than none. A crew member who
 * hits a blip at seeding time loses one quest for one day; an exception here
 * would have cost them the whole set. A failure is NOT memoised, so the next
 * pass retries rather than locking the answer to false for five minutes.
 */
async function hasCrew(user) {
  if (!user?.id) return false;
  const memo = crewMemo.get(user.id);
  if (memo && Date.now() - memo.at < CREW_MEMO_MS) return memo.value;
  try {
    const { data, error } = await supabase
      .from('crew_members')
      .select('crew_id')
      .eq('user_id', user.id)
      .limit(1);
    if (error) return false;
    const value = (data?.length ?? 0) > 0;
    crewMemo.set(user.id, { value, at: Date.now() });
    return value;
  } catch {
    return false;
  }
}

/**
 * Does this user have an active goal? Decides whether "Complete a goal" can
 * be one of today's quests. Only read when a day is being seeded, so once a
 * day at most. A failed read answers true: the quest stays eligible, which is
 * how every day was picked before this check existed.
 */
async function hasActiveGoal(user) {
  if (!user?.id) return true;
  try {
    const { data, error } = await supabase
      .from('goals')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1);
    if (error) return true;
    return (data?.length ?? 0) > 0;
  } catch {
    return true;
  }
}

/**
 * Ensure today's quests exist in the DB for this user. Idempotent —
 * subsequent calls in the same day are no-ops.
 *
 * Returns the day's quest rows (3, or 4 with a crew; [] if user not authed).
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

  // A user who joined a crew after today's set was seeded is missing only
  // their crew quest — seed that one rather than doing nothing. The
  // one-per-difficulty unique index (mig 199) is what makes this safe to
  // retry: a second tab racing us loses on 23505 and we re-read.
  const inCrew = await hasCrew(user);
  const haveDifficulties = new Set((existing || []).map(r => r.difficulty));
  if (existing && existing.length > 0) {
    if (!inCrew || haveDifficulties.has('crew')) return existing;
  }

  const skipFamilies = (await hasActiveGoal(user)) ? [] : ['goals'];
  const picked = pickDailyQuests(user.id, today, inCrew, { skipFamilies })
    .filter(q => !haveDifficulties.has(q.difficulty));
  if (picked.length === 0) return existing ?? [];

  const rows = picked.map(q => ({
    user_id:     user.id,
    user_email:  user.email,
    quest_date:  today,
    quest_id:    q.id,
    difficulty:  q.difficulty,
    // Both reward columns are overwritten server-side by the guard trigger
    // (migration 316). They're sent anyway so the insert is a complete row
    // and so a reader of this file can see what the client BELIEVES the
    // reward is — if the two ever disagree, the server wins and the UI is
    // the thing that's lying.
    coin_reward: QUEST_DIFFICULTY[q.difficulty]?.coinReward ?? 0,
    xp_reward:   QUEST_DIFFICULTY[q.difficulty]?.xpReward ?? 0,
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
    return existing ?? [];
  }
  return [...(existing ?? []), ...(inserted ?? [])];
}

/** Read today's quests for this user. Does NOT auto-create — call ensureTodaysQuests first. */
export async function listTodaysQuests(user) {
  if (!user?.id) return [];
  const { data, error } = await supabase
    .from('user_daily_quests')
    .select('*')
    .eq('user_id', user.id)
    .eq('quest_date', todayDateString());
  if (error) {
    console.warn('[quests] list failed:', error);
    return [];
  }
  return sortQuestRows(data);
}

/**
 * Today's rows in display order. Ordering is done here, not in the query:
 * `order('difficulty')` sorted lexically, which put 'crew' between 'cardio'
 * and 'easy', i.e. FIRST, ahead of the easy quest. difficultyRank is the
 * display ladder.
 */
export function sortQuestRows(rows) {
  return (rows ?? []).slice().sort(
    (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty),
  );
}

/**
 * Increment progress on every quest matching the given actions that's still
 * incomplete. Safely no-ops when the user has no quests yet (e.g. brand-new
 * users whose Dashboard hasn't run ensureTodaysQuests yet).
 *
 * Takes a LIST because a single save now emits several actions — a workout
 * save is completed + minutes + sets + volume, a cardio save is completed +
 * seconds + PRs. Each recordAction call was a full read of the day's quests,
 * so the old one-call-per-action shape meant four reads and four round-trips
 * for one button press. This reads once.
 *
 * @param {Object} user — { id, email }
 * @param {Array<{type: string, amount?: number}>} actions
 */
export async function recordActions(user, actions) {
  if (!user?.id || !Array.isArray(actions)) return;

  // Collapse duplicates and drop the empties before touching the network.
  // Callers pass `durationMin > 0 ? {...} : null`-shaped lists and it is
  // cheaper to filter here than at every call site.
  const deltas = new Map();
  for (const a of actions) {
    if (!a || !a.type) continue;
    const amount = Number(a.amount ?? 1);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    deltas.set(a.type, (deltas.get(a.type) ?? 0) + amount);
  }
  if (deltas.size === 0) return;

  const today = todayDateString();
  const { data: rows, error: readErr } = await supabase
    .from('user_daily_quests')
    .select('*')
    .eq('user_id', user.id)
    .eq('quest_date', today);
  if (readErr || !rows) return;

  // Find quests subscribed to any of these action types that aren't complete.
  const matching = rows
    .map(row => {
      const def = QUEST_CATALOG[row.quest_id];
      if (!def) return null;
      const amount = deltas.get(def.actionType);
      if (!amount) return null;
      if (row.progress >= row.target) return null;
      return { row, amount };
    })
    .filter(Boolean);

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
  await Promise.all(matching.map(async ({ row, amount }) => {
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
      return;
    }
    // This write is what completed the quest, so say so now, wherever the
    // user is. Only after the update landed: announcing a completion the
    // database refused would offer a Claim the server then rejects.
    if (updates.completed_at) {
      announceQuestCompleted({ ...row, ...updates });
    }
  }));
  if (failures.length) {
    reportError(new Error(`[quests] ${failures.length} quest progress update(s) failed`), {
      feature: 'quests.recordAction',
      level: 'warning',
      userEmail: user.email,
      actionTypes: [...deltas.keys()],
      failures: failures.map(f => ({ questRowId: f.questRowId, questId: f.questId, code: f.error?.code })),
    });
  }
}

/**
 * Single-action convenience wrapper. Kept because most call sites emit one
 * action and `recordAction(user, TYPE)` reads better there than a one-element
 * array. Multi-action savers should call recordActions directly.
 */
export async function recordAction(user, actionType, amount = 1) {
  if (!actionType) return;
  return recordActions(user, [{ type: actionType, amount }]);
}

/**
 * Claim a completed quest's reward. Atomically marks the quest claimed AND
 * credits flex_coins, personal XP and the crew's XP via claim_quest_atomic
 * (migrations 068 / 316). Idempotent — already-claimed quests return
 * { success: false }.
 *
 * Previously this was a read-then-write-coins-then-mark-claimed dance
 * that lost coin grants when a concurrent flex_coins update landed
 * between the read and the write (rapid double-tap, two tabs, network
 * retry). The RPC does the whole flip in one transaction with
 * delta-arithmetic on flex_coins, so concurrent grants from other
 * paths (marketplace credit, streak milestone, etc.) compose
 * correctly.
 *
 * `xpAwarded` is what the server ACTUALLY credited after the daily quest cap,
 * not the quest's nominal xp_reward — render that number, never the catalog's.
 *
 * Returns { success, newCoinBalance, coinsAwarded, xpAwarded, crewXpAwarded }.
 */
export async function claimQuest(user, questRowId) {
  const empty = {
    success: false, newCoinBalance: null,
    coinsAwarded: 0, xpAwarded: 0, crewXpAwarded: 0,
  };
  if (!user?.id || !questRowId) return empty;

  const { data, error } = await supabase.rpc('claim_quest_atomic', {
    p_quest_row_id: questRowId,
  });
  if (error) {
    console.warn('[quests] claim_quest_atomic failed:', error);
    return empty;
  }

  // RPC shape: { success, already_claimed, coins_awarded, xp_awarded,
  //              crew_xp_awarded, new_balance }
  return {
    success:        !!data?.success,
    newCoinBalance: data?.new_balance ?? null,
    coinsAwarded:   data?.coins_awarded ?? 0,
    xpAwarded:      data?.xp_awarded ?? 0,
    crewXpAwarded:  data?.crew_xp_awarded ?? 0,
  };
}

/**
 * Claim the perfect-day bonus — pays once per local day, only when every
 * quest the day handed you is claimed, and advances the quest streak.
 *
 * Safe to call speculatively: the server answers `{ success: false, reason:
 * 'not_complete' | 'already_claimed' }` rather than raising, so the card can
 * fire it whenever the last claim lands without first proving the day is done.
 *
 * Returns { success, reason, coinsAwarded, xpAwarded, crewXpAwarded, streak }.
 */
export async function claimPerfectDayBonus(user) {
  const empty = {
    success: false, reason: 'unavailable',
    coinsAwarded: 0, xpAwarded: 0, crewXpAwarded: 0, streak: 0,
  };
  if (!user?.id) return empty;

  const { data, error } = await supabase.rpc('claim_perfect_day_bonus');
  if (error) {
    // A host that predates migration 316 has no such function (PGRST202 /
    // 42883). That is not an error worth a Sentry event or a toast — the
    // bonus simply doesn't exist yet on that deployment.
    if (error.code !== 'PGRST202' && error.code !== '42883') {
      console.warn('[quests] claim_perfect_day_bonus failed:', error);
    }
    return empty;
  }

  return {
    success:       !!data?.success,
    reason:        data?.reason ?? null,
    coinsAwarded:  data?.coins_awarded ?? 0,
    xpAwarded:     data?.xp_awarded ?? 0,
    crewXpAwarded: data?.crew_xp_awarded ?? 0,
    streak:        data?.streak ?? 0,
  };
}

/**
 * The caller's quest streak and lifetime counters. Returns zeroes rather than
 * null on any failure so the sheet can render without a loading branch for
 * every number.
 *
 * `isCurrent` is the field that matters for display: current_streak keeps its
 * value after a break until the next perfect day overwrites it, so rendering
 * it raw tells someone they're on a 12-day run four days after they lost it.
 */
export async function getQuestStats(user) {
  const empty = {
    currentStreak: 0, longestStreak: 0, perfectDays: 0, questsClaimed: 0,
    coinsEarned: 0, xpEarned: 0, crewXpEarned: 0,
    bonusClaimedToday: false, isCurrent: false,
  };
  if (!user?.id) return empty;

  const { data, error } = await supabase.rpc('get_my_quest_stats');
  if (error || !data) return empty;

  return {
    currentStreak:     data.current_streak ?? 0,
    longestStreak:     data.longest_streak ?? 0,
    perfectDays:       data.perfect_days ?? 0,
    questsClaimed:     data.quests_claimed ?? 0,
    coinsEarned:       data.coins_earned ?? 0,
    xpEarned:          data.xp_earned ?? 0,
    crewXpEarned:      data.crew_xp_earned ?? 0,
    bonusClaimedToday: !!data.bonus_claimed_today,
    isCurrent:         !!data.is_current,
  };
}

/** Annotate a stored quest row with its full catalog definition for rendering. */
export function annotateQuest(row) {
  const def = getQuestDefinition(row.quest_id);
  return { ...row, definition: def };
}
