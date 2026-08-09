// src/lib/data/leagueSeasons.js
//
// League season data layer (migration 312).
//
// A season is 28 days — four weekly brackets — and matches `crew_seasons`
// deliberately, so "Season 7" means one thing in both surfaces.
//
// The week does all the moving; the season does all the remembering. Weekly
// resolution pays coins and capsules, which are consumable. The season pays a
// title, a trophy and a capsule, which persist and which other people can see.
//
// Everything here is READ-ONLY. Seasons are opened, recorded and rolled
// entirely server-side:
//   • current_league_season()          — get-or-open, called by the recorder
//   • league_season_record_internal()  — hooked into the weekly resolver
//   • roll_league_seasons()            — cron, daily 03:40 UTC
// The last two are revoked from every client role. There is no client path
// that can award a title or mint a trophy, which is the point: a season mark
// is the most forgeable thing in the product if you let a browser near it.

import { supabase } from '@/api/supabaseClient';
import { reportError } from '@/lib/reportError';

/**
 * The signed-in user's standing in the open season.
 *
 * Returns null on a host that predates 312, so every caller must treat a null
 * season as "this feature isn't here yet" rather than "you have no season".
 *
 * Shape:
 *   { season_number, name, ends_at, best_tier, weeks_qualified,
 *     weeks_needed, season_xp, season_rank, field_size }
 */
export async function getMySeason(user) {
  if (!user?.id) return null;
  try {
    const { data, error } = await supabase.rpc('my_league_season');
    if (error) {
      // 42883 / 42P01 — migration 312 not applied on this host.
      if (error.code !== '42883' && error.code !== '42P01') {
        reportError(error, {
          feature: 'leagueSeasons.getMySeason',
          level: 'warning',
          userEmail: user.email,
        });
      }
      return null;
    }
    return data ?? null;
  } catch (err) {
    if (err?.code !== '42883' && err?.code !== '42P01') {
      reportError(err, {
        feature: 'leagueSeasons.getMySeason.throw',
        level: 'warning',
        userEmail: user.email,
      });
    }
    return null;
  }
}

/**
 * The Legend season board — cumulative season XP among everyone who has
 * reached Legend, top of the list taking the champion trophy at roll.
 *
 * This is what stops Legend being a dead end. Before seasons it was
 * `promote: 0` with nothing above it, so arriving there ended the game.
 * Open to every signed-in user on purpose: chasing it is the mechanic.
 */
export async function getLegendBoard(limit = 20) {
  try {
    const { data, error } = await supabase.rpc('legend_season_board', { p_limit: limit });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Whole days left in the season, or null when unknown.
 *
 * Counted in whole days rather than rounded: "1 day left" must not appear
 * while there are 30 hours to go, because the season roll is the moment the
 * rewards land and people plan their last session around it.
 */
export function daysLeftInSeason(season) {
  if (!season?.ends_at) return null;
  const end = new Date(season.ends_at);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * Will this user collect anything when the season rolls?
 *
 * Mirrors `c_min_weeks` in roll_league_seasons: two qualifying weeks of four.
 * Reaching a tier is not enough — you have to have played, which is the
 * Rocket League reward-level rule and the reason a single lucky week doesn't
 * buy a permanent mark.
 */
export function isSeasonEligible(season) {
  if (!season) return false;
  const need = Number(season.weeks_needed) || 2;
  return (Number(season.weeks_qualified) || 0) >= need;
}
