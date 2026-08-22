// src/lib/notificationText.js
//
// Renders a notification row's title and body IN THE READER'S LANGUAGE,
// from its `type` plus `metadata`, instead of from the text stored on the row.
//
// ── Why this exists ──────────────────────────────────────────────────────
//
// `notifications.title` / `.body` are written once and never re-rendered, so
// a row is frozen in whatever language produced it: the client's language for
// client-written rows, and whatever the per-language SQL helper emitted for
// server-written ones (migrations 035, 037, 040, 041 each carry a CASE over
// fifteen languages). Switching app language moves none of them.
//
// The `notifications.row.*` key family was built for exactly this and had no
// reader at all — thirteen types with title/body keys, variants included, in
// all fifteen catalogs, maintained by translators for a consumer that did not
// exist. This is that consumer.
//
// ── The safety property, which is the whole design ───────────────────────
//
// A spec is used ONLY when every placeholder it needs is present on the row.
// Anything else — an unmapped type, a missing metadata field, a row written
// before its writer populated metadata — falls back to the stored text, which
// is exactly today's behaviour. So this can improve a row and cannot break
// one.
//
// That matters more than usual here: the metadata field names below were read
// from MIGRATION SOURCE, not from live rows, and this repo has been bitten
// before by a later migration redefining a function from a stale template
// (see the push-notification account in CLAUDE.md). The fallback is what makes
// it safe to ship that reading.
//
// ── Extending it ─────────────────────────────────────────────────────────
//
// 24 of the 37 types in notificationCatalog.js are not here yet, because they
// have no `notifications.row.*` keys. Adding one means: read its writer, add
// the catalog rows, add a spec, and CHECK A LIVE ROW carries the metadata.

import { asT } from '@/lib/translatorArg';

/**
 * How to rebuild each type's text.
 *
 * `vars` maps a placeholder name to the metadata field that fills it. `pick`
 * chooses between key variants when a type has more than one shape.
 *
 * Three body states, and conflating the last two is a bug I shipped and a
 * test caught:
 *
 *   a body part   → rebuild it
 *   nothing       → the type HAS no body (friend_post, post_like)
 *   keepBody      → the stored body is USER CONTENT and must survive
 *                   (comment_reply's body is the comment someone wrote)
 */
const SPECS = {
  friend_follow: {
    title: { key: 'notifications.row.friend_follow.title', en: '{name} followed you', vars: { name: 'followerName' } },
    body:  { key: 'notifications.row.friend_follow.body',  en: 'Tap to view their profile.' },
  },
  friend_post: {
    title: { key: 'notifications.row.friend_post.title', en: '{name} posted', vars: { name: 'posterName' } },
  },
  league_promoted: {
    title: { key: 'notifications.row.league_promoted.title', en: '⬆️ Promoted to {tier}!', vars: { tier: 'toTier' } },
    // Two shapes, and the capsule one is only right when a capsule was
    // actually awarded — the RPC leaves capsuleAwarded null otherwise.
    pick: (m) => (m.capsuleAwarded
      ? { key: 'notifications.row.league_promoted.body_with_capsule', en: '+{coins} coins + {capsule} capsule', vars: { coins: 'coinsAwarded', capsule: 'capsuleAwarded' } }
      : { key: 'notifications.row.league_promoted.body', en: '+{coins} coins', vars: { coins: 'coinsAwarded' } }),
  },
  league_demoted: {
    title: { key: 'notifications.row.league_demoted.title', en: '⬇️ Demoted to {tier}', vars: { tier: 'toTier' } },
    body:  { key: 'notifications.row.league_demoted.body',  en: 'Climb back next week!' },
  },
  league_held: {
    title: { key: 'notifications.row.league_held.title', en: 'Held position in {tier}', vars: { tier: 'toTier' } },
    pick: (m) => (Number(m.coinsAwarded) > 0
      ? { key: 'notifications.row.league_held.body_coins',   en: '+{coins} coins', vars: { coins: 'coinsAwarded' } }
      : { key: 'notifications.row.league_held.body_default', en: 'Push for promotion next week.' }),
  },
  streak_break_warning: {
    title: { key: 'notifications.row.streak_break_warning.title', en: '🔥 {streak}-day streak at risk', vars: { streak: 'workout_streak' } },
    body:  { key: 'notifications.row.streak_break_warning.body',  en: 'Your streak ends at midnight. A quick workout keeps it alive.' },
  },
  quest_expiry_warning: {
    title: { key: 'notifications.row.quest_expiry_warning.title', en: '⏳ {remaining} quests left today', vars: { remaining: 'remaining' } },
    body:  { key: 'notifications.row.quest_expiry_warning.body',  en: "Quests reset at midnight. Don't miss the coins!" },
  },
  welcome_back: {
    title: { key: 'notifications.row.welcome_back.title', en: '👋 We miss you' },
    body:  { key: 'notifications.row.welcome_back.body',  en: 'Your progress is waiting. Quick session today?' },
  },

  // ── Below: mapped from LIVE ROWS, not from migration source ───────────
  // Every field name here was read out of production `metadata` and every
  // English template was matched against a real stored title, including its
  // variants. That is a stronger footing than the block above, which was
  // read from migrations — and reading the live rows is what caught that
  // three OTHER types cannot be done at all (see CANNOT_LOCALIZE).

  bounty_claim: {
    title: { key: 'notifications.row.bounty_claim.title', en: '{name} is coming for your record', vars: { name: 'claimant_name' } },
    body:  { key: 'notifications.row.bounty_claim.body',  en: 'A bounty has been claimed against you.' },
  },
  coin_gift: {
    title: { key: 'notifications.row.coin_gift.title', en: 'You received a coin gift!' },
    body:  { key: 'notifications.row.coin_gift.body',  en: '@{name} sent you {n} coins', vars: { name: 'senderUsername', n: 'amount' } },
  },
  comment_reply: {
    // The stored body is the comment text. Keep it.
    keepBody: true,
    // `is_reply` picks the sentence — the same branch migration 086 takes.
    pickTitle: (m) => (m.is_reply
      ? { key: 'notifications.row.comment_reply.title_reply',   en: '{name} replied to your comment', vars: { name: 'commenter_name' } }
      : { key: 'notifications.row.comment_reply.title_comment', en: '{name} commented on your post',  vars: { name: 'commenter_name' } }),
  },
  duel_invite: {
    title: { key: 'notifications.row.duel_invite.title', en: '{name} challenged you to a duel', vars: { name: 'challenger_name' } },
    body:  { key: 'notifications.row.duel_invite.body',  en: 'Tap to accept or decline.' },
  },
  post_like: {
    title: { key: 'notifications.row.post_like.title', en: '{name} liked your post', vars: { name: 'actor_name' } },
  },
  post_reaction: {
    title: { key: 'notifications.row.post_reaction.title', en: '{name} reacted with {emoji}', vars: { name: 'actor_name', emoji: 'item_emoji' } },
  },
  quest_claimed: {
    title: { key: 'notifications.row.quest_claimed.title', en: '🪙 +{coins} coins · {quest}', vars: { coins: 'coinsAwarded', quest: 'questLabel' } },
    body:  { key: 'notifications.row.quest_claimed.body',  en: 'Quest reward claimed.' },
  },
  streak_milestone: {
    // `kind` is login|workout, which is exactly the split the catalog already
    // had as login.title / workout.title. Whoever wrote those keys read the
    // real writer; they had just never been called.
    pickTitle: (m) => (m.kind === 'workout'
      ? { key: 'notifications.row.streak_milestone.workout.title', en: '🔥 Workout streak: Day {day}!', vars: { day: 'day' } }
      : { key: 'notifications.row.streak_milestone.login.title',   en: '🔥 Login streak: Day {day}!',   vars: { day: 'day' } }),
    pick: (m) => (m.eliteCapsuleAwarded
      ? { key: 'notifications.row.streak_milestone.body_with_capsule', en: '+{coins} coins + Elite Capsule', vars: { coins: 'coinsAwarded' } }
      : { key: 'notifications.row.streak_milestone.body',             en: '+{coins} coins',                 vars: { coins: 'coinsAwarded' } }),
  },

  // ── Unblocked by migration 379 ────────────────────────────────────────
  // These three name somebody the row used to identify only by id. 379 adds
  // a BEFORE INSERT trigger that resolves the name into metadata, and
  // backfills the rows already written. A row from before that migration —
  // or one whose subject has since been deleted, which is the case for all
  // four live nemesis_assigned rows — has no name to resolve and falls back.

  crew_war_started: {
    title: { key: 'notifications.row.crew_war_started.title', en: '⚔️ Crew war vs {name}', vars: { name: 'opponent_crew_name' } },
    body:  { key: 'notifications.row.crew_war_started.body',  en: "Every session this week counts. Let's go." },
  },
  crew_war_resolved: {
    pickTitle: (m) => {
      if (m.outcome === 'won')  return { key: 'notifications.row.crew_war_resolved.title_won',  en: '🏆 You crushed {name}!',     vars: { name: 'opponent_crew_name' } };
      if (m.outcome === 'lost') return { key: 'notifications.row.crew_war_resolved.title_lost', en: '💪 {name} won this round',   vars: { name: 'opponent_crew_name' } };
      return { key: 'notifications.row.crew_war_resolved.title_tied', en: '🤝 Tied with {name}', vars: { name: 'opponent_crew_name' } };
    },
    // The server writes NULL for this body and the card shows the scores.
  },
  nemesis_assigned: {
    pickTitle: (m) => {
      if (m.result === 'declined') {
        return { key: 'notifications.row.nemesis_assigned.title_declined', en: '@{name} declined the challenge', vars: { name: 'rival_display_name' } };
      }
      // `rival_type` is gym|cardio and picks which rival this is. Two keys
      // rather than one with a {label} slot: "Gym Rival" and "Cardio Rival"
      // are feature names, and a slot would ask a translator to decline a
      // noun they cannot see.
      return m.rival_type === 'cardio'
        ? { key: 'notifications.row.nemesis_assigned.title_cardio', en: '🎯 @{name} wants to be your Cardio Rival', vars: { name: 'rival_display_name' } }
        : { key: 'notifications.row.nemesis_assigned.title_gym',    en: '🎯 @{name} wants to be your Gym Rival',    vars: { name: 'rival_display_name' } };
    },
    pick: (m) => (m.result === 'declined'
      ? { key: 'notifications.row.nemesis_assigned.body_declined', en: "They backed out before the match started. Roll a new rival when you're ready." }
      : { key: 'notifications.row.nemesis_assigned.body_invite',   en: "Confirm to start this week's challenge. Whoever goes AFK first forfeits." }),
  },
};

/** Fill a part's vars from metadata, or return null if any is absent. */
function resolve(part, meta, tf) {
  if (!part) return null;
  const vars = {};
  for (const [placeholder, field] of Object.entries(part.vars || {})) {
    const v = meta?.[field];
    // Only null/undefined disqualifies. 0 is a real coin count and '' is a
    // real (if unhelpful) tier name; treating either as missing would drop
    // the whole row back to stored text for no reason.
    if (v === null || v === undefined) return null;
    vars[placeholder] = v;
  }
  return tf(part.key, part.en, vars);
}

/**
 * @param {object} row  a notifications row: { type, title, body, metadata }
 * @param {function} t  the reader's tFallback
 * @returns {{ title: string, body: string|null, localized: boolean }}
 */
export function notificationText(row, t) {
  const tf = asT(t);
  const stored = { title: row?.title ?? '', body: row?.body ?? null, localized: false };
  const spec = SPECS[row?.type];
  if (!spec) return stored;

  const meta = row?.metadata || {};
  const title = resolve(spec.pickTitle ? spec.pickTitle(meta) : spec.title, meta, tf);
  // A title we cannot rebuild means the row does not carry what this spec
  // assumes, so the whole row falls back rather than pairing a fresh title
  // with a stale body.
  if (!title) return stored;

  // User content is never rebuilt — see the SPECS comment.
  if (spec.keepBody) return { title, body: stored.body, localized: true };

  const bodyPart = spec.pick ? spec.pick(meta) : spec.body;
  const body = resolve(bodyPart, meta, tf);
  // A body part that will not resolve keeps the stored body: at worst the old
  // language, where null would be a blank line.
  return { title, body: bodyPart ? (body ?? stored.body) : null, localized: true };
}

/**
 * Was three live types that could not be rebuilt at all. Migration 379 closed
 * every one of them, so this is empty — kept, not deleted, because an empty
 * list is the statement "we checked" and a missing one is silence. Add a type
 * here if a row ever names something it does not store.
 */
export const CANNOT_LOCALIZE = {};

/** The types this module can rebuild. Exported for the guard test. */
export const LOCALIZED_TYPES = Object.keys(SPECS);
