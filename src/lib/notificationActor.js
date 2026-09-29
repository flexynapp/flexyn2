// src/lib/notificationActor.js
//
// Who is behind a notification, so the row can show their face instead of
// a generic heart or speech bubble.
//
// The person is read from the row's `metadata`, and every writer names them
// differently: `actor_id` on likes and reactions, `commenter_id` on comments,
// `senderId` on coin gifts, `challenger_id` on duels, and so on. Listed here
// once rather than per type, because a key only ever means "the other person".
//
// Always an id, never an email. Other people's emails are being withdrawn
// from the client, so a lookup keyed on one would stop working the day the
// columns are locked.
//
// Two types carry only a display name: `friend_follow` (`followerName`) and
// `friend_post` (`posterName`). Their writers put `@username` there when the
// sender has one, so a leading `@` is the signal that the value is a real
// username and can be looked up. Without it the value is an email prefix,
// which could match a stranger who happens to use it as a username, so it
// is never looked up.

import { isFromPeople } from '@/lib/notificationCatalog';

const ID_KEYS = [
  'actor_id', 'commenter_id', 'senderId', 'challenger_id',
  'claimant_id', 'initiator_id', 'opponent_id', 'from_user_id',
];
const NAME_KEYS = ['followerName', 'posterName'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^@([A-Za-z0-9_.]{1,40})$/;

/**
 * The other person on a notification row: `{ id }`, `{ username }`, or
 * null when the row is not from a person or does not say who.
 */
export function actorRefOf(n) {
  if (!n || !isFromPeople(n.type)) return null;
  const m = n.metadata && typeof n.metadata === 'object' ? n.metadata : {};
  for (const k of ID_KEYS) {
    const v = m[k];
    // Never show the reader their own face on a row about someone else.
    if (typeof v === 'string' && UUID.test(v) && v !== n.user_id) return { id: v };
  }
  for (const k of NAME_KEYS) {
    const hit = typeof m[k] === 'string' ? m[k].trim().match(USERNAME) : null;
    if (hit) return { username: hit[1] };
  }
  return null;
}

/** Stable key for the actor lookup map. */
export function actorKey(ref) {
  if (!ref) return null;
  return ref.id ? `id:${ref.id}` : `u:${ref.username}`;
}

/** Distinct ids and usernames to fetch for a list of rows. */
export function collectActorRefs(rows) {
  const ids = new Set();
  const usernames = new Set();
  for (const n of rows || []) {
    const ref = actorRefOf(n);
    if (ref?.id) ids.add(ref.id);
    else if (ref?.username) usernames.add(ref.username);
  }
  return { ids: [...ids].sort(), usernames: [...usernames].sort() };
}
