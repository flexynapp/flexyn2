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
 * @param {string[]} followingEmails — emails the current user follows
 */
export const listSquadFeed = async (followingEmails = [], limit = 50) => {
  if (!followingEmails || followingEmails.length === 0) return [];
  // Base44 entity API doesn't support OR-filter on author_email natively, so
  // we batch by author and merge. Acceptable up to ~100 follows.
  const results = await Promise.all(
    followingEmails.slice(0, 100).map(email =>
      e().filter({ author_email: email }, '-created_date', 30).catch(() => [])
    )
  );
  const merged = results.flat();
  // Sort newest first and dedupe
  const seen = new Set();
  const deduped = [];
  for (const post of merged.sort((a, b) =>
    new Date(b.created_date) - new Date(a.created_date)
  )) {
    if (!seen.has(post.id)) { seen.add(post.id); deduped.push(post); }
  }
  return deduped.slice(0, limit);
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
 * `followingEmails`, both public AND followers-only privacy. The caller
 * paginates client-side.
 *
 * Implementation: we batch by author since Base44 doesn't support OR-filter
 * on author_email. Pull recent posts from each followed user, merge,
 * dedupe, sort, cap.
 */
export const fetchFollowingWindow = async (followingEmails = []) => {
  if (!followingEmails || followingEmails.length === 0) return [];
  const perAuthor = Math.max(8, Math.ceil(FETCH_WINDOW / Math.min(followingEmails.length, 50)));
  const batches = await Promise.all(
    followingEmails.slice(0, 50).map(email =>
      e().filter({ author_email: email }, '-created_date', perAuthor).catch(() => [])
    )
  );
  const seen = new Set();
  const merged = [];
  for (const post of batches.flat().sort((a, b) =>
    new Date(b.created_date) - new Date(a.created_date)
  )) {
    if (!seen.has(post.id)) { seen.add(post.id); merged.push(post); }
    if (merged.length >= FETCH_WINDOW) break;
  }
  return merged;
};