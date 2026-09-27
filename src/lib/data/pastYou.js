// src/lib/data/pastYou.js
//
// Past You: the ghost rival built from the lifter's own history
// (migration 20260927130000). Every number here is computed server-side from
// the same scorer the human match uses; the client only reads it.

import { supabase } from '@/api/supabaseClient';

const one = (data) => (Array.isArray(data) ? (data[0] ?? null) : (data ?? null));

/**
 * The live Past You race, or the one that settled in the last two days (so
 * the card can show the result). Null when there is neither.
 *
 * Reads the NEWEST race whatever its status: filtering abandoned rows out
 * made quitting a rematch resurface the race before it as "last week's
 * result". An abandoned newest race means there is nothing to show.
 */
export async function getMyPastYou() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('past_you_matches')
    .select('*')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || data.status === 'abandoned') return null;
  if (data.status === 'completed') {
    const settled = data.settled_at ? new Date(data.settled_at).getTime() : 0;
    if (Date.now() - settled > 2 * 86400_000) return null;
  }
  return data;
}

/**
 * Start racing Past You. Returns the match (the live one if already racing).
 * Throws with `code` 'guest_account' for a guest and 'rival_in_progress' when
 * a human match is live, so the caller can say which.
 */
export async function startPastYou(type = 'gym') {
  const { data, error } = await supabase.rpc('past_you_start', { p_type: type === 'cardio' ? 'cardio' : 'gym' });
  if (error) throw withReason(error);
  return one(data);
}

/** The race as the server sees it right now. Null when unavailable. */
export async function getPastYouState(id) {
  if (!id) return null;
  const { data, error } = await supabase.rpc('past_you_state', { p_id: id });
  if (error) return null;
  const row = one(data);
  if (!row) return null;
  return {
    you:           Number(row.you_score) || 0,
    ghostPace:     Number(row.ghost_pace) || 0,
    target:        Number(row.target) || 0,
    level:         Number(row.level) || 1,
    baseline:      Number(row.baseline) || 0,
    baselineWeeks: Number(row.baseline_weeks) || 0,
    prs:           Number(row.prs) || 0,
    startedAt:     row.started_at ? new Date(row.started_at) : null,
    endsAt:        row.ends_at ? new Date(row.ends_at) : null,
  };
}

/** Walk away. Pays nothing and leaves the ghost's level as it was. */
export async function abandonPastYou(id) {
  const { error } = await supabase.rpc('past_you_abandon', { p_id: id });
  if (error) throw error;
}

/**
 * Guest refusal and the other expected refusals come back as a plain error
 * message from the RPC. Tag them so callers branch on a stable reason.
 */
export function withReason(error) {
  const msg = String(error?.message || '');
  if (msg.includes('guest_account')) error.reason = 'guest_account';
  else if (msg.includes('rival_in_progress')) error.reason = 'rival_in_progress';
  else if (msg.includes('past_you_in_progress')) error.reason = 'past_you_in_progress';
  return error;
}

/** Percent above the lifter's own baseline the ghost is set at. */
export function ghostBoostPct(level) {
  return Math.max(0, (Number(level) || 1) - 1) * 4;
}

/**
 * The lowest baseline the server will set (half the starter target): roughly
 * one light real session. Mirrors past_you_plan in migration 20260927160000,
 * which floors a sandbagged average here so a tiny week cannot farm a win.
 */
export const PAST_YOU_BASELINE_FLOOR = { gym: 5000, cardio: 2500 };

/** Which sentence explains where the target came from. */
export function pastYouBasis(rivalType, baseline, weeks) {
  if (!(weeks > 0)) return 'starter';
  const floor = PAST_YOU_BASELINE_FLOOR[rivalType === 'cardio' ? 'cardio' : 'gym'];
  return Number(baseline) <= floor ? 'floor' : 'weeks';
}

/** What each weekly goal pays at settlement, win or lose (migration 20260927173000). */
export const PAST_YOU_GOAL_REWARD = { xp: 150, coins: 15 };

/** The goals in the order the server returns them. */
export const PAST_YOU_GOAL_KEYS = ['days', 'pr', 'cross'];

/**
 * The race's three weekly goals, as the server counts them right now (or as
 * they were written at settlement). Null when unavailable, so the sheet can
 * leave the section out rather than show three empty goals.
 */
export async function getPastYouGoals(id) {
  if (!id) return null;
  const { data, error } = await supabase.rpc('past_you_goals', { p_id: id });
  if (error || !Array.isArray(data)) return null;
  const byKey = new Map(data.map((g) => [g?.key, g]));
  return PAST_YOU_GOAL_KEYS.map((key) => {
    const g = byKey.get(key) || {};
    const goal = Number(g.goal) || 1;
    const progress = Math.min(goal, Math.max(0, Number(g.progress) || 0));
    return { key, goal, progress, done: g.done === true };
  });
}

// Mid-week checkpoints (migration 20260927183000). On day 3 and day 5 the
// cron checks whether the lifter is on Past You's pace, target x day / 7,
// and pays PAST_YOU_CHECKPOINT_REWARD if so. The server appends one entry per
// checkpoint to `checkpoints`; anything not there yet is upcoming.
export const PAST_YOU_CHECKPOINT_DAYS = [3, 5];
export const PAST_YOU_CHECKPOINT_REWARD = { xp: 100, coins: 10 };

/**
 * @returns {{ day: number, at: Date, pace: number, status: 'hit'|'missed'|'upcoming'|'skipped' }[]}
 */
export function pastYouCheckpoints(match) {
  if (!match?.started_at) return [];
  const start = new Date(match.started_at).getTime();
  const done = Array.isArray(match.checkpoints) ? match.checkpoints : [];
  const target = Number(match.target) || 0;
  return PAST_YOU_CHECKPOINT_DAYS.map((day) => {
    const row = done.find((c) => Number(c?.day) === day);
    return {
      day,
      at: new Date(start + day * 86400_000),
      pace: row ? Number(row.pace) || 0 : Math.round((target * day) / 7),
      // A race that ended without this checkpoint (it started before
      // checkpoints existed, or was ended early) never had it checked.
      status: row ? (row.hit ? 'hit' : 'missed') : (match.status === 'active' ? 'upcoming' : 'skipped'),
    };
  });
}
