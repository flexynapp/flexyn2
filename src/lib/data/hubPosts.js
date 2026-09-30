// src/lib/data/hubPosts.js
// Hub posts — community feed entries.
// Privacy is enforced here (and should be re-enforced server-side on migration).

import { ownedRows } from './ownedRows';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';
import { track, EVENTS } from '@/lib/analytics';

// Posts are readable by anyone the author's privacy allows, so the app never
// reads created_by, author_email or collaborator_emails: those are emails.
// Authors and collaborators are user_id and collaborator_ids. The database
// fills the email columns itself (pin_social_row_identity,
// sync_post_collaborator_ids).
export const POST_COLUMNS = 'id, user_id, author_name, author_avatar, author_avatar_url, content, body, image_url, video_url, workout_log_id, likes_count, like_count, dislike_count, comments_count, comment_count, emoji_reaction_count, created_at, created_date, updated_at, edited_at, publish_at, post_type, privacy, crew_id, linked_entity_type, linked_entity_id, linked_entity_snapshot, original_post_id, hashtags, content_warning, content_warning_label, collaborator_ids';
const e = () => ownedRows('hub_posts', { columns: POST_COLUMNS });

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
 * List a single user's posts. Honors privacy: if the viewer doesn't follow
 * the author, only public posts are returned.
 *
 * @param {string} authorId — the author's user id
 * @param {boolean} isFollowing — does the viewer follow this author?
 * @param {boolean} isSelf — is the viewer the same as the author?
 */
export const listForProfile = async (authorId, isFollowing, isSelf, limit = 50) => {
  if (!authorId) return [];
  // The privacy filter goes in the query, not after it. Filtering the first
  // 50 rows client-side meant a non-follower could see fewer than 50 public
  // posts, or none, from someone whose recent posts were followers-only.
  const where = isSelf || isFollowing ? { user_id: authorId } : { user_id: authorId, privacy: 'public' };
  return e().filter(where, '-created_date', limit).catch(() => []);
};

/**
 * How many posts the viewer can see on this profile. The list above stops at
 * 50, so its length was a count that topped out at 50. Same privacy rule as
 * the list; RLS still decides what is readable at all.
 */
export const countForProfile = async (authorId, isFollowing, isSelf) => {
  if (!authorId) return 0;
  let q = supabase.from('hub_posts').select('id', { count: 'exact', head: true }).eq('user_id', authorId);
  if (!isSelf && !isFollowing) q = q.eq('privacy', 'public');
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
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
// Already-defined: listPublicFeed(limit)

const FETCH_WINDOW = 100; // server-side cap per fetch

/**
 * The author set for the Following feed: everyone you follow, plus you, as
 * user ids.
 *
 * Ids rather than emails: the feed used to select on `author_email`, which
 * meant reading every followed person's email off hub_follows. Those emails
 * are on their way out of reach of other users, and `user_id` is on every
 * post (pinned to the author by the write policy), so nothing is lost.
 * De-duped because the same id twice in an IN clause is a wasted slot
 * against the 100 cap.
 */
function withSelf(followingIds = [], selfId = null) {
  const seen = new Set();
  const out = [];
  for (const id of [...(followingIds || []), selfId]) {
    if (!id) continue;
    const k = String(id).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(id);
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
 * Fetch the Following feed window: posts by the users in `followingIds`,
 * public AND followers-only (RLS decides which of those you may see), plus
 * your own.
 *
 * One batched `.in('user_id', ids)` query. It replaced a per-author fan-out
 * (one query per follow, 50+ round trips for an active user).
 */
export const fetchFollowingWindow = async (followingIds = [], selfId = null) => {
  // Your own posts belong in Following. "In a weird way it's as if you follow
  // yourself" — and without this the feed you curated never shows you what you
  // put into it, so there is no way to see your own post in the context
  // everyone else sees it in.
  //
  // It also fixes the cold-start case: the old guard returned [] the moment
  // the follow list was empty, so a brand-new account's Following tab was
  // blank even after they had posted. Now the floor is your own content.
  const ids = withSelf(followingIds, selfId);
  if (ids.length === 0) return [];
  const rows = await e()
    .filter({ user_id: ids }, '-created_date', FETCH_WINDOW)
    .catch(() => []);
  return rows;
};

/**
 * Fetch the crew-only posts addressed to any of `crewIds`.
 *
 * The Following window is keyed on the author, so a crew post only
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
    .select(POST_COLUMNS)
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
    .select(POST_COLUMNS)
    .eq('privacy', 'public')
    .lt('created_date', cursorIso)
    .order('created_date', { ascending: false })
    .limit(pageSize);
  if (error) return [];
  return data || [];
};

export const fetchOlderFollowing = async (followingIds = [], cursorIso, pageSize = 50, selfId = null) => {
  // Same membership as fetchFollowingWindow, or page 2 silently drops the
  // viewer's own posts and the feed appears to lose them on scroll.
  const ids = withSelf(followingIds, selfId);
  if (!cursorIso || ids.length === 0) return [];
  const { data, error } = await supabase
    .from('hub_posts')
    .select(POST_COLUMNS)
    .in('user_id', ids)
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
