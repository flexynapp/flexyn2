// src/lib/crewPermissions.js
//
// Crew ranks and what each one may do.
//
// THREE RANKS, AND THE NUMBER IS THE POINT
//
//   3  leader     every permission
//   2  moderator  runs the crew day to day; cannot change who runs it
//   1  member     trains, talks, and fights; changes nothing
//
// `crew_members` stores the NAME in `role` and a legacy `is_admin` boolean
// alongside it, kept in step by a database trigger. Rank is the ordering
// those two cannot express: "can this person act on that person" is a
// comparison, and comparing strings named 'moderator' and 'member' is how
// you end up with alphabetical authority. Everything here compares numbers.
//
// THIS FILE IS NOT THE ENFORCEMENT. Migration 357 is. Every capability
// below is gated again in RLS or inside a SECURITY DEFINER function, and
// the server does not trust anything the client believes about rank. What
// this file buys is a UI that does not offer a control the server will
// refuse — which is the difference between a permission system and a
// button that fails.
//
// When you add a capability, add it in BOTH places or it is not a
// permission. `src/lib/__tests__/crewPermissions.test.js` pins the matrix
// so a silent widening fails the suite.

export const RANK = {
  MEMBER:    1,
  MODERATOR: 2,
  LEADER:    3,
};

export const RANK_NAME = {
  1: 'member',
  2: 'moderator',
  3: 'leader',
};

/**
 * A member row's rank as a number.
 *
 * Reads `role` first and falls back to `is_admin`, because rows written
 * before migration 250's sync trigger carry only the boolean. An unknown
 * role string floors to MEMBER rather than throwing: a row we cannot
 * classify must not be granted anything.
 */
export function rankOf(member) {
  if (!member) return 0;
  const role = typeof member.role === 'string' ? member.role.toLowerCase() : null;
  if (role === 'leader')    return RANK.LEADER;
  if (role === 'moderator') return RANK.MODERATOR;
  if (role === 'member')    return RANK.MEMBER;
  return member.is_admin ? RANK.LEADER : RANK.MEMBER;
}

export function rankLabel(rank, tFallback) {
  const t = tFallback || ((_k, f) => f);
  if (rank === RANK.LEADER)    return t('crew.rank.leader',    'Leader');
  if (rank === RANK.MODERATOR) return t('crew.rank.moderator', 'Moderator');
  return t('crew.rank.member', 'Member');
}

// ── The matrix ────────────────────────────────────────────────────────
//
// Minimum rank required for each capability. Anything absent from this
// object is available to every member of the crew, which is the correct
// default for a group you already belong to — reading the roster, the
// chat, the war board and the league table are not privileges.
//
// The split follows the brief: a member trains and talks, a moderator
// runs the crew, a leader decides who runs it. Everything that changes the
// crew's IDENTITY or its ROSTER STRUCTURE is leader-only, because those
// are the acts a member cannot undo by leaving.
//
// STARTING A WAR IS LEADER-ONLY (kegan, 2026-08-15). It sat at rank 2 for
// one commit on the reasoning that entering matchmaking is operational
// rather than structural. That was a judgement call filling a gap in the
// brief, which named only what a MEMBER may not do — and the decision is
// the product owner's. It commits every member of the crew to a seven-day
// competition, which is a fair reading of "structural". Migration 358 is
// the server half; do not move one without the other.
export const CAPABILITY = {
  // Rank 1 — every member
  SEND_MESSAGE:        RANK.MEMBER,
  REACT_TO_MESSAGE:    RANK.MEMBER,
  DELETE_OWN_MESSAGE:  RANK.MEMBER,
  CONTRIBUTE_TO_WAR:   RANK.MEMBER,
  POST_STORY:          RANK.MEMBER,
  CLAIM_XP_FUEL:       RANK.MEMBER,
  LEAVE_CREW:          RANK.MEMBER,

  // Rank 2 — moderators run the crew
  PIN_MESSAGE:         RANK.MODERATOR,
  DELETE_ANY_MESSAGE:  RANK.MODERATOR,
  ASSIGN_REGIMEN:      RANK.MODERATOR,
  CREATE_CHALLENGE:    RANK.MODERATOR,
  START_ROLL_CALL:     RANK.MODERATOR,
  KICK_MEMBER:         RANK.MODERATOR,   // rank 1 targets only — see canActOn

  // Rank 3 — leaders decide who runs it, and commit it to a fight
  START_WAR:           RANK.LEADER,
  CANCEL_WAR_QUEUE:    RANK.LEADER,
  PROMOTE_MEMBER:      RANK.LEADER,
  TRANSFER_LEADERSHIP: RANK.LEADER,
  DEMOTE_MEMBER:       RANK.LEADER,
  EDIT_CREW_PROFILE:   RANK.LEADER,
  MANAGE_TREASURY:     RANK.LEADER,
  DISBAND_CREW:        RANK.LEADER,
};

/** Does this rank hold this capability? */
export function can(rank, capability) {
  const need = CAPABILITY[capability];
  if (need === undefined) return rank >= RANK.MEMBER;
  return rank >= need;
}

/** Convenience for a member row rather than a bare rank. */
export function memberCan(member, capability) {
  return can(rankOf(member), capability);
}

/**
 * Whether `actorRank` may act on `targetRank` at all.
 *
 * Strictly greater, never equal. Two moderators cannot kick each other and
 * a leader cannot kick a co-leader — that is a structural fight the app
 * should not arbitrate, and letting it happen means whoever taps first
 * wins. Demoting a peer is a leader-on-moderator act, which this allows;
 * leader-on-leader it does not.
 */
export function canActOn(actorRank, targetRank) {
  return actorRank > targetRank;
}

/**
 * Ranks `actorRank` may assign to `targetRank`.
 *
 * A leader may appoint and unappoint moderators. Promoting someone to
 * LEADER is deliberately absent: it is not a role change but a transfer
 * of the crew, and it belongs behind its own confirmed action — see
 * TRANSFER_LEADERSHIP and transferLeadership() — rather than a row in a
 * list. Nothing below leader may assign anything.
 */
export function assignableRanks(actorRank, targetRank) {
  if (actorRank < RANK.LEADER) return [];
  if (!canActOn(actorRank, targetRank)) return [];
  return [RANK.MEMBER, RANK.MODERATOR].filter(r => r !== targetRank);
}
