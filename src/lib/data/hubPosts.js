// src/lib/data/hubPosts.js
// Hub posts — community feed entries.
// Privacy is enforced here (and should be re-enforced server-side on migration).

import { ownedRows } from './ownedRows';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';
import { track, EVENTS } from '@/lib/analytics';

const e = () => ownedRows('hub_posts');

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
 * was 50+ round-trips for an active user. ownedRows.filter turns an
 * array value into a `.in()` clause.
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
  return Promise.resolve(e().create(data)).then((row) => {
    track(EVENTS.POST_CREATED, { type: data.post_type || 'status', media: Boolean(data.image_url || data.video_url) });
    return row;
  });
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
export const remove = (id) => e().remove(id);

/**
 * Bump a denormalized counter (like_count / dislike_count / comment_count)
 * on a hub_post.
 *
 * Atomic via the increment_hub_post_counter RPC (migration 077). The
 * previous client-side path was read-then-write — two simultaneous
 * likes on a hot post both read like_count, both wrote current+1, so
 * one like was silently dropped. The RPC does delta arithmetic
 * server-side with a whitelist on the field name.
 *
 * Pre-077 hosts fall back to the legacy RMW path so the feature
 * doesn't break on stale deployments; the race is the documented bug.
 */
export const incrementCounter = async (postId, field, delta = 1) => {
  const { data, error } = await supabase.rpc('increment_hub_post_counter', {
    p_post_id: postId,
    p_field:   field,
    p_delta:   delta,
  });
  if (!error) return data;
  if (error.code !== '42883' && error.code !== '42P01') {
    console.warn('[hubPosts] increment_hub_post_counter failed:', error);
    return null;
  }

  // Legacy fallback for pre-077 hosts. Race window is the documented bug.
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
    await Promise.all(batch.map(r => e().remove(r.id).catch(() => {})));
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
 * The author set for the Following feed: everyone you follow, plus you.
 *
 * Case-insensitive de-dupe, because a follow row and the session email can
 * differ in case and the same address twice in an IN clause is a wasted slot
 * against the 100 cap.
 */
function withSelf(followingEmails = [], selfEmail = null) {
  const seen = new Set();
  const out = [];
  for (const e of [...(followingEmails || []), selfEmail]) {
    if (!e) continue;
    const k = String(e).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.slice(0, 100);
}

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
 * active users) with a single bounded query. ownedRows.filter turns an
 * array value into a `.in()` clause.
 */
export const fetchFollowingWindow = async (followingEmails = [], selfEmail = null) => {
  // Your own posts belong in Following. "In a weird way it's as if you follow
  // yourself" — and without this the feed you curated never shows you what you
  // put into it, so there is no way to see your own post in the context
  // everyone else sees it in.
  //
  // It also fixes the cold-start case: the old guard returned [] the moment
  // followingEmails was empty, so a brand-new account's Following tab was
  // blank even after they had posted. Now the floor is your own content.
  const emails = withSelf(followingEmails, selfEmail);
  if (emails.length === 0) return [];
  const rows = await e()
    .filter({ author_email: emails }, '-created_date', FETCH_WINDOW)
    .catch(() => []);
  return rows;
};

/**
 * Fetch the crew-only posts addressed to any of `crewIds`.
 *
 * The Following window is keyed on `author_email`, so a crew post only
 * reached crew mates who ALSO follow the author — which is not what "Only
 * crew members will see this post" promises. This is the other half: the
 * posts addressed to your crews, whoever wrote them.
 *
 * No privacy reasoning happens here and none is needed. RLS admits a
 * `privacy = 'crew'` row only when `is_crew_member(crew_id)` holds for the
 * caller (mig 379), so a crew id you are not in returns nothing even if it is
 * passed in. The `.eq('privacy', 'crew')` is a narrowing for the index, not a
 * guard.
 */
export const fetchCrewWindow = async (crewIds = []) => {
  const ids = (crewIds || []).filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('hub_posts')
    .select('*')
    .eq('privacy', 'crew')
    .in('crew_id', ids)
    .order('created_date', { ascending: false })
    .limit(FETCH_WINDOW);
  if (error) return [];
  return data || [];
};

/**
 * Older-than-cursor fetch for "load more" pagination (audit B-9 —
 * the FETCH_WINDOW cap previously made posts past the 100th
 * permanently unreachable).
 */
export const fetchOlderGlobal = async (cursorIso, pageSize = 50) => {
  if (!cursorIso) return [];
  const { data, error } = await supabase
    .from('hub_posts')
    .select('*')
    .eq('privacy', 'public')
    .lt('created_date', cursorIso)
    .order('created_date', { ascending: false })
    .limit(pageSize);
  if (error) return [];
  return data || [];
};

export const fetchOlderFollowing = async (followingEmails = [], cursorIso, pageSize = 50, selfEmail = null) => {
  // Same membership as fetchFollowingWindow, or page 2 silently drops the
  // viewer's own posts and the feed appears to lose them on scroll.
  const emails = withSelf(followingEmails, selfEmail);
  if (!cursorIso || emails.length === 0) return [];
  const { data, error } = await supabase
    .from('hub_posts')
    .select('*')
    .in('author_email', emails)
    .lt('created_date', cursorIso)
    .order('created_date', { ascending: false })
    .limit(pageSize);
  if (error) return [];
  return data || [];
};
/**
 * Fetch posts by id, returned in the ORDER THE IDS WERE GIVEN.
 *
 * The caller's order is the meaningful one — the liked-posts screen sorts by
 * when YOU liked something, not when it was written, and a plain `.in()`
 * returns rows in whatever order the planner likes. Re-sorting here keeps that
 * contract in one place instead of every caller remembering to restore it.
 *
 * Ids that no longer resolve are simply absent: a like pointing at a deleted
 * post should vanish from the list, not render an empty card.
 */
export const listByIds = async (ids = []) => {
  const wanted = (ids || []).filter(Boolean);
  if (wanted.length === 0) return [];
  // Bounded for the same reason fetchFollowingWindow caps at 100 — a very
  // long IN list is a slow query and a big response on a phone.
  const capped = wanted.slice(0, 100);
  const rows = await e().filter({ id: capped }, '-created_date', capped.length).catch(() => []);
  const byId = new Map((rows || []).map(r => [r.id, r]));
  return capped.map(id => byId.get(id)).filter(Boolean);
};
