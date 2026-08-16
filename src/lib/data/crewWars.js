// src/lib/data/crewWars.js
// Crew Wars — weekly crew vs crew XP competitions.

import { supabase } from '@/api/supabaseClient';

// ── Queries ───────────────────────────────────────────────────────────────────

/** Get the active war for a specific crew (null if not in one) */
export async function getActiveWarForCrew(crewId) {
  if (!crewId) return null;
  const { data, error } = await supabase
    .from('crew_wars')
    .select('*')
    .eq('status', 'active')
    .or(`crew_a_id.eq.${crewId},crew_b_id.eq.${crewId}`)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? null : data;
}

/** Get a war's full contribution leaderboard */
export async function getWarContributions(warId) {
  if (!warId) return [];
  const { data, error } = await supabase
    .from('crew_war_contributions')
    .select('user_id, crew_id, xp_contributed, updated_at')
    .eq('war_id', warId)
    .order('xp_contributed', { ascending: false });
  return error ? [] : (data ?? []);
}

/** Get war history for a crew (completed wars, newest first) */
export async function getCrewWarHistory(crewId, limit = 10) {
  if (!crewId) return [];
  const { data, error } = await supabase
    .from('crew_wars')
    .select('*')
    .eq('status', 'completed')
    .or(`crew_a_id.eq.${crewId},crew_b_id.eq.${crewId}`)
    .order('ends_at', { ascending: false })
    .limit(limit);
  return error ? [] : (data ?? []);
}

/** Get all active wars (for hub feed / global view) */
export async function getActiveWars(limit = 20) {
  const { data, error } = await supabase
    .from('crew_wars')
    .select('*')
    .eq('status', 'active')
    .order('starts_at', { ascending: false })
    .limit(limit);
  return error ? [] : (data ?? []);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * How a war score is built, mirrored from _crew_war_score in migration 249.
 *
 * The server is the authority; this exists so the war screen can show a
 * breakdown that adds up to the score the server wrote. If the weights
 * change in 249 they must change here too.
 */
export const CREW_WAR_WEIGHTS = {
  volumePerPoint: 100,   // every 100 lb lifted is worth 1 point
  perSession:     50,
  perDayActive:   100,
  // volumeLbs is the ABSOLUTE ceiling, not the cap that usually binds.
  // Migration 359 caps each member at their OWN modelled weekly volume
  // (crew_member_volume_ceiling: bodyweight × age × sex × 7, clamped to
  // this number), so for anyone whose profile carries a weight the real
  // cap is lower — 107,100 for a 120 lb 55-year-old. The client cannot
  // compute it: user_daily_volume_ceiling is REVOKEd from authenticated.
  // Do not print this figure at a user as "your cap" — the AI Coach did
  // exactly that until 2026-08-16.
  caps: { volumeLbs: 200000, sessions: 28, daysActive: 7 },
};

/** Recompute a score from its parts, matching the server's blend exactly. */
export function crewWarScore({ volume_lbs = 0, sessions = 0, days_active = 0 } = {}) {
  const { volumePerPoint, perSession, perDayActive, caps } = CREW_WAR_WEIGHTS;
  const vol  = Math.min(caps.volumeLbs,  Math.max(0, Number(volume_lbs)  || 0));
  const sess = Math.min(caps.sessions,   Math.max(0, Number(sessions)    || 0));
  const days = Math.min(caps.daysActive, Math.max(0, Number(days_active) || 0));
  return Math.floor(vol / volumePerPoint) + sess * perSession + days * perDayActive;
}

/**
 * Recompute my crews' active war scores from my own training logs.
 *
 * Argument-free on purpose. Migration 249 derives everything — who I am,
 * which wars I'm in, and how much I've actually put in — from auth.uid()
 * and my own workout_logs inside a SECURITY DEFINER function. There is no
 * number for a client to forge because the client sends none.
 *
 * This replaced contributeWarXp, which passed the XP the browser had just
 * calculated. Migration 180 clamped that number and 247 removed the table
 * writes around it, so it was bounded rather than open — but it was still
 * the last place in the crew system where a client-chosen number reached a
 * score. It was also wrong on the merits: XP rewards whoever grinds most,
 * not the fittest crew, so scoring now blends volume, sessions and days
 * trained, weighted so consistency beats one heroic session.
 *
 * One call now covers every crew and every active war. The old path ran
 * getMyCrews, then getActiveWarForCrew per crew, then contributeWarXp —
 * three round trips deep inside the workout-save path.
 *
 * Fire-and-forget safe: returns a reason instead of throwing.
 */
export async function syncMyCrewWarProgress() {
  const { data, error } = await supabase.rpc('sync_my_crew_war_progress');
  if (error) {
    // 42883 / 42P01 = migration 249 not deployed on this host yet. The
    // hourly recompute cron still settles the score, so there is nothing
    // to fall back to and nothing lost by staying quiet.
    if (error.code !== '42883' && error.code !== '42P01') {
      console.warn('[crewWars] sync_my_crew_war_progress failed:', error);
    }
    return { ok: false, reason: error.code === '42501' ? 'unauthenticated' : 'db_error' };
  }
  return { ok: true, wars: data?.wars ?? 0 };
}

/**
 * Per-metric totals for both sides plus the ranked member list for BOTH
 * crews — the head-to-head board.
 *
 * Still server-gated on the caller belonging to one of the two crews:
 * showing both rosters to the people fighting is not showing them to
 * spectators. Within that, migration 360 draws the line at detail rather
 * than at identity — every member of both sides comes back with a name
 * and a score, and only your own crew's per-day figures come with them.
 * Returns null when there's nothing to show.
 */
export async function getWarBreakdown(warId) {
  if (!warId) return null;
  const { data, error } = await supabase.rpc('get_crew_war_breakdown', {
    p_war_id: warId,
  });
  if (error) {
    if (error.code !== '42883' && error.code !== '42P01') {
      console.warn('[crewWars] get_crew_war_breakdown failed:', error);
    }
    return null;
  }
  if (!data) return null;
  return {
    warId:    data.war_id ?? warId,
    myCrewId: data.my_crew_id ?? null,
    crewAId:  data.crew_a_id ?? null,
    crewBId:  data.crew_b_id ?? null,
    // Migration 360: BOTH crews' members, each with a name and a score.
    // Rival rows carry `volume_lbs` / `sessions` / `days_active` as null
    // on purpose — a rival's score is the contest, their training
    // calendar is not. Read `is_mine` before rendering any of those.
    totals:   Array.isArray(data.totals)  ? data.totals  : [],
    members:  Array.isArray(data.members) ? data.members : [],
  };
}

/**
 * Opt a crew into the war matchmaking queue (leader action).
 *
 * Pairs on arrival rather than waiting for a cron: if another crew is
 * already queued, migration 247's RPC matches you against the one that
 * has been waiting longest and flips the war straight to 'active'.
 * Otherwise you become the waiting entry. Leader-gating, the two-member
 * minimum, and the one-entry-per-crew rule are all enforced server-side
 * on auth.uid() — the crew id alone is not a capability.
 *
 * Returns { status: 'matched' | 'queued' | 'already_queued', warId }.
 */
export async function joinWarMatchmaking(crewId) {
  if (!crewId) throw new Error('No crew');

  const { data, error } = await supabase.rpc('join_crew_war_queue', {
    p_crew_id: crewId,
  });
  if (error) throw error;

  return { status: data?.status ?? 'queued', warId: data?.war_id ?? null };
}

/** Withdraw a crew from the queue (leader action, unpaired entries only). */
export async function leaveWarMatchmaking(crewId) {
  if (!crewId) return { ok: false, removed: 0 };

  const { data, error } = await supabase.rpc('leave_crew_war_queue', {
    p_crew_id: crewId,
  });
  if (error) {
    console.warn('[crewWars] leave_crew_war_queue failed:', error);
    return { ok: false, removed: 0 };
  }
  return { ok: true, removed: data?.removed ?? 0 };
}

/** The crew's pending (unpaired) queue entry, if it has one. */
export async function getQueuedWarForCrew(crewId) {
  if (!crewId) return null;
  const { data, error } = await supabase
    .from('crew_wars')
    .select('id, crew_a_id, status, created_at')
    .eq('crew_a_id', crewId)
    .eq('status', 'matchmaking')
    .is('crew_b_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? null : data;
}

/** Crew leader wants another go — re-enter the queue. */
export async function requestRematch(warId, crewId) {
  return joinWarMatchmaking(crewId);
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

export function getWarScore(war, crewId) {
  if (!war || !crewId) return 0;
  return war.crew_a_id === crewId ? (war.crew_a_score ?? 0) : (war.crew_b_score ?? 0);
}

export function getOpponentCrewId(war, myCrewId) {
  if (!war) return null;
  return war.crew_a_id === myCrewId ? war.crew_b_id : war.crew_a_id;
}

export function getOpponentScore(war, myCrewId) {
  if (!war || !myCrewId) return 0;
  return war.crew_a_id === myCrewId ? (war.crew_b_score ?? 0) : (war.crew_a_score ?? 0);
}

export function isWarWinner(war, crewId) {
  return war?.winner_crew_id === crewId;
}
