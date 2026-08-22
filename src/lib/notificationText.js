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
 * A `null` from `pick` means "no body", which is not the same as a missing
 * body: `capsule_earned` genuinely has one and `friend_post` genuinely
 * does not.
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
  const title = resolve(spec.title, meta, tf);
  // A title we cannot rebuild means the row does not carry what this spec
  // assumes, so the whole row falls back rather than pairing a fresh title
  // with a stale body.
  if (!title) return stored;

  const bodyPart = spec.pick ? spec.pick(meta) : spec.body;
  const body = resolve(bodyPart, meta, tf);
  // A spec with a body part that will not resolve keeps the stored body: it
  // is at worst the old language, where null would be a blank line.
  return { title, body: bodyPart ? (body ?? stored.body) : null, localized: true };
}

/** The types this module can rebuild. Exported for the guard test. */
export const LOCALIZED_TYPES = Object.keys(SPECS);
