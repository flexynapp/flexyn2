// src/lib/data/crewSeasons.js
//
// Crew seasons, divisions and standings — the read side of migration 248.
//
// A crew is now a ranked object, not just a name with a member list. Its
// standing lives in crew_season_stats, keyed by (season, crew), and the
// whole table is server-written: every points, division and trophy write
// goes through award_crew_progress or roll_crew_seasons, both SECURITY
// DEFINER. There is deliberately no write function in this module, because
// there is no client write path to wrap.

import { supabase } from '@/api/supabaseClient';

/**
 * Promotion and relegation slots per division, and the minimum division
 * size before either applies.
 *
 * These MUST match migration 248's roll_crew_seasons. They're duplicated
 * here so the standings screen can draw the promotion and relegation zones
 * without a second round trip — but the server is the authority, and the
 * client never decides who actually moves.
 */
export const PROMOTION_SLOTS   = 3;
export const RELEGATION_SLOTS  = 3;
export const MIN_DIVISION_SIZE = 8;

/**
 * Which zone a row sits in, given its index and the division size.
 *
 * Returns 'promotion', 'relegation', or null. Mirrors the server rule that
 * a division smaller than MIN_DIVISION_SIZE doesn't promote or relegate at
 * all — with three crews in the league, shuffling tiers every four weeks
 * reads as noise rather than progress, so the UI shows no zones either.
 *
 * Division 1 is the top tier, so nothing promotes out of it.
 */
export function zoneForRow(index, total, division) {
  if (!Number.isFinite(index) || !Number.isFinite(total)) return null;
  if (total < MIN_DIVISION_SIZE) return null;
  if (index < PROMOTION_SLOTS && division !== 1) return 'promotion';
  if (index >= total - RELEGATION_SLOTS) return 'relegation';
  return null;
}

/**
 * The caller's crew's division table for the active season.
 *
 * Returns null — not a throw and not an empty shell — when there's nothing
 * to show, so the League panel can hide itself rather than render an empty
 * table. That covers three distinct cases deliberately collapsed into one:
 * migration 248 not applied yet (42883), no season open, and a crew that
 * has never been seated in one.
 *
 * Shape: { seasonNumber, endsAt, division, rows: [...] }, rows already
 * ordered by points DESC then trophies DESC, server-side.
 */
export async function getDivisionStandings(crewId) {
  if (!crewId) return null;

  const { data, error } = await supabase.rpc('get_crew_division_standings', {
    p_crew_id: crewId,
  });

  if (error) {
    // 42883 / 42P01 = the RPC isn't deployed on this host yet. There's no
    // client-side fallback worth writing: standings are a server-derived
    // ranking, and a client-computed one would be both wrong and forgeable.
    if (error.code !== '42883' && error.code !== '42P01') {
      console.warn('[crewSeasons] standings failed:', error);
    }
    return null;
  }

  if (!data || data.division == null) return null;

  return {
    seasonNumber: data.season_number ?? null,
    endsAt:       data.ends_at ?? null,
    division:     data.division,
    rows:         Array.isArray(data.rows) ? data.rows : [],
  };
}

/**
 * Where a crew sits in its own division, 1-indexed, or null if absent.
 * Convenience for the crew header, which shows the placing without
 * rendering the whole table.
 */
export function placingFor(standings, crewId) {
  if (!standings || !Array.isArray(standings.rows) || !crewId) return null;
  const i = standings.rows.findIndex(r => r.crew_id === crewId);
  return i === -1 ? null : i + 1;
}

/**
 * XP required to REACH a given crew level. Mirrors crew_level_for_xp in
 * migration 248 (100 * L * (L - 1)) so the header can draw a progress bar
 * without asking the server for the curve.
 */
export function xpForCrewLevel(level) {
  const l = Math.max(1, Math.floor(level || 1));
  return 100 * l * (l - 1);
}

/**
 * Progress through the current crew level, as { into, span, pct }.
 * Returns nulls for a crew with no progression data (pre-248 host), so
 * callers can skip the bar entirely rather than draw a zeroed one.
 */
export function crewLevelProgress(crew) {
  const xp    = Number(crew?.crew_xp);
  const level = Number(crew?.crew_level);
  if (!Number.isFinite(xp) || !Number.isFinite(level)) {
    return { into: null, span: null, pct: null };
  }
  const floorXp = xpForCrewLevel(level);
  const nextXp  = xpForCrewLevel(level + 1);
  const span    = Math.max(1, nextXp - floorXp);
  const into    = Math.max(0, xp - floorXp);
  return { into, span, pct: Math.max(0, Math.min(1, into / span)) };
}
