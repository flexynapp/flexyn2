// src/lib/data/hubPosts.js
// Hub posts — community feed entries.
// Privacy is enforced here (and should be re-enforced server-side on migration).

import { db } from '@/api/db';
import { containsProfanity } from '@/lib/profanityFilter';

const e = () => db.entities.HubPost;

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(
        new Error(`Profanity detected in field "${key}"`),
        { code: 'PROFANITY', field: key }
      );
    }
  }
}

/**
 * List public posts for the global feed ("The Pump"), newest first.
 */
export const listPublicFeed = async (limit = 50) => {
  return e().filter({ privacy: 'public' }, '-created_date', limit);
};

/**
 * List posts visible to the current user from people they follow ("Squad").
 * Includes both public and followers-only posts from followed users.
 *
 * Single batched query via .in() — used to be one query per follow which
 * was 50+ round-trips for an active user. The DB layer's filter shim
 * (src/api/db.js) translates an array value into a `.in()` clause.
 *
 * @param {string[]} followingEmails — emails the current user follows
 */
export const listSquadFeed = async (followingEmails = [], limit = 50) => {
  if (!followingEmails || followingEmails.length === 0) return [];
  // Cap at 100 follows to keep the .in() list bounded; power-followers
  // beyond that lose visibility into the tail (acceptable trade-off vs
  // letting the IN clause grow unbounded).
  const emails = followingEmails.slice(0, 100);
  const rows = await e()
    .filter({ author_email: emails }, '-created_date', limit)
    .catch(() => []);
  return rows;
};

/**
 * List a single user's posts. Honors privacy: if the viewer doesn't follow
 * the author, only public posts are returned.
 *
 * @param {string} authorEmail
 * @param {boolean} isFollowing — does the viewer follow this author?
 * @param {boolean} isSelf — is the viewer the same as the author?
 */
export const listForProfile = async (authorEmail, isFollowing, isSelf, limit = 50) => {
  if (!authorEmail) return [];
  const all = await e().filter({ author_email: authorEmail }, '-created_date', limit).catch(() => []);
  if (isSelf) return all;
  if (isFollowing) return all;
  return all.filter(p => p.privacy === 'public');
};

/** Fetch a single post by id. */
export const get = (id) =>
  e().filter({ id }).then(rows => rows?.[0] || null);

/** Create a new post. */
export const create = (data) => {
  assertNoTextProfanity({ body: data.body, caption: data.caption });
  return e().create(data);
};

/** Update a post (typically only counters or own content). */
export const update = (id, data) => {
  const textFields = {};
  if (data.body !== undefined) textFields.body = data.body;
  if (data.caption !== undefined) textFields.caption = data.caption;
  if (Object.keys(textFields).length) assertNoTextProfanity(textFields);
  return e().update(id, data);
};

/** Delete a post. RLS enforces only the author can do this. */
export const remove = (id) => e().delete(id);

/**
 * Atomically bump a counter. Reads the post, increments the field locally,
 * writes back. NOT race-safe — flagged in BACKEND_CONTRACT as needing
 * atomic increment on migration target.
 */
export const incrementCounter = async (postId, field, delta = 1) => {
  const post = await get(postId);
  if (!post) return null;
  const current = Number(post[field] || 0);
  const next = Math.max(0, current + delta);
  return e().update(postId, { [field]: next });
};

/**
 * Cascade-delete every post by a user. Used by account deletion.
 */
export const purgeForUser = async (email) => {
  if (!email) return;
  const PAGE = 100;
   
  while (true) {
    const batch = await e()
      .filter({ author_email: email }, '-created_date', PAGE)
      .catch(() => []);
    if (!batch || batch.length === 0) break;
    await Promise.all(batch.map(r => e().delete(r.id).catch(() => {})));
    if (batch.length < PAGE) break;
  }
};

// ─── Paginated feed window helpers ───
//
// Base44's filter API doesn't support cursor-based pagination natively, so
// these helpers fetch a bounded window of posts (default 100) on the server
// side and let the caller slice client-side for progressive reveal. This
// gives the Instagram-style "load more as you scroll" UX without the cost of
// rendering everything at once.
//
// On migration to a real backend, replace these with cursor-based pagination
// queries (e.g. WHERE created_date < $cursor LIMIT 8).
//
// Already-defined: listPublicFeed(limit), listSquadFeed(emails, limit)

const FETCH_WINDOW = 100; // server-side cap per fetch

/**
 * Fetch the global public feed window (newest first, capped at FETCH_WINDOW).
 * The caller paginates client-side.
 */
export const fetchGlobalWindow = () =>
  e().filter({ privacy: 'public' }, '-created_date', FETCH_WINDOW).catch(() => []);

/**
 * Fetch the Following feed window — posts authored by users in
 * `followingEmails`, both public AND followers-only privacy.
 *
 * Single batched query via .in('author_email', emails). Replaces the
 * old per-author fan-out (1 query per follow = 50+ round-trips for
 * active users) with a single bounded query. The DB layer shim
 * (src/api/db.js) translates an array value into a `.in()` clause.
 */
export const fetchFollowingWindow = async (followingEmails = []) => {
  if (!followingEmails || followingEmails.length === 0) return [];
  const emails = followingEmails.slice(0, 100);
  const rows = await e()
    .filter({ author_email: emails }, '-created_date', FETCH_WINDOW)
    .catch(() => []);
  return rows;
};