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
 * The user's most recent COLLECTED season result, for the ceremony.
 *
 * Returns null when there is nothing to show — no completed season, or the
 * user was below the two-week bar and collected nothing. A season they sat
 * out must not produce a ceremony.
 *
 * Deliberately two queries rather than one PostgREST embed. The FK
 * (`league_season_stats.season_id` -> `league_seasons.id`) does point at an
 * exposed table so an embed *should* resolve — but this codebase has been
 * bitten twice by embeds that 400'd with PGRST200 for months without anyone
 * noticing (see the note on `listLeagueMembers`). This path runs once per
 * season per user; the extra round trip costs nothing and cannot fail that
 * way.
 *
 * Shape:
 *   { seasonNumber, seasonName, tier, weeksQualified, seasonXp,
 *     finalRank, isChampion, trophyId, titleId, capsule, awardedAt }
 */
export async function getLastSeasonResult(user) {
  if (!user?.id) return null;
  try {
    const { data: seasons, error: sErr } = await supabase
      .from('league_seasons')
      .select('id, season_number, name')
      .eq('status', 'completed')
      .order('season_number', { ascending: false })
      .limit(5);
    if (sErr || !seasons?.length) return null;

    const byId = Object.fromEntries(seasons.map(s => [s.id, s]));

    const { data: rows, error: rErr } = await supabase
      .from('league_season_stats')
      .select('season_id, best_tier, weeks_qualified, season_xp, final_rank, awarded_at')
      .eq('user_id', user.id)
      .in('season_id', seasons.map(s => s.id))
      .not('awarded_at', 'is', null);
    if (rErr || !rows?.length) return null;

    // Newest completed season the user actually collected in.
    rows.sort((a, b) =>
      (byId[b.season_id]?.season_number || 0) - (byId[a.season_id]?.season_number || 0));
    const row = rows[0];
    const season = byId[row.season_id];
    if (!season) return null;

    const tier = row.best_tier || 'bronze';
    const trophyId = `league_s${season.season_number}_${tier}`;
    const championId = `league_s${season.season_number}_champion`;

    // The champion trophy is the only way to know they won it — final_rank is
    // over the whole field, and the champion is the top LEGEND, which is not
    // the same person when nobody reached Legend.
    const { data: champRows } = await supabase
      .from('user_trophies')
      .select('trophy_id')
      .eq('user_id', user.id)
      .eq('trophy_id', championId)
      .limit(1);

    const isChampion = !!champRows?.length;

    return {
      seasonNumber: season.season_number,
      seasonName: season.name,
      tier,
      weeksQualified: row.weeks_qualified ?? 0,
      seasonXp: row.season_xp ?? 0,
      finalRank: row.final_rank ?? null,
      isChampion,
      trophyId: isChampion ? championId : trophyId,
      titleId: isChampion ? championId : trophyId,
      capsule: SEASON_CAPSULE[tier] ?? null,
      awardedAt: row.awarded_at,
    };
  } catch {
    return null;
  }
}

/** Mirrors the capsule ladder in award_league_season_internal (migration 312). */
const SEASON_CAPSULE = {
  legend: 'elite',
  diamond: 'premium',
  platinum: 'premium',
  gold: 'standard',
  silver: null,
  bronze: null,
};

/**
 * Per-device flag for "this result has been shown".
 *
 * Follows the `flexyn.<feature>.<userId>` namespace. Per-device rather than
 * server-side on purpose: seeing your own season result again on a second
 * device is a feature, not a bug, and it needs no schema.
 */
export function seasonResultSeenKey(userId) {
  return `flexyn.seenSeasonResult.${userId}`;
}

export function hasSeenSeasonResult(userId, seasonNumber) {
  if (!userId || seasonNumber == null) return true;
  try {
    return localStorage.getItem(seasonResultSeenKey(userId)) === String(seasonNumber);
  } catch {
    // Private mode / storage disabled — treat as seen rather than replaying
    // the ceremony on every single mount.
    return true;
  }
}

export function markSeasonResultSeen(userId, seasonNumber) {
  if (!userId || seasonNumber == null) return;
  try {
    localStorage.setItem(seasonResultSeenKey(userId), String(seasonNumber));
  } catch {
    // Nothing to do; worst case the ceremony shows again next mount.
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
