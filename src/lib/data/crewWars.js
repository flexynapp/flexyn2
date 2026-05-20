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
 * Upsert (add or update) XP contribution for the current user in an active war.
 * Called after every workout completion — pass the XP the user earned.
 */
export async function contributeWarXp(warId, crewId, xpToAdd) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !warId || !crewId || !xpToAdd) return;

  // Fetch existing contribution
  const { data: existing } = await supabase
    .from('crew_war_contributions')
    .select('id, xp_contributed')
    .eq('war_id', warId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('crew_war_contributions')
      .update({
        xp_contributed: existing.xp_contributed + xpToAdd,
        updated_at:     new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('crew_war_contributions')
      .insert({
        war_id:          warId,
        user_id:         user.id,
        crew_id:         crewId,
        xp_contributed:  xpToAdd,
      });
  }

  // Update the crew's aggregate score on the war row
  // (determine which side — crew_a or crew_b)
  const { data: war } = await supabase
    .from('crew_wars')
    .select('crew_a_id, crew_a_score, crew_b_score')
    .eq('id', warId)
    .single();

  if (war) {
    const isCrewA = war.crew_a_id === crewId;
    const scoreField = isCrewA ? 'crew_a_score' : 'crew_b_score';
    const currentScore = isCrewA ? war.crew_a_score : war.crew_b_score;
    await supabase
      .from('crew_wars')
      .update({ [scoreField]: currentScore + xpToAdd })
      .eq('id', warId);
  }
}

/** Opt a crew into the war matchmaking queue (leader action) */
export async function joinWarMatchmaking(crewId) {
  // Creates a 'matchmaking' war row as a queue entry (no opponent yet)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('crew_wars')
    .insert({
      crew_a_id: crewId,
      crew_b_id: crewId, // placeholder — matchmaking cron will pair it
      status:    'matchmaking',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Crew leader requests a rematch (sets a flag the cron will pick up) */
export async function requestRematch(warId, crewId) {
  // We use a simple convention: store rematch request in a dedicated column
  // For now, upsert a note via hub or re-enter matchmaking
  return joinWarMatchmaking(crewId);
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

export function getWarScore(war, crewId) {
  if (!war) return 0;
  return war.crew_a_id === crewId ? war.crew_a_score : war.crew_b_score;
}

export function getOpponentCrewId(war, myCrewId) {
  if (!war) return null;
  return war.crew_a_id === myCrewId ? war.crew_b_id : war.crew_a_id;
}

export function getOpponentScore(war, myCrewId) {
  if (!war) return 0;
  return war.crew_a_id === myCrewId ? war.crew_b_score : war.crew_a_score;
}

export function isWarWinner(war, crewId) {
  return war?.winner_crew_id === crewId;
}
