// src/lib/rankUp.js
//
// Has the user moved up since this device last saw their league?
//
// League moves are decided on the server (the Monday roll, or the first real
// Strength Score replacing an onboarding guess), usually while the user is
// away. The rank up sequence plays the next time they open Today, so the
// client needs to know where they stood the last time it showed them. That
// is kept per user on this device, the same way Lead Lifter reveals are
// (`flexyn.<feature>.<userId>`).
//
// Two kinds of move up, and only moves UP play anything:
//
//   tier   Silver to Gold, or further in one jump. The big sequence.
//   level  Gold II to Gold III inside the same league. The lighter one.
//
// A demotion updates the record silently: a sequence for going down reads
// as the app rubbing it in.
//
// No record yet (first open after this shipped, or a new device) records
// where they are and plays nothing, because there is nothing to compare.
//
// Presentation only. Nothing here reads or writes a league row; the caller
// passes in what getMyLeague already fetched.

import { TIERS, MAX_LEAGUE_LEVEL } from '@/lib/leagueTiers';

const KEY = (userId) => `flexyn.rankSeen.${userId}`;
const TIER_INDEX = Object.fromEntries(TIERS.map((t, i) => [t.id, i]));

function clampLevel(level) {
  const n = Math.round(Number(level) || 1);
  return Math.min(MAX_LEAGUE_LEVEL, Math.max(1, n));
}

/** A {tier, level} the rest of this file can trust, or null. */
export function normalizeRank(rank) {
  if (!rank || TIER_INDEX[rank.tier] === undefined) return null;
  return { tier: rank.tier, level: clampLevel(rank.level) };
}

/**
 * Compare the last rank this device showed with the current one.
 *
 * @returns {null | { kind: 'tier' | 'level', from: {tier, level}, to: {tier, level} }}
 */
export function detectRankUp(seen, current) {
  const a = normalizeRank(seen);
  const b = normalizeRank(current);
  if (!a || !b) return null;
  const ta = TIER_INDEX[a.tier];
  const tb = TIER_INDEX[b.tier];
  if (tb > ta) return { kind: 'tier', from: a, to: b };
  if (tb === ta && b.level > a.level) return { kind: 'level', from: a, to: b };
  return null;
}

/**
 * What to record after a comparison. Inside the same league the level only
 * ever climbs (it counts qualified weeks in the stint), so the record keeps
 * the higher of the two: getMyLeagueLevel falls back to I on a failed read,
 * and recording that fallback would replay the step on the next good read.
 */
export function nextSeen(seen, current) {
  const a = normalizeRank(seen);
  const b = normalizeRank(current);
  if (!b) return a;
  if (a && a.tier === b.tier) return { tier: b.tier, level: Math.max(a.level, b.level) };
  return b;
}

export function readSeenRank(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(KEY(userId));
    return raw ? normalizeRank(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeSeenRank(userId, rank) {
  const r = normalizeRank(rank);
  if (!userId || !r) return;
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(r));
  } catch { /* storage unavailable: the sequence may replay, which is harmless */ }
}

/**
 * The whole check: read the record, compare, write the new record, and
 * return the move to play (or null). Writing before the sequence plays means
 * a crash or a closed tab mid-sequence never replays it on every open.
 */
export function consumeRankUp(userId, current) {
  if (!userId || !normalizeRank(current)) return null;
  const seen = readSeenRank(userId);
  const move = detectRankUp(seen, current);
  writeSeenRank(userId, nextSeen(seen, current));
  return move;
}

/**
 * How big each league's promotion is. Every league up the ladder is a bigger
 * moment than the one below it, the way a rarer capsule is. Same fields as
 * the capsule DRAMA table in openFx, so the stage effects read them as-is.
 *
 * charge  ms the old crest strains before it breaks
 * hold    ms between the new crest landing and its name stamping in
 */
export const RANK_DRAMA = {
  bronze:   { rays: 0.05, rings: 1, sparks: 12, shake: 3,  flash: 0.08, charge: 1400, hold: 260 },
  silver:   { rays: 0.07, rings: 2, sparks: 14, shake: 4,  flash: 0.12, charge: 1500, hold: 320 },
  gold:     { rays: 0.09, rings: 2, sparks: 18, shake: 6,  flash: 0.16, charge: 1700, hold: 420 },
  platinum: { rays: 0.11, rings: 3, sparks: 22, shake: 7,  flash: 0.2,  charge: 1900, hold: 520 },
  diamond:  { rays: 0.13, rings: 3, sparks: 26, shake: 9,  flash: 0.24, charge: 2100, hold: 620 },
  legend:   { rays: 0.15, rings: 3, sparks: 30, shake: 11, flash: 0.3,  charge: 2300, hold: 720 },
};

/** A level step inside a league: the same stage, turned down. */
export const LEVEL_DRAMA = { rays: 0.05, rings: 1, sparks: 10, shake: 2, flash: 0, charge: 900, hold: 220 };

export function rankDramaFor(move) {
  if (!move) return LEVEL_DRAMA;
  if (move.kind === 'level') return LEVEL_DRAMA;
  return RANK_DRAMA[move.to.tier] ?? RANK_DRAMA.silver;
}
