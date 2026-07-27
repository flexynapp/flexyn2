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
 * Add XP contribution for the current user in an active war.
 *
 * Atomic via contribute_crew_war_xp RPC (migration 076). The previous
 * client-side implementation was a four-step read-modify-write dance:
 * read existing contribution → add delta → write back, then read war
 * row → add delta to crew_*_score → write back. Two simultaneous
 * crew members finishing workouts both read the same aggregate score
 * and the last writer's delta overwrote the first's. Now the RPC
 * does both writes via server-side delta arithmetic under a
 * FOR UPDATE lock on the war row.
 *
 * The legacy read-modify-write fallback that used to sit under this call
 * is gone. Migration 247 revokes INSERT/UPDATE/DELETE on crew_wars and
 * crew_war_contributions from `authenticated`, because the old
 * "crew_wars_update" policy let any member of either crew write
 * crew_a_score directly and skip migration 180's clamp entirely. The RPC
 * is now the only write path, so a fallback could only ever fail loudly —
 * better to surface that than to pretend it worked.
 */
export async function contributeWarXp(warId, crewId, xpToAdd) {
  if (!warId || !crewId || !xpToAdd || xpToAdd <= 0) return;

  const { error } = await supabase.rpc('contribute_crew_war_xp', {
    p_war_id:  warId,
    p_crew_id: crewId,
    p_xp:      Math.floor(xpToAdd),
  });
  if (error) console.warn('[crewWars] contribute_crew_war_xp failed:', error);
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
